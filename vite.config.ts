import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    target: 'node20',
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'esm',
        entryFileNames: 'index.js'
      }
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts']
  }
});
