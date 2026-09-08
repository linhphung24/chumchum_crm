# syntax=docker/dockerfile:1
# Build từ thư mục bridges/zalo-za-go (không cần cài Go trên máy)
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY main.go go.mod ./
# go mod tidy tự kéo za-go + dependencies và sinh go.sum
RUN go mod tidy
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /bridge .

FROM alpine:3.20
WORKDIR /data
COPY --from=build /bridge /bridge
ENV DATA_DIR=/data PORT=4100
EXPOSE 4100
ENTRYPOINT ["/bridge"]
