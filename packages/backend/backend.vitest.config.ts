import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@homeos/schemas': resolve(__dirname, '../schemas/src/index.ts'),
    },
    extensions: ['.ts', '.js'],
  },
})
