import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    hmr: {
      host: 'localhost',
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // pdfjs-dist's worker/chunk splitting confuses Vite's dep optimizer — it produces a chunk
    // reference (`chunk-XU67BHSW.js`-style hash) that isn't actually written to
    // node_modules/.vite/deps, breaking the entire app with "Failed to fetch dynamically
    // imported module" the moment anything imports pdfjs-dist (used by src/lib/pdfStatementImport.ts
    // for PDF bank-statement uploads). Vite's own dev-server warning suggests this exact fix.
    exclude: ['pdfjs-dist'],
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
})
