import { defineConfig, mergeConfig } from 'vitest/config'
import type { NextConfig } from 'next'

// Next.js config wird nicht direkt importiert (CommonJS + webpack alias).
// Wir übernehmen nur die path-alias aus tsconfig per resolve.alias.
const baseConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**'],
    globals: true,
    setupFiles: ['./src/setup-tests.ts'],
    testPathIgnorePattern: '/node_modules/',
    resolve: {
      alias: {
        '@': './src',
        '@plugins': './plugins-pack',
        '@/builtin-plugins': './src/builtin-plugins',
      },
    },
  },
})

export default baseConfig
