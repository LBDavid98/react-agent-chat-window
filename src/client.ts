/* ============================================================================
 * client.ts — how the window talks to an agent host.
 *
 * `ChatClient` is an INTERFACE first and an implementation second. A host app
 * that already has its own fetch conventions (a mount prefix, a credential, a
 * proxy) supplies its own; the bundled one is a convenience, not a
 * requirement. This is the seam that keeps the window usable in an app whose
 * API lives somewhere this package could never have guessed.
 * ========================================================================== */
import type {
  AgentCard,
  ClientTool,
  SessionRef,
  ToolResult,
  TranscriptEntry,
  TurnEvent,
  WidgetReply,
} from './contracts'
import { isTerminal } from './contracts'

export interface ChatClient {
  agents(): Promise<AgentCard[]>
  openSession(agentId: string, modality?: string): Promise<SessionRef>
  transcript(sessionId: string): Promise<TranscriptEntry[]>
  cancel(sessionId: string): Promise<void>
  /** One turn, as an async stream of events. The last event is terminal.
   *
   *  Takes a message, a widget reply, OR the answer to a `tool_request`.
   *  Answering a widget sends typed values keyed by field name, so nothing on
   *  the far side has to turn a sentence back into a value whose shape it
   *  already knew.
   *
   *  `tools` goes on EVERY turn, including turns that declare the same set as
   *  the last one. The host does not remember the previous declaration, on
   *  purpose: in a routed app the tools that make sense over a canvas are not
   *  the ones that make sense in a library, and a set remembered from session
   *  open goes stale the first time somebody navigates. */
  turn(
    session: SessionRef,
    input: TurnInput,
    signal?: AbortSignal,
  ): AsyncIterable<TurnEvent>
}

/** Prefix every path, the way an app mounted under a sub-path must.
 *
 *  A bare `/v1/...` resolves against the domain root, which under a mount
 *  prefix is somebody else's application answering with HTML. That failure
 *  looks like a JSON parse error a long way from its cause. */
function join(base: string, path: string): string {
  const root = base.replace(/\/$/, '')
  return `${root}${path.startsWith('/') ? path : `/${path}`}`
}

async function readJson(res: Response, what: string): Promise<unknown> {
  if (!res.ok) {
    // The server's own reason, when it gave one. "HTTP 409" tells a person
    // nothing they can act on; "session expired after 8:00:00 idle" does.
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown }
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? '')
    } catch {
      detail = res.statusText
    }
    throw new Error(`${what} failed (${res.status}): ${detail}`)
  }
  return res.json()
}

/** What a turn carries up. Exactly one of message / reply / toolResult is the
 *  reason for the turn; `tools` rides along on all of them. */
export interface TurnInput {
  message?: string
  reply?: WidgetReply
  toolResult?: ToolResult
  tools?: ClientTool[]
}

export interface HttpChatClientOptions {
  /** Where the host lives. Under a mount prefix, include it. */
  baseUrl?: string
  /** Extra headers — a bearer, a request id. Never logged by this package. */
  headers?: Record<string, string>
}

/** The bundled client: one `fetch` per call, and `fetch` streaming for a turn.
 *
 *  Deliberately NOT `EventSource`: it cannot POST, cannot carry headers, and a
 *  turn is a POST with a body. Reading the stream off `fetch` costs a few
 *  lines of framing and keeps the request shape honest. */
export function createHttpChatClient(options: HttpChatClientOptions = {}): ChatClient {
  const base = options.baseUrl ?? ''
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }

  return {
    async agents() {
      const res = await fetch(join(base, '/v1/agents'), { headers })
      const body = (await readJson(res, 'listing agents')) as { agents?: AgentCard[] }
      return body.agents ?? []
    },

    async openSession(agentId, modality = 'text') {
      const res = await fetch(join(base, `/v1/agents/${encodeURIComponent(agentId)}/sessions`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ modality }),
      })
      return (await readJson(res, 'opening a session')) as SessionRef
    },

    async transcript(sessionId) {
      const res = await fetch(join(base, `/v1/sessions/${encodeURIComponent(sessionId)}`), {
        headers,
      })
      const body = (await readJson(res, 'reading the transcript')) as {
        transcript?: TranscriptEntry[]
      }
      return body.transcript ?? []
    },

    async cancel(sessionId) {
      await fetch(join(base, `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`), {
        method: 'POST',
        headers,
      })
    },

    async *turn(session, input, signal) {
      const res = await fetch(
        join(base, `/v1/agents/${encodeURIComponent(session.agent_id)}/turns?stream=1`),
        {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            session_id: session.session_id,
            message: input.message ?? '',
            ...(input.reply ? { reply: input.reply } : {}),
            ...(input.toolResult ? { tool_result: input.toolResult } : {}),
            // Sent even when empty, so "this window has no tools right now" is
            // said rather than left to be inferred from an absent field.
            client_tools: input.tools ?? [],
          }),
        },
      )
      if (!res.ok || !res.body) {
        await readJson(res, 'taking a turn')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE frames are separated by a blank line. Anything short of one is
        // an incomplete frame, and parsing it would produce a truncated event.
        let split = buffer.indexOf('\n\n')
        while (split !== -1) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const event = parseFrame(frame)
          if (event) {
            yield event
            // Stop at the first terminal event. A reader that kept going
            // would deliver the next turn's events into this one.
            if (isTerminal(event)) return
          }
          split = buffer.indexOf('\n\n')
        }
      }
    },
  }
}

/** One SSE frame → one event, or nothing.
 *
 *  Only `data:` is read. Every event carries its own `kind` inside the JSON,
 *  and parsing the framing too would mean two sources of truth for what an
 *  event is. A comment line (a keepalive) and a frame that will not parse are
 *  both skipped rather than thrown on: one bad frame must not abort a stream
 *  that is otherwise delivering. */
function parseFrame(frame: string): TurnEvent | null {
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const parsed = JSON.parse(line.slice(5).trim()) as TurnEvent
      if (parsed && typeof parsed.kind === 'string') return parsed
    } catch {
      return null
    }
  }
  return null
}
