// Bridge Zalo cá nhân cho ChumChum CRM — bọc thư viện za-go (github.com/tranhaonguyendev/za-go).
//
// ⚠️ KHÔNG CHÍNH THỨC: Zalo không cấp API cho tài khoản cá nhân. Service này đăng nhập
// tài khoản Zalo của bạn như một thiết bị ảo — vi phạm điều khoản Zalo, CÓ THỂ BỊ KHÓA NICK.
// Chỉ dùng khi bạn chấp nhận rủi ro. Khuyến nghị dùng Zalo OA thay thế.
//
// Contract với ChumChum CRM (xem apps/api/src/channels/adapters.ts — ZaloPersonalAdapter):
//   POST /send    header x-api-key, body {userId, text} → {messageId}
//   GET  /status  header x-api-key → {connected}
//   GET  /qr      header x-api-key → {qr: "data:image/png;base64,..."} — quét bằng app Zalo
//
// Đăng nhập bằng QR (za-go không hỗ trợ mật khẩu): bấm "Lấy mã QR" trong wizard CRM,
// quét bằng app Zalo trên điện thoại — phiên (cookies) được lưu vào /data/session.json
// để restart khỏi quét lại.
package main

import (
	"bytes"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	zago "github.com/tranhaonguyendev/za-go"
)

var (
	z          *zago.ZaloAPI
	apiKey     string
	webhookURL string
	imei       string
	listening  bool
	mu         sync.Mutex // bảo vệ z/qrCurrent khi đổi phiên
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// IMEI giữ ổn định qua các lần restart để Zalo không coi là thiết bị mới
func loadOrCreateImei() string {
	path := env("DATA_DIR", ".") + "/imei.txt"
	if b, err := os.ReadFile(path); err == nil && len(b) >= 15 {
		return string(b)
	}
	raw := make([]byte, 15)
	_, _ = crand.Read(raw)
	imei := ""
	for _, c := range raw {
		imei += fmt.Sprintf("%d", c%10)
	}
	_ = os.WriteFile(path, []byte(imei), 0o600)
	return imei
}

func newClient(session any) (*zago.ZaloAPI, error) {
	return zago.Zalo("", "", imei, session, "", false, 0)
}

// Khôi phục phiên cũ (nếu có) → khỏi quét QR lại
func restoreSession() bool {
	b, err := os.ReadFile(env("DATA_DIR", ".") + "/session.json")
	if err != nil {
		return false
	}
	var cookies map[string]string
	if json.Unmarshal(b, &cookies) != nil || len(cookies) == 0 {
		return false
	}
	c, err := newClient(cookies)
	if err != nil || c == nil {
		return false
	}
	mu.Lock()
	z = c
	mu.Unlock()
	return true
}

func saveSession(cookies map[string]string) {
	b, _ := json.Marshal(cookies)
	_ = os.WriteFile(env("DATA_DIR", ".")+"/session.json", b, 0o600)
}

func main() {
	apiKey = os.Getenv("API_KEY")
	webhookURL = os.Getenv("CRM_WEBHOOK_URL")
	if apiKey == "" || webhookURL == "" {
		log.Fatal("Thiếu env API_KEY hoặc CRM_WEBHOOK_URL")
	}
	imei = loadOrCreateImei()
	_ = os.MkdirAll("assets/attachments", 0o755) // za-go ghi ảnh QR vào đây

	c, err := newClient(nil)
	if err != nil {
		log.Fatalf("Khởi tạo za-go thất bại: %v", err)
	}
	z = c

	if restoreSession() {
		log.Printf("Đã khôi phục phiên cũ (đăng nhập: %v)", z.IsLoggedIn())
		startListening()
	} else {
		log.Println("Chưa có phiên — dùng nút 'Lấy mã QR' trong CRM để đăng nhập")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("POST /send", guard(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UserID string `json:"userId"`
			Text   string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" || body.Text == "" {
			http.Error(w, `{"error":"body sai định dạng {userId, text}"}`, http.StatusBadRequest)
			return
		}
		mu.Lock()
		zl := z
		mu.Unlock()
		if !zl.IsLoggedIn() {
			http.Error(w, `{"error":"bridge chưa đăng nhập — quét mã QR từ CRM trước"}`, http.StatusUnauthorized)
			return
		}
		res, err := zl.SendMessage(zago.Message{Text: body.Text}, body.UserID, zago.ThreadTypeUSER)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"messageId": fmt.Sprintf("%v", res)})
	}))

	mux.HandleFunc("GET /status", guard(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		zl := z
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]bool{"connected": zl.IsLoggedIn() && listening})
	}))

	// Sinh mã QR mới + nền chờ quét/xác nhận → tự đăng nhập khi người dùng quét
	mux.HandleFunc("GET /qr", guard(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		zl := z
		mu.Unlock()
		if zl.IsLoggedIn() && listening {
			_ = json.NewEncoder(w).Encode(map[string]any{"connected": true})
			return
		}
		res, err := zl.AuthQRCode()
		if err != nil || len(res.ImageBytes) == 0 {
			msg := fmt.Sprintf("lấy QR lỗi: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":%q}`, msg), http.StatusBadGateway)
			return
		}
		go waitQrLogin(zl, res)
		dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(res.ImageBytes)
		_ = json.NewEncoder(w).Encode(map[string]any{"qr": dataURL})
	}))

	port := env("PORT", "4100")
	log.Printf("🌉 Zalo bridge chạy tại :%s (đã đăng nhập: %v)", port, z.IsLoggedIn())
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// Chờ người dùng quét + xác nhận trên app Zalo rồi lập phiên nghe tin
func waitQrLogin(zl *zago.ZaloAPI, qr *zago.QRAuthResult) {
	scanned, err := zl.WaitQRCodeScan(qr, 100, 3)
	if err != nil || !scanned {
		log.Printf("QR hết hạn chưa được quét: %v", err)
		return
	}
	log.Println("QR đã được quét — chờ xác nhận trên điện thoại...")
	cookies, err := zl.WaitQRCodeConfirm(qr, 100, 5)
	if err != nil || len(cookies) == 0 {
		log.Printf("Xác nhận QR thất bại: %v", err)
		return
	}
	saveSession(cookies)
	c, err := newClient(cookies)
	if err != nil || c == nil {
		log.Printf("Lập phiên sau QR thất bại: %v", err)
		return
	}
	mu.Lock()
	z = c
	mu.Unlock()
	log.Printf("✅ Đã đăng nhập Zalo qua QR (IsLoggedIn=%v)", z.IsLoggedIn())
	startListening()
}

// Nhận tin mới → đẩy về webhook ChumChum CRM (payload chuẩn hoá NormalizedIncomingMessage)
func startListening() {
	mu.Lock()
	zl := z
	mu.Unlock()

	zl.SetMessageListener(func(messageID, userID, message string, _ *zago.MessageObject, _ string, threadType zago.ThreadType) {
		if threadType != zago.ThreadTypeUSER || userID == "" {
			return // bỏ qua tin nhóm
		}
		payload, _ := json.Marshal(map[string]any{
			"accountExternalId": "default",
			"externalUserId":    userID,
			"externalMessageId": messageID,
			"text":              message,
		})
		req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(payload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if resp, err := http.DefaultClient.Do(req); err == nil {
			_ = resp.Body.Close()
		}
	})
	go func() {
		if err := zl.Listen(true, 3); err != nil {
			log.Printf("Zalo socket lỗi: %v", err)
		}
	}()
	listening = true
}

func guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != apiKey {
			http.Error(w, `{"error":"sai api key"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		next(w, r)
	}
}
