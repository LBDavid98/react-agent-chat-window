/* ============================================================================
 * ChatDock.tsx — where the window sits, and how it is summoned.
 *
 * Aurora's partner is a floating window with a tornado button; a studio
 * wants a right rail beside a canvas; a dashboard wants a bottom dock. Same
 * conversation, three placements, so placement is a prop rather than three
 * forks of the same component.
 *
 * The rule that survives all three: a docked window TAKES SPACE, it does not
 * overlay the thing it is talking about. An agent that covers the canvas it is
 * describing is an agent you have to close in order to use. Only `floating`
 * overlays, and only because that is what a floating window is for.
 *
 * THIS COMPONENT IS OPTIONAL. `ChatWindow` is the deliverable and renders into
 * whatever box it is given; this is a convenience for an app that has no panel
 * system of its own. An app that already has one — Atlas has a run dock,
 * a host app has SessionShell — should render the window into that instead, and
 * import neither this nor `dock.css`.
 * ========================================================================== */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Below this the viewport cannot hold two surfaces at once. Kept in step with
 *  the media query in dock.css by hand; there is one of each. */
const NARROW = '(max-width: 720px)'

export type Placement = 'right' | 'bottom' | 'floating'

const MIN = { right: 320, bottom: 200, floating: 360 }
/** Never let the window take more than this share of the viewport. Neither
 *  surface may be squeezed out of existence — the same clamp the run dock
 *  needed, for the same reason. */
const MAX_SHARE = 0.5

export function ChatDock({
  open,
  placement = 'right',
  storageKey,
  onClose,
  children,
}: {
  open: boolean
  placement?: Placement
  /** Remembers the operator's chosen size across sessions. */
  storageKey?: string
  /** Only used on a narrow viewport, where the dock has to cover the workspace
   *  and therefore has to offer a way back out of it. */
  onClose?: () => void
  children: ReactNode
}) {
  const vertical = placement === 'bottom'
  const narrow = useNarrow()
  const [size, setSize] = useState(() => readSize(storageKey, MIN[placement]))
  const dragging = useRef(false)

  const clamp = useCallback(
    (value: number) => {
      const viewport = vertical ? window.innerHeight : window.innerWidth
      return Math.max(MIN[placement], Math.min(value, viewport * MAX_SHARE))
    },
    [placement, vertical],
  )

  useEffect(() => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, String(size))
    } catch {
      /* site data blocked; the size just does not persist */
    }
  }, [size, storageKey])

  useEffect(() => {
    function move(e: PointerEvent): void {
      if (!dragging.current) return
      setSize(clamp(vertical ? window.innerHeight - e.clientY : window.innerWidth - e.clientX))
    }
    function up(): void {
      dragging.current = false
      document.body.classList.remove('cai-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [clamp, vertical])

  if (!open) return null

  const style = placement === 'bottom' ? { height: size } : { width: size }

  // A narrow viewport cannot honour "takes space, never covers", so the dock
  // covers — and says so, rather than quietly becoming the thing it promised
  // not to be. The way back out has to be here: the workspace underneath is no
  // longer reachable, so an operator who does not want this has no other exit.
  const covering = narrow && placement === 'right'

  return (
    <div className={`cai-dock cai-dock-${placement}`} style={style}>
      {covering && (
        <div className="cai-dock-note">
          <span>Covering the workspace — the screen is too narrow to show both.</span>
          {onClose && (
            <button type="button" className="cai-btn cai-ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      )}
      {placement !== 'floating' && !covering && (
        <div
          className="cai-grip"
          role="separator"
          aria-orientation={vertical ? 'horizontal' : 'vertical'}
          aria-label="Resize the chat"
          tabIndex={0}
          onPointerDown={() => {
            dragging.current = true
            document.body.classList.add('cai-resizing')
          }}
          onKeyDown={(e) => {
            // Operable from the keyboard. A grip reachable only by mouse is
            // not a control, and this one decides how much of the workspace
            // remains visible.
            const step = e.shiftKey ? 64 : 16
            const grow = vertical ? 'ArrowUp' : 'ArrowLeft'
            const shrink = vertical ? 'ArrowDown' : 'ArrowRight'
            if (e.key === grow) setSize((s) => clamp(s + step))
            else if (e.key === shrink) setSize((s) => clamp(s - step))
            else return
            e.preventDefault()
          }}
        />
      )}
      <div className="cai-dock-body">{children}</div>
    </div>
  )
}

/** Whether the viewport is too narrow to hold the workspace and the dock at
 *  once. `matchMedia` is absent in jsdom and in any non-browser render, so a
 *  missing one means "not narrow" rather than a crash. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(NARROW)
    setNarrow(query.matches)
    const onChange = (e: MediaQueryListEvent): void => setNarrow(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

function readSize(key: string | undefined, fallback: number): number {
  if (!key) return fallback
  try {
    const stored = Number(window.localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? stored : fallback
  } catch {
    return fallback
  }
}

/** The button that summons the window.
 *
 *  Rendered wherever the host wants it — a context bar, a corner. It is a
 *  plain button on purpose: an app whose nav is contractually fixed at a
 *  certain number of destinations cannot afford a component that insists on
 *  being one of them. */
export function ChatLauncher({
  open,
  onToggle,
  label = 'Chat',
  glyph = '✦',
}: {
  open: boolean
  onToggle: () => void
  label?: string
  glyph?: string
}) {
  return (
    <button
      type="button"
      className={`cai-launcher${open ? ' cai-on' : ''}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span aria-hidden="true">{glyph}</span>
      {label}
    </button>
  )
}
