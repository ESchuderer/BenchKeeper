import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The libraries change less often than the views, so each gets its own chunk: a release reloads only what changed.
const libs = [['react', /node_modules[\\/](react|react-dom|scheduler)[\\/]/], ['mantine', /node_modules[\\/]@mantine[\\/]/], ['icons', /node_modules[\\/]@tabler[\\/]/]];

export default defineConfig({
  plugins: [react()], root: 'ui',
  build: { outDir: '../dist', emptyOutDir: true, rolldownOptions: { output: { codeSplitting: { groups: libs.map(([name, test]) => ({ name, test })) } } } },
});
