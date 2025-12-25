import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tsconfigPaths()],
  ssr: {
    noExternal: true
  }
});
