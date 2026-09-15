/* ============================================================================
 * ChatWindow.tsx — the window itself.
 *
 * Takes a store and renders it. It does not fetch, does not own a session and
 * does not know what an agent is; that is `store.ts` and `client.ts`. Which
 * means a host app can render this against a fake store in a test, or against
 * a completely different transport, without touching a line of it.
 * ========================================================================== */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import type { ChatStore } from './store'
import type { ClientToolRegistry } from './tools'
import type { WidgetRegistry } from './widgets/registry'

export function ChatWindow({
  store,
  title,
  subtitle,
  widgets,
  tools,
  emptyState,
  onClose,
  onConfirm,
  draftKey,
  placeholder,
}: {
  store: ChatStore
  title: string
  subtitle?: string
  widgets?: WidgetRegistry
  /** Tools in THIS browser that the agent may call — reading the selection,
   *  focusing a control, anything whose answer only this page knows.
   *
   *  Change it freely: it is re-declared on every turn, so a routed app can
   *  offer different tools on different screens without anything going stale.
   *  What it must not do is name a tool the host already serves; the host
   *  refuses those, because a page that could replace one could make the model
   *  believe anything. */
  tools?: ClientToolRegistry
  emptyState?: ReactNode
  onClose?: () => void
  /** Called when a person decides a proposal. The host resumes the run — it
   *  owns the credential and the resume route, and a UI package carrying a
   *  second resume implementation would be a second thing to keep correct. */
  onConfirm?: (
    runId: string | undefined,
    outcome: 'approved' | 'denied',
    proposalId?: string,
  ) => void
  draftKey?: string
  placeholder?: string
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  // The host's transcript is the record; this list is a view of it. Reopening
  // the window without this shows an empty panel until the next turn, and a
  // conversation that vanishes on refresh is not a conversation.
  useEffect(() => {
    void store.hydrate()
  }, [store])

  // Synced on every render that changes it rather than captured once. The
  // whole point of declaring per turn is that this can change between two
  // turns; a registry read at mount would be the staleness back again.
  useEffect(() => {
    store.setTools(tools)
  }, [store, tools])

  function resolve(id: string, outcome: 'approved' | 'denied'): void {
    const message = state.messages.find((m) => m.id === id)
    store.resolveConfirmation(id, outcome)
    if (message?.type === 'confirmation') onConfirm?.(message.runId, outcome, message.proposalId)
  }

  return (
    <section className="cai-chat" aria-label={title}>
      <header className="cai-head">
        <div className="cai-headtext">
          <b>{title}</b>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {/* Says whether the answer will arrive as it is written or all at
            once. A window that animates typing on a buffered path is lying. */}
        {(state.busy || state.loading) && (
          <span className="cai-status" role="status">
            {state.loading ? 'catching up' : state.incremental ? 'answering' : 'working'}
          </span>
        )}
        <button type="button" className="cai-btn cai-ghost" onClick={() => store.reset()}>
          New
        </button>
        {onClose && (
          <button type="button" className="cai-btn cai-ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </header>

      {state.fault && (
        <div className="cai-fault" role="alert">
          {state.fault}
        </div>
      )}

      <MessageList
        messages={state.messages}
        widgets={widgets}
        send={(t) => void store.send(t)}
        onResolve={resolve}
        onAnswer={(id, reply) => void store.answer(id, reply)}
        emptyState={emptyState}
      />

      <Composer
        busy={state.busy}
        placeholder={placeholder}
        draftKey={draftKey}
        onSend={(t) => store.send(t)}
        onStop={() => void store.stop()}
      />
    </section>
  )
}
