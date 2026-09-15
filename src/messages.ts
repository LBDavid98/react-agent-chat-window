/* ============================================================================
 * messages.ts — what the window renders, and what it is allowed to remember.
 *
 * THE PERSISTENCE RULE, carried over from Aurora's partner agent because it
 * was learned the hard way and is not obvious:
 *
 *   A persisted message is replayed verbatim on reload, so only message kinds
 *   whose render is a FAITHFUL, SIDE-EFFECT-FREE replay of real content may be
 *   stored. A widget whose buttons still work after a reload will happily let
 *   someone approve a write that was already approved, or re-run a proposal
 *   against state that has moved. A reload must never replay a lie.
 *
 * So `confirmation` is not persistable — its OUTCOME is, as a plain notice.
 * The transcript on the host is the record; this list is a view of it.
 * ========================================================================== */
import type { TranscriptEntry, TurnEvent, WidgetReply, WidgetSpec } from './contracts'

export type ChatRole = 'operator' | 'agent'

export interface BaseMessage {
  id: string
  role: ChatRole
}

export type ChatMessage =
  /** Something a person said, or the agent's reply. */
  | (BaseMessage & {
      type: 'text'
      text: string
      pending?: boolean
      /** Set only when the gateway substituted a model. See TurnEvent. */
      served?: { model: string; insteadOf?: string }
    })
  /** A tool the agent used. Rendered as it starts, not only when it finishes:
   *  a turn that goes quiet while a tool runs reads as a hung agent. */
  | (BaseMessage & {
      type: 'tool'
      tool: string
      effect?: 'read' | 'write'
      state: 'running' | 'done' | 'failed'
      detail?: string
      /** Set when this is a CLIENT tool the host asked this browser to run.
       *  Carried so the row can be finished precisely when the answer is known,
       *  rather than by matching on a name that may appear more than once. */
      callId?: string
    })
  /** A write the agent has proposed and is waiting on. NOT persistable. */
  | (BaseMessage & {
      type: 'confirmation'
      tool: string
      summary: string
      args?: Record<string, unknown>
      runId?: string
      /** Set when the proposal is stored host-side; a decision names this id
       *  and nothing else, so what was agreed to is exactly what runs. */
      proposalId?: string
      resolved?: 'approved' | 'denied'
    })
  /** A card the agent drew, and possibly a question inside it. A widget with
   *  no fields is showing; one with fields is asking. `answered` is set once a
   *  person has replied, which makes the controls inert — a widget that stays
   *  live after it has been answered invites answering it twice. */
  | (BaseMessage & {
      type: 'ask'
      spec: WidgetSpec
      answered?: WidgetReply
      /** The agent asked under this widget id again. The card stays in the
       *  stream — something was said and erasing it is worse — but its controls
       *  go dead. */
      superseded?: true
    })
  /** Something went wrong, or the turn was stopped. Always in plain language. */
  | (BaseMessage & { type: 'notice'; tone: 'error' | 'stopped'; text: string })
  /** A boundary between sittings in one long thread. */
  | (BaseMessage & { type: 'session'; label: string })
  /** A host application's own widget, resolved through the registry. */
  | (BaseMessage & { type: 'widget'; kind: string; payload: unknown })

/** Whether this message may be written to a store and replayed later.
 *
 *  See the rule at the top of this file. When in doubt the answer is no: the
 *  cost of forgetting a message is that someone scrolls; the cost of replaying
 *  a live control is that someone approves something twice. */
export function isPersistable(message: ChatMessage): boolean {
  // A confirmation carries a live run to resume. An UNANSWERED widget carries
  // live controls. Replaying either after a reload would let someone approve
  // a write twice, or answer a question whose turn has long since ended.
  if (message.type === 'confirmation') return false
  // Answered or superseded, either way there is no live control left to replay.
  if (message.type === 'ask') return message.answered !== undefined || message.superseded === true
  return true
}

let counter = 0
export function messageId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

/** Fold one turn event into the message list.
 *
 *  Returns a NEW list. Events are additive except where they resolve
 *  something already shown: a `tool_result` finishes the running tool row
 *  rather than adding a second one, and `final` fills in the pending reply
 *  rather than appending beside it. Anything else produces a UI that says the
 *  same thing twice.
 */
