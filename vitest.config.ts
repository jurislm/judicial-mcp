import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './__tests__/prepare-runtime.ts',
    watchTriggerPatterns: [{
      pattern: /(?:^|\/)(?:(?:src|bin)\/.*\.ts|package\.json|bun\.lock)$/,
      testsToRun: () => ['./__tests__/runtime-package.test.ts', './__tests__/release-please-config.test.ts'],
    }],
  },
})
