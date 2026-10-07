import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
export default defineConfig({
 build: { target: 'node22', outDir: 'bin/app', emptyOutDir: true, minify: false,
  lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'app.cjs' },
  rollupOptions: { external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)], output: { inlineDynamicImports: true, banner: '#!/usr/bin/env node' } }
 }
});
