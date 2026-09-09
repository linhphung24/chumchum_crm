# syntax=docker/dockerfile:1
# Build từ thư mục bridges/zalo-zca — chạy Node 20, không cần cài gì trên máy
FROM node:20-alpine
# Dự phòng nếu zca-js có dependency cần biên dịch
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY main.js ./
ENV DATA_DIR=/data PORT=4100
EXPOSE 4100
CMD ["node", "main.js"]
