import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // relative base → dist/ works on GitHub Pages subpaths, Netlify, nginx or even file://
  base: './',
  server: { port: 5173, open: false },
  build: { sourcemap: false, chunkSizeWarningLimit: 1200 },
})
