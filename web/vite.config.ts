import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Panggilan /api diteruskan ke server Node.js saat pengembangan
      '/api': 'http://localhost:3001',
    },
  },
});
