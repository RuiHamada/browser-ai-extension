import { defineConfig } from 'vitest/config';

// vitest 設定: jsdom 環境を使い、test ディレクトリのみを対象にする
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
