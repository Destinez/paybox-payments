import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  external: ['pg'],
  noExternal: ['@paybox/db', '@paybox/shared'],
  clean: true,
});
