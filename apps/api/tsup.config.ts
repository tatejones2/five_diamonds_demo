import { defineConfig } from 'tsup';

// Bundles the workspace `@fd/shared` source into the server build; npm deps stay external.
export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/db/migrate.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@fd/shared'],
});
