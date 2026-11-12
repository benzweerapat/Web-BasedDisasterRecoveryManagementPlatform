import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  define: { "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(process.env.APP_BUILD_ID || "srm-nosql-parity-20260909") },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3003',
        changeOrigin: true,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
  }
})
