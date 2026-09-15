/* ============================================================================
 * store.ts — the conversation's state, outside React.
 *
 * A module-level store read through `useSyncExternalStore`, not a context and
 * not a state library. Two reasons: a turn arrives from a stream that outlives
 * any one component, and the host apps this drops into ship no state library
 * and should not have to adopt one to embed a chat window.
 * ========================================================================== */
import type { ChatClient, TurnInput } from './client'
import { isTerminal } from './contracts'
import type { ClientTool, SessionRef, ToolResult, TurnEvent, WidgetReply } from './contracts'
import type { ChatMessage } from './messages'
import { applyEvent, describe, fromTranscript, messageId, settleTurn } from './messages'
import { declareTools, type ClientToolRegistry } from './tools'

/** How many times a single ask may bounce between the model and this browser
 *  before we stop it.
 *
 *  Not a guess at a reasonable depth — it is a brake. Each hop is a real HTTP
 *  turn and a real call into the page, so a model that has talked itself into a
 *  loop would otherwise spin the operator's browser indefinitely with no way to
 *  tell from the outside that it was stuck rather than working. */
const MAX_TOOL_HOPS = 8

export interface ChatState {
  agentId: string
  session: SessionRef | null
  messages: ChatMessage[]
  /** True from the moment a turn is sent until its terminal event. */
  busy: boolean
  /** Whether this path actually streams. `false` means the answer arrives
   *  whole, and the window renders a working indicator instead of a typing
   *  animation that would be a lie. */
  incremental: boolean
  /** The last thing that went wrong at the transport level, in the server's
   *  own words. Distinct from an `error` turn event, which is the agent's
   *  turn failing rather than the call failing. */
  fault: string | null
  /** True while the stored transcript is being read back on open. Distinct
   *  from `busy`, which is a turn: one is the past arriving, the other is the
   *  present being made, and a window that conflates them says "working" at
   *  someone who has not asked anything yet. */
  loading: boolean
}

export interface ChatStore {
  subscribe(listener: () => void): () => void
  getState(): ChatState
  /** Open a session if there is not one. Safe to call repeatedly. */
  ensureSession(): Promise<SessionRef>
  /** Read the host's stored transcript into the message list.
   *
   *  The host's transcript is the record; this list is a view of it. Without
   *  this, reopening the window shows an empty panel until the next turn — a
   *  conversation that vanishes on refresh is not a conversation. Safe to call
   *  repeatedly; it does nothing once there are messages. */
  hydrate(): Promise<void>
  /** Take a turn. Resolves TRUE when the host accepted it.
   *
   *  The boolean is load-bearing: the composer holds the operator's words until
   *  it hears one. A message lost to a failed send is the failure that costs
   *  someone their sentence. */
  send(message: string): Promise<boolean>
  /** Answer a widget the agent put up. Records what was chosen, then takes the
   *  next turn carrying typed values rather than a sentence. */
  answer(messageId: string, reply: WidgetReply): Promise<boolean>
  stop(): Promise<void>
  /** Replace the tools this window offers for one SCOPE. Called whenever the
   *  host's registry changes; the current set is read fresh on every turn.
   *
   *  `scope` is the declaring app's id (ENG-AH-020): a second app's tools
   *  land in their own scope and merge at declaration time. Bespoke names in
   *  a named scope must arrive `<scope>.`-prefixed (validate_manifest
   *  enforces the same server-side); bare `ux.*` names stay unscoped because
   *  they mean the same thing in every app. Omitting `scope` keeps the
   *  original single-app behavior. Nothing about the wire changes — the
   *  declaration is still one sorted, flat list (ENG-AH-020 B2/B3). */
  setTools(registry: ClientToolRegistry | undefined, scope?: string): void
  /** What the next turn will declare, exactly — the merged, sorted view of
   *  every scope. Read-only; useful to a host page showing the agent's
   *  current reach, and to tests proving the merge. */
  declaredTools(): ClientTool[]
  /** Record how a proposal was resolved. Resuming the run is the host app's
   *  job: it owns the credential and the resume route, and a second resume
   *  implementation in a UI package would be a second thing to keep correct. */
  resolveConfirmation(id: string, outcome: 'approved' | 'denied'): void
  reset(): void
}

