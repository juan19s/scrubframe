import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The picker's selector logic is fiddly enough to deserve real DOM tests.
    environment: 'happy-dom',
  },
});
