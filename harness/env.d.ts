/* Vite resolves a `.css` import as a side effect with no exports. Without this
 * the harness does not typecheck, and the harness is in `tsconfig.include` on
 * purpose — a dev page that has stopped compiling is a dev page nobody runs. */
declare module '*.css'