export function createChatStore(client: ChatClient, agentId: string): ChatStore {
  let state: ChatState = {
    agentId,
    session: null,
    messages: [],
    busy: false,
    incremental: false,
    fault: null,
    loading: false,
  }
  const listeners = new Set<() => void>()
  let opening: Promise<SessionRef> | null = null
  let controller: AbortController | null = null
  /** The tools this browser currently offers, per declaring scope. Within a
   *  scope: replaced, never merged — a registry that only ever grew would
   *  re-offer a tool the host app has navigated away from. Across scopes:
   *  merged at declaration time, so a second app's tools have somewhere to
   *  land (ENG-AH-020). */
  const toolScopes = new Map<string, ClientToolRegistry>()

  function mergedTools(): ClientToolRegistry | undefined {
    if (toolScopes.size === 0) return undefined
    const merged: ClientToolRegistry = {}
    for (const registry of toolScopes.values()) Object.assign(merged, registry)
    return merged
  }

  function set(patch: Partial<ChatState>): void {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  async function ensureSession(): Promise<SessionRef> {
    if (state.session) return state.session
    // One in-flight open, shared. Two components mounting at once must not
    // each start a conversation and leave one of them orphaned.
    if (!opening) {
      opening = client
        .openSession(agentId)
        .then((session) => {
          set({
            session,
            incremental: session.streaming === 'incremental',
            fault: null,
          })
          return session
        })
        .finally(() => {
          opening = null
        })
    }
    return opening
  }

  /** One request and the stream it answers with.
   *
   *  Returns whether the host ACCEPTED the turn — whether any event arrived —
   *  and the `tool_request` it ended on, if it ended on one.
   *
   *  "Accepted" is deliberately the first event and not the last: a turn that
   *  starts and then errors is the agent failing, which belongs in the
   *  transcript. A turn that never starts is the call failing, and the words
   *  that went with it were never delivered anywhere. Only the second is
   *  something to hand back to the person who typed it. */
  async function deliver(
    input: TurnInput,
    signal: AbortSignal,
  ): Promise<{ accepted: boolean; request: TurnEvent | null }> {
    let accepted = false
    let ended = false
    let request: TurnEvent | null = null
    try {
      const session = await ensureSession()
      // Declared HERE, at the moment the turn goes out, and never captured
      // earlier. The registry is a prop in a routed app: the tools that make
      // sense over a canvas are not the ones that make sense in a library, and
      // a set read at session open goes stale the first time somebody
      // navigates.
      const carried: TurnInput = { ...input, tools: declareTools(mergedTools()) }
      for await (const event of client.turn(session, carried, signal)) {
        accepted = true
        ended = isTerminal(event)
        if (event.kind === 'tool_request' && event.call_id) request = event
        set({ messages: applyEvent(state.messages, event) })
      }
    } catch (error) {
      // The transport failed, which is not the same as the agent failing.
      // Named separately, in the server's own words: "HTTP 409" tells a person
      // nothing they can act on.
      set({ fault: error instanceof Error ? error.message : String(error) })
    } finally {
      // A stream can end without a terminal event — a truncated response, a
      // proxy cutting the connection. Without this the pending reply keeps its
      // working pulse forever.
      if (!ended) set({ messages: settleTurn(state.messages) })
    }
    return { accepted, request }
  }

  /** Run what the host asked this browser to run, and say what happened.
   *
   *  Always returns an answer or nothing — never silence with the turn left
   *  open. A tool this window does not hold is refused with an error rather
   *  than ignored, because from the model's side an unanswered request and a
   *  slow one look identical and it will simply wait. */
  async function answerRequest(event: TurnEvent): Promise<ToolResult | null> {
    const callId = event.call_id ?? ''
    const name = event.tool ?? ''
    const definition = mergedTools()?.[name]
    let answer: ToolResult

    if (!definition) {
      answer = {
        call_id: callId,
        tool: name,
        error: `this window holds no tool named ${JSON.stringify(name)}`,
      }
    } else {
      try {
        answer = { call_id: callId, tool: name, result: await definition.run(event.args ?? {}) }
      } catch (error) {
        // A throw is an answer. A panel that dies instead tells the model
        // nothing, and the model waits for a turn that never comes.
        answer = {
          call_id: callId,
          tool: name,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    // "Only answer what you were asked" holds BY CONSTRUCTION here: the only
    // ToolResult this file ever builds is built from a `tool_request` event
    // received moments earlier in the same chain, and an abandoned chain is
    // stopped by its own AbortSignal before it can send. There is deliberately
    // no set of outstanding call ids — one would be unreachable defence, and
    // untested defence is a liability rather than a safeguard.
    //
    // It stops holding the moment a SECOND way to produce a result exists — a
    // retry, a queue, tools running concurrently. Whoever adds one owes the
    // check the host already makes: refuse a call_id nobody asked for.
    set({
      messages: state.messages.map((m) =>
        m.type === 'tool' && m.callId === callId
          ? { ...m, state: answer.error ? ('failed' as const) : ('done' as const), detail: answer.error }
          : m,
      ),
    })
    return answer
  }

  /** A turn, and any tool round-trips it sets off, as one busy stretch.
   *
   *  `busy` spans the whole chain rather than flickering per hop: from the
   *  operator's side one question is being answered, however many times the
   *  model had to ask this browser something to answer it. */
  async function take(input: TurnInput): Promise<boolean> {
    set({ busy: true, fault: null })
    const own = new AbortController()
    controller = own
    let accepted = false
    try {
      let next: TurnInput | null = input
      // The abort check is on the LOOP rather than beside each send, so there
      // is one place a stopped or reset conversation ends a chain — including
      // one whose tool was still running when it was abandoned.
      for (let hop = 0; next && !own.signal.aborted; hop += 1) {
        const outcome = await deliver(next, own.signal)
        // Only the first hop is the operator's turn. Whether a later tool
        // round-trip was accepted is not what the composer is waiting on.
        if (hop === 0) accepted = outcome.accepted
        next = null
        if (!outcome.request || own.signal.aborted) break
        if (hop + 1 >= MAX_TOOL_HOPS) {
          set({
            messages: [
              ...state.messages,
              {
                id: messageId('n'),
                role: 'agent',
                type: 'notice',
                tone: 'stopped',
                text: `Stopped after ${MAX_TOOL_HOPS} tool round-trips.`,
              },
            ],
          })
          break
        }
        const answer = await answerRequest(outcome.request)
        if (answer) next = { toolResult: answer }
      }
    } finally {
      if (controller === own) controller = null
      set({ busy: false })
    }
    return accepted
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getState() {
      return state
    },

    ensureSession,

    async hydrate() {
      // Once. A second call after the conversation has started would replay the
      // stored copy of messages already on screen.
      if (state.messages.length || state.loading) return
      set({ loading: true })
      try {
        const session = await ensureSession()
        const entries = await client.transcript(session.session_id)
        // Re-checked after the await: a turn may have started while the read
        // was in flight, and the record is older than what is on screen.
        if (!state.messages.length) set({ messages: fromTranscript(entries) })
      } catch (error) {
        set({ fault: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ loading: false })
      }
    },

    async send(text) {
      const message = text.trim()
      if (!message || state.busy) return false
      const id = messageId('u')
      set({
        messages: [...state.messages, { id, role: 'operator', type: 'text', text: message }],
      })
      const accepted = await take({ message })
      // A message the host never accepted must not sit in the transcript
      // looking as though it was sent. It goes back to the composer instead,
      // which still has it — see `Composer`, which clears on acceptance only.
      if (!accepted) set({ messages: state.messages.filter((m) => m.id !== id) })
      return accepted
    },

    async answer(id, reply) {
      if (state.busy) return false
      const asked = state.messages.find((m) => m.id === id)
      // Marked answered BEFORE the turn goes out, so the controls cannot be
      // used twice while the reply is in flight.
      set({
        messages: state.messages.map((m) =>
          m.id === id && m.type === 'ask' ? { ...m, answered: reply } : m,
        ),
      })
      // BOTH HALVES GO, and this is load-bearing rather than belt-and-braces.
      //
      //   `reply`   the typed values, so nothing has to turn a sentence back
      //             into a value whose shape it already knew.
      //   `message` the same answer in words, because what an agent actually
      //             reads is the TRANSCRIPT, and an answer that never appears
      //             there is an answered widget the agent cannot see. It asks,
      //             the person picks, and from the agent's side nothing
      //             happened.
      //
      // The words are `describe(spec, reply)` — the same string the inert card
      // shows, so the record and the screen cannot disagree about what was
      // chosen.
      const said = asked?.type === 'ask' ? describe(asked.spec, reply) : ''
      const accepted = await take({ message: said, reply })
      // Refused: the question was never answered, so it goes live again. A
      // widget left inert after a failed reply is a question nobody can answer.
      if (!accepted) {
        set({
          messages: state.messages.map((m) =>
            m.id === id && m.type === 'ask' ? { ...m, answered: undefined } : m,
          ),
        })
      }
      return accepted
    },
    async stop() {
      controller?.abort()
      const session = state.session
      if (session) await client.cancel(session.session_id)
      set({ busy: false })
    },

    resolveConfirmation(id, outcome) {
      set({
        messages: state.messages.map((m) =>
          m.id === id && m.type === 'confirmation' ? { ...m, resolved: outcome } : m,
        ),
      })
    },

    setTools(registry, scope = '') {
      if (!registry) {
        toolScopes.delete(scope)
        return
      }
      if (scope) {
        for (const name of Object.keys(registry)) {
          if (!name.startsWith('ux.') && !name.startsWith(`${scope}.`)) {
            // The same rule validate_manifest enforces server-side: two apps
            // both declaring `search` could never be told apart.
            throw new Error(
              `client tool '${name}' in scope '${scope}' must be ` +
                `'${scope}.'-prefixed (bare ux.* names are the one exemption)`,
            )
          }
        }
      }
      toolScopes.set(scope, registry)
    },

    declaredTools() {
      return declareTools(mergedTools())
    },

    reset() {
      // Aborts the chain, which is also what stops a tool round-trip in flight
      // from answering a conversation that no longer exists.
      controller?.abort()
      controller = null
      set({ session: null, messages: [], busy: false, fault: null, loading: false })
    },
  }
}
