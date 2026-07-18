import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the built app works when served from a GitHub Pages subpath.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
