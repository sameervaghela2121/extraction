import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Hosts allowed to reach the dev server (needed when serving behind a domain).
    allowedHosts: ['invoice.demotrt.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy: {
      // Forward API calls to FastAPI so the browser stays same-origin (no CORS).
      '/login': 'http://127.0.0.1:8000',
      '/extract': 'http://127.0.0.1:8000',
      '/status': 'http://127.0.0.1:8000',
      '/download': 'http://127.0.0.1:8000',
      '/files': 'http://127.0.0.1:8000',
      '/invoices': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
})
