import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import metadata from './package.json' with { type: 'json' };
// package.json config.distribution names the workspace bin directory that receives the runtime bundle; packaging
// adds the bin/forge.js launcher, which enables Node's compile cache before loading it.
export default defineConfig({
 resolve: { conditions: ['node', 'module'], mainFields: ['module', 'main'] },
 build: { target: 'node22', outDir: resolve(metadata.config.distribution), emptyOutDir: false, minify: false,
  lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'forge-runtime.js' },
  rollupOptions: { external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)], output: { inlineDynamicImports: true } }
 }
});
