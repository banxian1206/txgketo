import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 端口登记见 ~/lyq/PORTS.md：前端 5207 / 后端 8208
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5207,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8208', changeOrigin: true },
    },
  },
})
