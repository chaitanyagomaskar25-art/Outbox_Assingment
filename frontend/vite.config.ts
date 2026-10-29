import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: '',
        changeOrigin: true,
        secure: false,
      },
      '/admin/queues': {
        target: 'https://outbox-assingment-cqpz.vercel.app',
        changeOrigin: true,
      },
    },
  },
});

