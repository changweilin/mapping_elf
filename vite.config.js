import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? './' : '/mapping_elf/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'leaflet',
              test: /node_modules[\\/]leaflet/,
              priority: 30,
            },
            {
              name: 'chart',
              test: /node_modules[\\/](chart\.js|@kurkle)/,
              priority: 20,
            },
            {
              name: 'zip',
              test: /node_modules[\\/]jszip/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 0,
            },
          ],
        },
      },
    },
  },
}));
