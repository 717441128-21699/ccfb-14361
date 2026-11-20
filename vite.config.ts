import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    watch: {
      // 防御:忽略构建产物与任何浏览器 profile,避免外部锁文件(EBUSY)拖垮监听器
      ignored: ['**/dist/**', '**/.edge-profile/**', '**/node_modules/**'],
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
