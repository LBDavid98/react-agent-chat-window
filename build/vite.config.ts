/* Two builds, because two kinds of host.
 *
 *   dist/index.js       ESM, React left external. For an app with a bundler.
 *   dist/chat.iife.js   everything in one file, React included. For a page
 *                       with a <script> tag and no build step at all.
 *
 * Neither adds a RUNTIME dependency: vite is a devDependency, `peerDependencies`
 * still names only react and react-dom, and the IIFE inlines them rather than
 * asking the page for them.
 *
 * `main` points at the ESM build and `types` at the SOURCE. Both ship, so a
 * bundler gets compiled JS with real types beside it and no .d.ts emit step is
 * needed; a host that would rather compile the TypeScript itself imports
 * `react-agent-chat-window/src` and gets real stack traces.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = new URL('..', import.meta.url).pathname
const iife = process.env.CAI_FORMAT === 'iife'

/** The adapters are plain CSS with no imports, so nothing bundles them — but a
 *  host taking only `dist/` still needs them, and a mapping that ships in one
 *  distribution and not the other is a bug waiting for the first Flask app. */
function copyAdapters(): Plugin {
  return {
    name: 'cai-copy-adapters',
    closeBundle() {
      const from = join(root, 'src/adapters')
      const to = join(root, 'dist/adapters')
      mkdirSync(to, { recursive: true })
      for (const file of readdirSync(from)) {
        if (file.endsWith('.css') || file === 'README.md') copyFileSync(join(from, file), join(to, file))
      }
    },
  }
}

export default defineConfig({
  root,
  plugins: [react(), copyAdapters()],
  // React's UMD-less ESM build still reads `process.env.NODE_ENV`, and a plain
  // page has no `process`. In a bundler app the host substitutes it and nobody
  // notices; in the IIFE it throws on the first line and the global is never
  // defined. Found by the Flask probe, which is the only place it could be.
  define: iife ? { 'process.env.NODE_ENV': '"production"' } : {},
  build: {
    outDir: 'dist',
    emptyOutDir: !iife, // the second build must not delete the first
    cssCodeSplit: false,
    lib: iife
      ? { entry: join(root, 'build/iife.ts'), name: 'AgentChat', formats: ['iife'], fileName: () => 'chat.iife.js' }
      : { entry: join(root, 'src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: iife
      ? // Named, not `style.css`. A file called style.css in someone's static
        // directory is a file nobody can place a year from now.
        { output: { assetFileNames: 'chat.css' } }
      : { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'] },
  },
})
