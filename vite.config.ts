import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Which commit is this build? Stamped into the bundle so the running app can
// say what it is — the deployed page and the repo are otherwise impossible to
// line up by eye. CI hands us the SHA directly; locally we ask git, and mark
// the build dirty if the tree had uncommitted changes, because a stamp that
// claims to be a commit it is not is worse than no stamp.
function buildStamp(): string {
  const ci = process.env.GITHUB_SHA
  if (ci !== undefined && ci !== '') return ci.slice(0, 7)
  try {
    const sha = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== ''
    return dirty ? `${sha}+` : sha
  } catch {
    return 'dev' // no git, no problem — a source tarball still builds
  }
}

// base './' so the built app works when served from a GitHub Pages subpath.
export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(buildStamp()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, 'Z')),
  },
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
