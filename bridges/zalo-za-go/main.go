// Bridge Zalo cá nhân cho ChumChum CRM — bọc thư viện za-go (github.com/tranhaonguyendev/za-go).
//
// ⚠️ KHÔNG CHÍNH THỨC: Zalo không cấp API cho tài khoản cá nhân. Service này đăng nhập
// tài khoản Zalo của bạn như một thiết bị ảo — vi phạm điều khoản Zalo, CÓ THỂ BỊ KHÓA NICK.
// Chỉ dùng khi bạn chấp nhận rủi ro. Khuyến nghị dùng Zalo OA thay thế.
//
// Contract với ChumChum CRM (xem apps/api/src/channels/adapters.ts — ZaloPersonalAdapter):
//   POST /send    header x-api-key, body {userId, text}          → {messageId}
//   GET  /status  header x-api-key                                → {connected}
//   GET  /qr      header x-api-key                                → (chưa hỗ trợ — đăng nhập bằng SĐT/mật khẩu qua env)
//
// Chạy bằng Docker (xem Dockerfile): cần env PHONE, PASSWORD, API_KEY, CRM_WEBHOOK_URL.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	zago "github.com/tranhaonguyendev/za-go"
)

var (
	z          *zago.ZaloAPI
	apiKey     string
	webhookURL string
	listening  bool
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// IMEI giữ ổn định qua các lần restart (lưu vào DATA_DIR) để Zalo không coi là thiết bị mới
func loadOrCreateImei() string {
	path := env("DATA_DIR", ".") + "/imei.txt"
	if b, err := os.ReadFile(path); err == nil && len(b) >= 15 {
		return string(b)
	}
	raw := make([]byte, 15)
	_, _ = rand.Read(raw)
	imei := ""
	for _, c := range raw {
		imei += fmt.Sprintf("%d", c%10)
	}
	_ = os.WriteFile(path, []byte(imei), 0o600)
	return imei
}

func main() {
	apiKey = os.Getenv("API_KEY")
	webhookURL = os.Getenv("CRM_WEBHOOK_URL")
	if apiKey == "" || webhookURL == "" {
		log.Fatal("Thiếu env API_KEY hoặc CRM_WEBHOOK_URL")
	}
	phone := os.Getenv("PHONE")
	password := os.Getenv("PASSWORD")

	var err error
	z, err = zago.Zalo(phone, password, loadOrCreateImei(), nil, "", false, 0)
	if err != nil {
		log.Fatalf("Khởi tạo za-go thất bại: %v", err)
	}

	// Đăng nhập bằng SĐT + mật khẩu (QR đang chờ za-go bổ sung tài liệu)
	if phone != "" && password != "" {
		if !z.IsLoggedIn() {
			if err := z.Login(phone, password, loadOrCreateImei(), "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"); err != nil {
				log.Fatalf("Đăng nhập Zalo thất bại: %v", err)
			}
		}
		startListening()
	} else {
		log.Println("Chưa có PHONE/PASSWORD — bridge chạy ở chế độ chờ (trạng thái: chưa đăng nhập)")
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
		if !z.IsLoggedIn() {
			http.Error(w, `{"error":"bridge chưa đăng nhập Zalo (kiểm tra PHONE/PASSWORD)"}`, http.StatusUnauthorized)
			return
		}
		res, err := z.SendMessage(zago.Message{Text: body.Text}, body.UserID, zago.ThreadTypeUSER)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"messageId": fmt.Sprintf("%v", res)})
	}))

	mux.HandleFunc("GET /status", guard(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]bool{"connected": z.IsLoggedIn() && listening})
	}))

	mux.HandleFunc("GET /qr", guard(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"QR chưa hỗ trợ — đăng nhập bridge bằng PHONE/PASSWORD trong env"}`, http.StatusNotImplemented)
	}))

	port := env("PORT", "4100")
	log.Printf("🌉 Zalo bridge chạy tại :%s (đã đăng nhập: %v)", port, z.IsLoggedIn())
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// Nhận tin mới → đẩy về webhook ChumChum CRM (payload chuẩn hoá NormalizedIncomingMessage)
func startListening() {
	z.SetMessageListener(func(messageID, userID, message string, _ *zago.MessageObject, _ string, threadType zago.ThreadType) {
		if threadType != zago.ThreadTypeUSER || userID == "" {
			return // bỏ qua tin nhóm
		}
		payload, _ := json.Marshal(map[string]any{
			"accountExternalId":  "default",
			"externalUserId":      userID,
			"externalMessageId":   messageID,
			"text":                message,
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
		if err := z.Listen(true, 3); err != nil {
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
