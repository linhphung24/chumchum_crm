/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tắt eslint trong build để không chặn vì cảnh báo <img>
  eslint: { ignoreDuringBuilds: true },
  // Image Docker chạy .next/standalone/server.js (nhẹ, không cần node_modules đầy đủ)
  output: 'standalone',
};

export default nextConfig;
