/* The self-contained entry: everything, including React, in one file.
 *
 * This is what a page with no bundler loads. Almanac is the case that forces
 * it — a Flask app, one Jinja template, vanilla JS, no package.json anywhere in
 * the repo — and without it "droppable into any app" is only true
 * of the products that happen to build with Vite.
 *
 * The stylesheets are imported HERE and not from `src`, so a React app taking
 * the ESM build still chooses its own CSS (and can skip `dock.css` entirely),
 * while a script-tag consumer gets one file that works.
 */
import '../src/chat.css'
import '../src/dock.css'

export { mountChat } from '../src/mount'
export { createHttpChatClient } from '../src/client'
export { createChatStore } from '../src/store'
export { isTerminal, TERMINAL_KINDS } from '../src/contracts'
