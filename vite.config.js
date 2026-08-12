import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? './' : '/mapping_elf/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // 魔法陣 tool logic (ported from mapping_star). ~90 kB dominated by
            // magicCircle's 16-element / 12-constellation tables — kept out of
            // index-* so the app bundle stays under its ratcheted budget
            // (test/chunk-output.mjs) without touching main.js (INC-207).
            // Priority stays BELOW leaflet's: starLayers.js imports leaflet, and
            // a higher priority pulls the whole Leaflet runtime into this group,
            // which deletes the expected leaflet-* chunk.
            {
              name: 'star',
              test: /src[\\/]modules[\\/]star[\\/]/,
              priority: 10,
            },
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
              name: 'three',
              test: /node_modules[\\/]three/,
              priority: 25,
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
