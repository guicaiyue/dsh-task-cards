import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/{shared,host}/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'legacy',
          include: ['tests/legacy/**/*.test.mjs'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: ['tests/client/**/*.test.tsx'],
          environment: 'happy-dom',
          setupFiles: ['tests/client/setup.ts'],
        },
      },
    ],
  },
})
