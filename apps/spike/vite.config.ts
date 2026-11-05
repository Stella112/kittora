import { defineConfig } from 'vite'

// THROWAWAY spike. Phone loads http://<LAN-IP>:5175; /api is proxied to the local verify server.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5175, proxy: { '/api': 'http://127.0.0.1:8787' } },
})
