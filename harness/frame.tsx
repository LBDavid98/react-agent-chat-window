/* One cell of the harness: one host's tokens, one scheme, one window.
 *
 * The point of the iframe is that this loads the REAL adapter file at :root,
 * exactly as an application would, rather than a rewritten copy scoped to a
 * class. If an adapter only works when its selector is rewritten, it does not
 * work. */
import { createRoot } from 'react-dom/client'
import { ChatWindow, type WidgetProps } from '../src'
import '../src/chat.css'
import { demoStore } from './fixture'

const params = new URLSearchParams(location.search)
const host = params.get('host') ?? 'atlas'
const scheme = params.get('scheme') ?? 'light'

/** Static so Vite can see them. A dynamic path would be a runtime 404 in the
 *  one place a runtime 404 is invisible — an empty iframe reads as an unstyled
 *  window rather than as a missing file. */
const SHEETS: Record<string, () => Promise<unknown>> = {
  atlas: () =>
    Promise.all([import('./hosts/atlas.css'), import('../src/adapters/atlas.css')]),
  modernist: () =>
    Promise.all([import('./hosts/modernist.css'), import('../src/adapters/modernist.css')]),
  almanac: () => Promise.all([import('./hosts/almanac.css'), import('../src/adapters/almanac.css')]),
  aurora: () =>
    Promise.all([import('./hosts/aurora.css'), import('../src/adapters/aurora.css')]),
}

/** Stands in for a host application's own registered widget — the extension
 *  point that keeps app-specific cards inside the stream instead of bolted
 *  beside it. Deliberately plain: it is here to prove the seam works and to be
 *  looked at in four themes, not to be a component. */
function GraphDiff({ payload }: WidgetProps<{ added: number; removed: number }>) {
  return (
    <div className="cai-w cai-w-accent">
      <div className="cai-w-head">
        <span className="cai-w-glyph" aria-hidden="true">
          ◇
        </span>
        <div className="cai-w-headtext">
          <b>Graph diff</b>
          <span>a widget the host registered</span>
        </div>
        <span className="cai-w-tag">Shown</span>
      </div>
      <div className="cai-w-body">
        <span className="cai-detail">
          {payload.added} nodes added, {payload.removed} removed
        </span>
      </div>
    </div>
  )
}

async function main(): Promise<void> {
  document.documentElement.dataset.scheme = scheme
  await (SHEETS[host] ?? SHEETS.atlas)()
  createRoot(document.getElementById('chat')!).render(
    <ChatWindow
      store={demoStore()}
      title="Ada"
      subtitle={`${host} · ${scheme}`}
      placeholder="Ask Ada…"
      widgets={{ 'graph-diff': GraphDiff as never }}
      onClose={() => undefined}
      onConfirm={() => undefined}
    />,
  )
}

void main()
