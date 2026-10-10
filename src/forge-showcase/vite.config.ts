import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  build: mode === 'demo' ? { outDir: 'demo-dist' } : {
    target: 'es2022',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { external: ['zod'] },
  },
}));
