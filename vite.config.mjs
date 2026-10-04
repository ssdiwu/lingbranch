import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  build: { outDir: '../dist', emptyOutDir: true, rolldownOptions: {
    onwarn(warning,defaultHandler) {
      // This entry is entirely client-rendered; React Server Component markers do not apply.
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && /["']use client["']/.test(warning.message)) return;
      defaultHandler(warning);
    },
  } },
});