export function applyEvent(messages: ChatMessage[], event: TurnEvent): ChatMessage[] {
  switch (event.kind) {
    case 'turn_started':
      return [...messages, { id: messageId('a'), role: 'agent', type: 'text', text: '', pending: true }]

    case 'partial': {
      const next = [...messages]
      const index = lastPendingIndex(next)
      if (index === -1) return next
      const current = next[index] as Extract<ChatMessage, { type: 'text' }>
      next[index] = { ...current, text: current.text + (event.text ?? '') }
      return next
    }

    case 'tool_running':
      return [
        ...messages,
        {
          id: messageId('t'),
          role: 'agent',
          type: 'tool',
          tool: event.tool ?? 'a tool',
          state: 'running',
        },
      ]

    case 'tool_result': {
      const next = [...messages]
      const index = findLastIndex(
        next,
        (m) => m.type === 'tool' && m.state === 'running' && m.tool === event.tool,
      )
      const finished: ChatMessage = {
        id: index === -1 ? messageId('t') : next[index].id,
        role: 'agent',
        type: 'tool',
        tool: event.tool ?? 'a tool',
        effect: event.effect,
        state: event.detail ? 'failed' : 'done',
        detail: event.detail,
      }
      if (index === -1) return [...next, finished]
      next[index] = finished
      return next
    }

    case 'awaiting_input': {
      if (!event.widget) return messages
      const id = event.widget.id
      // An agent that asks again under the same widget id has asked a NEW
      // question — the host replaces the spec it kept, and describes any answer
      // against the new one. So the old card must stop being answerable, or a
      // person can answer a question that no longer exists and have it read
      // back through the wrong labels. Two live cards under one id is also
      // simply two questions the agent cannot tell apart.
      const settled = settlePending(messages).map((m) =>
        m.type === 'ask' && m.spec.id === id && m.answered === undefined
          ? { ...m, superseded: true as const }
          : m,
      )
      return [...settled, { id: messageId('w'), role: 'agent', type: 'ask', spec: event.widget }]
    }

    case 'awaiting_confirmation':
      return [
        ...dropPending(messages),
        {
          id: messageId('c'),
          role: 'agent',
          type: 'confirmation',
          tool: event.tool ?? '',
          summary: event.summary ?? '',
          args: event.args,
          runId: event.run_id,
          proposalId: event.proposal_id,
        },
      ]

    case 'final': {
      const next = [...messages]
      const index = lastPendingIndex(next)
      const text = event.text ?? ''
      if (index === -1) {
        return text ? [...next, { id: messageId('a'), role: 'agent', type: 'text', text }] : next
      }
      if (!text && !(next[index] as { text: string }).text) {
        // A turn that produced nothing leaves nothing. An empty bubble is a
        // visible defect; a placeholder pretending to be an answer is worse.
        next.splice(index, 1)
        return next
      }
      const current = next[index] as Extract<ChatMessage, { type: 'text' }>
      next[index] = {
        ...current,
        text: text || current.text,
        pending: false,
        ...(event.model_served
          ? { served: { model: event.model_served, insteadOf: event.degraded_from } }
          : {}),
      }
      return next
    }

    case 'tool_request': {
      // Terminal, but NOT an ending: the turn stopped to ask the browser to run
      // something, and the answer arrives as the next turn. So it settles the
      // pending reply exactly as a real ending would — partial text stays, an
      // empty bubble goes — and adds no notice, because nothing went wrong.
      //
      // Handling it here rather than only in the store's no-terminal-event
      // fallback is the point: `isTerminal` is true for this kind, so that
      // fallback never runs, and without this case the pending reply keeps its
      // working pulse forever.
      //
      // And it leaves a row. Something ran in the operator's own browser at an
      // agent's request; that should be visible in the same place a server
      // tool is, not inferred from an answer arriving a moment later.
      return [
        ...settlePending(messages),
        {
          id: messageId('t'),
          role: 'agent',
          type: 'tool',
          tool: event.tool ?? 'a tool',
          state: 'running',
          callId: event.call_id,
        },
      ]
    }

    case 'interrupted':
      return [
        ...settlePending(messages),
        {
          id: messageId('n'),
          role: 'agent',
          type: 'notice',
          tone: 'stopped',
          text: event.detail || 'Stopped.',
        },
      ]

    case 'error':
      return [
        ...settlePending(messages),
        {
          id: messageId('n'),
          role: 'agent',
          type: 'notice',
          tone: 'error',
          text: event.detail || 'That turn failed.',
        },
      ]

    default:
      return messages
  }
}

/** A stored transcript, as messages.
 *
 *  THE PERSISTENCE RULE, READ FROM THE OTHER END. Everything this produces is a
 *  faithful, side-effect-free replay of something that already happened: text
 *  that was said, and a tool that finished. It can produce no `confirmation`
 *  and no unanswered `ask`, because a live control replayed out of a record is
 *  exactly what lets someone approve a write that was approved days ago. That
 *  is not a check performed here; it is a shape this function cannot express.
 */
