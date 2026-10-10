import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import metadata from './package.json' with { type: 'json' };
// package.json config.distribution names the workspace bin directory that receives the executable.
export default defineConfig({
 resolve: { conditions: ['node', 'module'], mainFields: ['module', 'main'] },
 build: { target: 'node22', outDir: resolve(metadata.config.distribution), emptyOutDir: false, minify: false,
  lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'app.js' },
  rollupOptions: { external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)], output: { inlineDynamicImports: true, banner: '#!/usr/bin/env node' } }
 }
});
