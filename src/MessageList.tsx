/* ============================================================================
 * MessageList.tsx — the stream.
 *
 * Two behaviours here are not decoration. It only auto-scrolls when the reader
 * is already at the bottom, because yanking someone back down while they are
 * reading an earlier answer is the single most irritating thing a chat window
 * does. And a tool row appears while the tool is RUNNING, because a turn that
 * goes quiet for four seconds reads as a hung agent.
 * ========================================================================== */
import { useEffect, useRef } from 'react'
import type { WidgetReply } from './contracts'
import type { ChatMessage } from './messages'
import { Widget } from './Widget'
import { WidgetFrame } from './WidgetFrame'
import { widgetFor, type WidgetRegistry } from './widgets/registry'

const TOOL_TONE = { running: 'neutral', done: 'neutral', failed: 'danger' } as const
const TOOL_TAG = { running: 'Working', done: 'Used', failed: 'Failed' } as const

export function MessageList({
  messages,
  widgets,
  send,
  onResolve,
  onAnswer,
  emptyState,
}: {
  messages: ChatMessage[]
  widgets?: WidgetRegistry
  send: (text: string) => void
  onResolve: (id: string, outcome: 'approved' | 'denied') => void
  onAnswer: (id: string, reply: WidgetReply) => void
  emptyState?: React.ReactNode
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const node = scroller.current
    if (!node || !pinned.current) return
    const bottom = (): void => {
      if (scroller.current && pinned.current) scroller.current.scrollTop = scroller.current.scrollHeight
    }
    bottom()
    // And again once layout has actually settled. The first call runs before
    // the browser has finished sizing this content, so a stream that grew by a
    // widget — or a transcript loaded whole on open — lands short of the
    // bottom and the newest thing said is the part cut off. A web font
    // arriving later moves it again, which is why `fonts.ready` is here too:
    // every host in this estate loads one.
    const frame = requestAnimationFrame(bottom)
    document.fonts?.ready.then(bottom).catch(() => undefined)
    return () => cancelAnimationFrame(frame)
  }, [messages])

  function onScroll(): void {
    const node = scroller.current
    if (!node) return
    // A small tolerance: "at the bottom" should survive a stray pixel from a
    // fractional line height, or the view unpins itself and never re-pins.
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  if (!messages.length && emptyState) {
    return <div className="cai-stream cai-empty">{emptyState}</div>
  }

  return (
    <div className="cai-stream" ref={scroller} onScroll={onScroll} tabIndex={0} role="log">
      {messages.map((m) => (
        <Row
          key={m.id}
          m={m}
          widgets={widgets}
          send={send}
          onResolve={onResolve}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  )
}

function Row({
  m,
  widgets,
  send,
  onResolve,
  onAnswer,
}: {
  m: ChatMessage
  widgets?: WidgetRegistry
  send: (text: string) => void
  onResolve: (id: string, outcome: 'approved' | 'denied') => void
  onAnswer: (id: string, reply: WidgetReply) => void
}) {
  switch (m.type) {
    case 'text':
      return (
        <div className={`cai-row cai-${m.role}`}>
          <div className="cai-said">
            <div className={`cai-bubble cai-${m.role}`}>
              {m.text}
              {m.pending && <span className="cai-working" aria-label="Working" />}
            </div>
            {/* Said quietly, under the answer, because it is a fact ABOUT the
                answer and not an alarm. It appears only when the gateway
                substituted one model for another — which it does silently
                whenever a tool definition is attached — and a window that
                cannot say so reports another model's answer as the one you
                asked for. */}
            {m.served && (
              <span className="cai-served">
                {m.served.insteadOf
                  ? `answered by ${m.served.model}, not ${m.served.insteadOf}`
                  : `answered by ${m.served.model}`}
              </span>
            )}
          </div>
        </div>
      )

    case 'tool':
      return (
        <div className="cai-row cai-agent">
          <WidgetFrame
            tone={TOOL_TONE[m.state]}
            tag={TOOL_TAG[m.state]}
            glyph={m.effect === 'write' ? '✎' : '⌕'}
            title={m.tool}
            sub={m.effect === 'write' ? 'changes something' : undefined}
          >
            {m.detail && <span className="cai-detail">{m.detail}</span>}
          </WidgetFrame>
        </div>
      )

    case 'confirmation':
      return (
        <div className="cai-row cai-agent">
          <WidgetFrame
            tone="warn"
            tag={m.resolved ? (m.resolved === 'approved' ? 'Approved' : 'Declined') : 'Proposed'}
            glyph="!"
            title={m.summary || m.tool}
            sub={m.resolved ? undefined : 'waiting for you'}
            foot={
              m.resolved ? null : (
                <>
                  {/* Neither is autofocused. An approval reached by pressing
                      Enter out of habit is not an approval. */}
                  <button type="button" className="cai-btn" onClick={() => onResolve(m.id, 'approved')}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="cai-btn cai-ghost"
                    onClick={() => onResolve(m.id, 'denied')}
                  >
                    Deny
                  </button>
                </>
              )
            }
          >
            {m.args && Object.keys(m.args).length > 0 && (
              <dl className="cai-args">
                {Object.entries(m.args).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </WidgetFrame>
        </div>
      )

    case 'ask':
      return (
        <div className="cai-row cai-agent">
          <Widget
            spec={m.spec}
            answered={m.answered}
            superseded={m.superseded}
            onSubmit={(reply) => onAnswer(m.id, reply)}
          />
        </div>
      )

    case 'notice':
      return (
        <div className="cai-row cai-agent">
          <div className={`cai-notice cai-${m.tone}`} role={m.tone === 'error' ? 'alert' : undefined}>
            {m.text}
          </div>
        </div>
      )

    case 'session':
      return (
        <div className="cai-row cai-center" role="separator" aria-label={`New session ${m.label}`}>
          <span className="cai-session">{m.label}</span>
        </div>
      )

    case 'widget': {
      const Widget = widgetFor(widgets, m.kind)
      // A kind nobody registered renders nothing. A message from a newer host
      // than this bundle is a thing to ignore, not a crash.
      if (!Widget) return null
      return (
        <div className="cai-row cai-agent">
          <Widget payload={m.payload as never} send={send} />
        </div>
      )
    }
  }
}
