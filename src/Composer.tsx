/* ============================================================================
 * Composer.tsx — where a person writes.
 *
 * Stays editable while a turn is in flight: composing the next message while
 * the agent works is normal, and locking the box for it is the kind of small
 * cruelty that makes a chat feel slow. Only Send is gated.
 *
 * And it holds the operator's words until the HOST has taken them — see
 * `submit`. That one detail is the difference between a failed send costing a
 * retry and costing a paragraph.
 * ========================================================================== */
import { useRef, useState } from 'react'

export function Composer({
  busy,
  onSend,
  onStop,
  placeholder = 'Ask…',
  draftKey,
}: {
  busy: boolean
  /** Resolves TRUE when the host accepted the turn. The box empties on that
   *  and on nothing else. */
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  placeholder?: string
  /** When given, an unsent draft survives closing the window and a reload.
   *  Per-viewer convenience only; wrapped because a browser with site data
   *  blocked throws on access rather than returning null. */
  draftKey?: string
}) {
  const [text, setText] = useState(() => readDraft(draftKey))
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement | null>(null)

  function change(value: string): void {
    setText(value)
    writeDraft(draftKey, value)
  }

  async function submit(): Promise<void> {
    const message = text.trim()
    // `sending` and not `busy`: the store has not re-rendered us yet at the
    // moment of the second Enter, and two turns from one message is worse than
    // a dropped keystroke.
    if (!message || busy || sending) return
    setSending(true)
    try {
      // Cleared ONLY when the host accepted it. A refused turn leaves the words
      // exactly where they were, which is both the restore and the retry: the
      // message is in the box and Ask is enabled. Nobody retypes anything.
      if (await onSend(message)) change('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="cai-composer">
      <textarea
        ref={box}
        className="cai-input"
        rows={2}
        value={text}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {busy ? (
        <button type="button" className="cai-btn cai-stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="button" className="cai-btn" onClick={() => void submit()} disabled={!text.trim()}>
          Ask
        </button>
      )}
    </div>
  )
}

function readDraft(key?: string): string {
  if (!key) return ''
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(key: string | undefined, value: string): void {
  if (!key) return
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    /* a browser with site data blocked throws here; a draft is not worth a crash */
  }
}
