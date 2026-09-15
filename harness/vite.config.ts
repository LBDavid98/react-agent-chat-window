import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The harness is a dev page and ships in nothing — it is not in `files` and not
// in the build. Its root is this directory so `index.html` and `frame.html` are
// both entry points.
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  server: { open: true },
})
