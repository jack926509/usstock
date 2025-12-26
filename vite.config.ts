
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 確保 process.env 存在，防止瀏覽器報錯 Uncaught ReferenceError: process is not defined
    'process.env': {
      NODE_ENV: JSON.stringify(process.env.NODE_ENV || 'development'),
      API_KEY: process.env.API_KEY ? JSON.stringify(process.env.API_KEY) : '""'
    }
  },
  server: {
    port: 3000
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
