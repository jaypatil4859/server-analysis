import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3970,
    proxy: {
      '/api': {
        target: 'http://localhost:3971',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3971',
        changeOrigin: true,
      },
    },
  },
})
