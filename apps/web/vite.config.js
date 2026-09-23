import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow access through the current Cloudflare Tunnel hostname.
    allowedHosts: ['concrete-drag-picks-around.trycloudflare.com'],
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3001',
      '/socket.io': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3001', ws: true }
    }
  }
});
