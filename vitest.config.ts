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
          name: 'client',
          include: ['tests/client/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          setupFiles: ['tests/client/setup.ts'],
          // 宿主 shell 里 NODE_ENV 可能是 production；React 会因此用生产包，
          // @testing-library 的 act() 在生产包里被禁用，测试必须先钉成 test。
          env: { NODE_ENV: 'test' },
        },
      },
    ],
  },
})
