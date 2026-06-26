import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/monitoring/',
  server: {
    port: 3970,
    host: true,
    proxy: {
      '/monitoring-apis': {
        target: 'http://localhost:3971',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monitoring-apis/, '')
      },
    },
  },
  preview: {
    port: 3970,
    host: true,
    strictPort: true,
    proxy: {
      '/monitoring-apis': {
        target: 'http://localhost:3971',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monitoring-apis/, '')
      },
    },
  }
})
