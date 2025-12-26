
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 確保瀏覽器中可以安全訪問 process.env，防止 ReferenceError
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
