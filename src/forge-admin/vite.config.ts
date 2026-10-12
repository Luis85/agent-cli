import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';
import { notices } from './scripts/notices';

export default defineConfig({
  base: '/views/admin/',
  plugins: [vue(), ui({ dts: false, colorMode: false, ui: { colors: { primary: 'emerald', neutral: 'slate' } } }), notices()],
  build: { outDir: 'dist', sourcemap: false },
});
