import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the built app works when served from a GitHub Pages subpath.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    // Generous so runner speed can never flip a result: several suites run
    // multi-career simulations that take ~3s locally and ~2x that on CI
    // runners — vitest's default 5s timeout made local-green CI-red.
    testTimeout: 120_000,
  },
})
