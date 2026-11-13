import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  noExternal: ['@paybox/db', '@paybox/shared'],
  clean: true,
});
