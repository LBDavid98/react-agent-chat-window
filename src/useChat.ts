/* ============================================================================
 * useChat.ts — open/closed, the store, and the agent's own card, for a host
 * that wants them handed to it rather than assembled.
 * ========================================================================== */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ChatClient } from './client'
import type { AgentCard } from './contracts'
import { createChatStore, type ChatState, type ChatStore } from './store'

export interface ChatHandle {
  store: ChatStore
  state: ChatState
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
  /** The agent's roster entry, once it has been read. Null until then, and
   *  null if the roster could not be read — which is not worth a fault, since
   *  the conversation works without it. */
  card: AgentCard | null
  /** The agent's own opening line, from its declared persona.
   *
   *  Passed straight to `ChatWindow`'s empty state. The voice belongs to the
   *  agent, agent-side, where it can be changed without a frontend release —
   *  a greeting hardcoded here is this package deciding how somebody else's
   *  agent talks. Undefined when the agent declares none, in which case the
   *  host should say something neutral rather than inventing a character. */
  greeting?: string
}

export function useChat(
  client: ChatClient,
  agentId: string,
  options: { initiallyOpen?: boolean } = {},
): ChatHandle {
  const [open, setOpen] = useState(options.initiallyOpen ?? false)
  const [card, setCard] = useState<AgentCard | null>(null)
  // One store per (client, agent). Recreating it on every render would drop
  // the conversation, which is the bug this memo exists to prevent.
  const store = useMemo(() => createChatStore(client, agentId), [client, agentId])
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  useEffect(() => {
    let live = true
    client
      .agents()
      .then((agents) => {
        if (live) setCard(agents.find((a) => a.agent_id === agentId) ?? null)
      })
      // Deliberately swallowed. The roster is how the window learns the agent's
      // voice; failing to read it costs a greeting, not a conversation, and a
      // fault banner over a working chat window is a worse lie than a plain
      // empty state.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, agentId])

  return {
    store,
    state,
    open,
    setOpen,
    toggle: () => setOpen((o) => !o),
    card,
    greeting: card?.persona?.greeting,
  }
}
