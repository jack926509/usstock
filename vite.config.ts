
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 僅定義 NODE_ENV，不定義 API_KEY 以免覆蓋執行階段的注入
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  server: {
    port: 3000
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
