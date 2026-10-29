import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    watchTriggerPatterns: [{
      pattern: /(?:^|\/)(?:(?:src|bin)\/.*\.ts|package\.json|bun\.lock)$/,
      testsToRun: () => './__tests__/runtime-package.test.ts',
    }],
  },
})
