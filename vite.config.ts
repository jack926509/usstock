
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 關鍵修復：將 process.env 對應到一個空物件，防止第三方庫崩潰
    'process.env': {},
    'process.version': '"v20.0.0"',
  },
  server: {
    port: 3000
  }
});