export function fromTranscript(entries: TranscriptEntry[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const entry of entries) {
    const text = entry.text?.trim()
    if (!text) continue
    if (entry.role === 'operator' || entry.role === 'agent') {
      out.push({ id: messageId('h'), role: entry.role, type: 'text', text })
    } else if (entry.role === 'tool') {
      // Settled by definition: it is in the record, so it finished. The entry
      // carries no effect, and guessing one would put a `write` glyph on a read.
      out.push({ id: messageId('h'), role: 'agent', type: 'tool', tool: text, state: 'done' })
    }
    // `system` is skipped. A system entry's meaning is the host's, and rendering
    // one as prose or as a notice would be this package deciding what it meant.
    // Leaving it out loses a line; guessing wrong puts words in the agent's mouth.
  }
  return out
}

function findLastIndex(list: ChatMessage[], match: (m: ChatMessage) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (match(list[i])) return i
  return -1
}

function lastPendingIndex(list: ChatMessage[]): number {
  return findLastIndex(list, (m) => m.type === 'text' && m.pending === true)
}

/** Drop a pending reply that produced no text. */
function dropPending(list: ChatMessage[]): ChatMessage[] {
  const index = lastPendingIndex(list)
  if (index === -1) return list
  const pending = list[index] as Extract<ChatMessage, { type: 'text' }>
  if (pending.text) return settlePending(list)
  const next = [...list]
  next.splice(index, 1)
  return next
}

/** Close out a turn whose stream ended without a terminal event.
 *
 *  Normally `final`, `interrupted` or `error` settles the pending reply. A
 *  stream can end without any of them: the host ends the turn on
 *  `tool_request` and waits for the client to answer in the next one, and a
 *  truncated response or a proxy cutting the connection looks the same from
 *  here. Left alone, the empty pending bubble keeps its working pulse forever
 *  — the spinner that spins forever, from a direction §5 does not name.
 *
 *  No notice is added. On the `tool_request` path nothing went wrong, and an
 *  error banner on a normal turn is a worse lie than a quiet ending. */
export function settleTurn(list: ChatMessage[]): ChatMessage[] {
  return settlePending(list)
}

/** Keep whatever a stopped or failed turn had already said.
 *
 *  A stop that erases what was already on screen destroys work the person was
 *  reading. Partial text stays; it just stops being pending. */
function settlePending(list: ChatMessage[]): ChatMessage[] {
  const index = lastPendingIndex(list)
  if (index === -1) return list
  const next = [...list]
  const pending = next[index] as Extract<ChatMessage, { type: 'text' }>
  if (!pending.text) {
    next.splice(index, 1)
    return next
  }
  next[index] = { ...pending, pending: false }
  return next
}

/** What was chosen, in words — the twin of the SDK's `describe_reply`.
 *
 *  A widget that collapses to `{"value": "n-2"}` after answering tells the
 *  next reader nothing. Labels come back out of the spec.
 *
 *  Two readers, and they want the same string. It is the inert card's summary
 *  line, and it is the `message` the store sends alongside the typed `reply` —
 *  because the agent reads the TRANSCRIPT, and a transcript in which the
 *  person's answer never appears is one where an answered widget is invisible
 *  to the agent that asked it. Which is why this lives here, in a module with
 *  no React in it, rather than beside the component that draws the card. */
export function describe(spec: WidgetSpec, reply: WidgetReply): string {
  // A proposal carries no fields — its two answers are fixed by the renderer,
  // so there are no option labels to look them up in.
  if (spec.kind === 'propose_alternative') {
    // Whole sentences, not 'alternative'. This is what the agent reads back as
    // the thing the person said, and a bare enum value is not something anyone
    // said. The two fixed answers are the renderer's; so is their wording.
    return reply.values.value === 'alternative' ? 'Do it your way.' : 'Go ahead as I asked.'
  }
  const fields = spec.fields ?? []
  const parts: string[] = []
  for (const f of fields) {
    if (!(f.name in reply.values)) continue
    const raw = reply.values[f.name]
    const labels = new Map((f.options ?? []).map((o) => [o.value, o.label ?? o.value]))
    const shown = Array.isArray(raw)
      ? raw.map((v) => labels.get(String(v)) ?? String(v)).join(', ')
      : (labels.get(String(raw)) ?? String(raw))
    parts.push(fields.length === 1 ? shown : `${f.label}: ${shown}`)
  }
  return parts.join(' · ')
}
