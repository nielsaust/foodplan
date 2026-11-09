import { defineConfig } from 'vite'
export default defineConfig(({ command }) => ({
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(command === 'build' ? new Date().toISOString() : null),
  },
  server: {
    proxy: { '/api': process.env.API_URL || 'http://127.0.0.1:8787' },
  },
}))
