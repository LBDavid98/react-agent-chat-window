import { describe as group, expect, it } from 'vitest'
import type { ChatClient, TurnInput } from './client'
import type { SessionRef, TranscriptEntry, TurnEvent } from './contracts'
import { fromTranscript } from './messages'
import { createChatStore } from './store'
import type { ClientToolRegistry } from './tools'

const SESSION: SessionRef = { session_id: 's1', agent_id: 'ada', streaming: 'buffered' }

function fake(over: Partial<ChatClient> = {}): ChatClient {
  return {
    agents: async () => [],
    openSession: async () => SESSION,
    transcript: async () => [],
    cancel: async () => undefined,
    // eslint-disable-next-line require-yield
    async *turn() {},
    ...over,
  }
}

function streaming(events: TurnEvent[]): Partial<ChatClient> {
  return {
    async *turn() {
      for (const e of events) yield e
    },
  }
}

group('reading the record back', () => {
  const entries: TranscriptEntry[] = [
    { seq: 1, role: 'operator', text: 'which agents are there?' },
    { seq: 2, role: 'tool', text: 'studio.list_agents' },
    { seq: 3, role: 'agent', text: 'Four of them.' },
    { seq: 4, role: 'system', text: 'session opened' },
    { seq: 5, role: 'agent', text: '   ' },
  ]

  it('renders the stored transcript rather than an empty panel', async () => {
    const store = createChatStore(fake({ transcript: async () => entries }), 'ada')
    await store.hydrate()
    expect(store.getState().messages.map((m) => m.type)).toEqual(['text', 'tool', 'text'])
  })

  it('can produce no live control, whatever the record contains', () => {
    // The persistence rule, read from the other end: replaying a confirmation
    // or an unanswered widget is what lets someone approve a write twice.
    const out = fromTranscript(entries)
    expect(out.some((m) => m.type === 'confirmation')).toBe(false)
    expect(out.some((m) => m.type === 'ask')).toBe(false)
  })

  it('settles a tool from the record — it is there, so it finished', () => {
    expect(fromTranscript(entries)[1]).toMatchObject({ type: 'tool', state: 'done' })
  })

  it('does not replay over a conversation already in progress', async () => {
    const store = createChatStore(
      fake({ transcript: async () => entries, ...streaming([{ kind: 'final', text: 'hi' }]) }),
      'ada',
    )
    await store.send('hello')
    await store.hydrate()
    expect(store.getState().messages.filter((m) => m.type === 'text')).toHaveLength(2)
  })
})

group('a turn the host never accepted', () => {
  const refuse = fake({
    // eslint-disable-next-line require-yield
    async *turn() {
      throw new Error('taking a turn failed (503): the gateway is not reachable')
    },
  })

  it('resolves false, so the composer keeps the words', async () => {
    expect(await createChatStore(refuse, 'ada').send('a long paragraph')).toBe(false)
  })

  it('leaves no message in the transcript that was never sent', async () => {
    const store = createChatStore(refuse, 'ada')
    await store.send('a long paragraph')
    expect(store.getState().messages).toEqual([])
  })

  it('surfaces the server own reason, not a generic one', async () => {
    const store = createChatStore(refuse, 'ada')
    await store.send('x')
    expect(store.getState().fault).toContain('the gateway is not reachable')
  })

  it('puts a refused widget reply back in play', async () => {
    // First turn puts a question up; the reply to it is refused. A widget left
    // inert after a failed reply is a question nobody can answer.
    let turns = 0
    const store = createChatStore(
      fake({
        async *turn() {
          turns += 1
          if (turns > 1) throw new Error('taking a turn failed (503)')
          yield { kind: 'awaiting_input', widget: { id: 'w', kind: 'choice', title: 'Which?' } }
        },
      }),
      'ada',
    )
    await store.send('ask me')
    const ask = store.getState().messages.find((m) => m.type === 'ask')!

    expect(await store.answer(ask.id, { widget_id: 'w', values: { value: 'a' } })).toBe(false)
    expect(store.getState().messages.find((m) => m.id === ask.id)).toMatchObject({
      type: 'ask',
      answered: undefined,
    })
  })
})

group('answering a widget', () => {
  const SPEC = {
    id: 'w',
    kind: 'choice' as const,
    title: 'Which model?',
    fields: [
      {
        name: 'value',
        label: 'Model',
        type: 'select' as const,
        options: [{ value: 'gpt-5.1', label: 'GPT-5.1' }],
      },
    ],
  }

  async function answered(): Promise<{ message?: string; reply?: unknown }> {
    let sent: { message?: string; reply?: unknown } = {}
    let turns = 0
    const store = createChatStore(
      fake({
        async *turn(_session, input) {
          turns += 1
          if (turns === 1) yield { kind: 'awaiting_input', widget: SPEC }
          else {
            sent = input
            yield { kind: 'final', text: 'ok' }
          }
        },
      }),
      'ada',
    )
    await store.send('ask me')
    const ask = store.getState().messages.find((m) => m.type === 'ask')!
    await store.answer(ask.id, { widget_id: 'w', values: { value: 'gpt-5.1' } })
    return sent
  }

  it('sends the typed values, so nothing has to parse a sentence', async () => {
    expect((await answered()).reply).toEqual({ widget_id: 'w', values: { value: 'gpt-5.1' } })
  })

  it('ALSO sends it in words, because the agent reads the transcript', async () => {
    // Without this the answer never reaches the record the model is shown, and
    // an answered widget is invisible to the agent that asked it: it asks, the
    // person picks, and from the agent's side nothing happened. The words are
    // the label that was read, not the value that was sent.
    expect((await answered()).message).toBe('GPT-5.1')
  })
})

group('a turn that started and then failed', () => {
  it('counts as accepted — the agent failed, the call did not', async () => {
    const store = createChatStore(
      fake(streaming([{ kind: 'turn_started' }, { kind: 'error', detail: 'no such node' }])),
      'ada',
    )
    expect(await store.send('do it')).toBe(true)
    expect(store.getState().messages.map((m) => m.type)).toEqual(['text', 'notice'])
  })
})

group('a turn that stops to ask the browser something', () => {
  // `tool_request` is terminal — there is genuinely nothing more coming until
  // the browser answers — but it is the one terminal kind that is not an
  // ENDING. Because isTerminal is true, the store's no-terminal-event fallback
  // never runs, so applyEvent has to settle it or the pulse never stops.
  const REQUEST: TurnEvent = {
    kind: 'tool_request',
    tool: 'ui.selected_node',
    call_id: 'c1',
    args: {},
  }

  /** A host that asks once, then answers. */
  function asksOnce(before: TurnEvent[] = []): { client: ChatClient; sent: TurnInput[] } {
    const sent: TurnInput[] = []
    let turns = 0
    const client = fake({
      async *turn(_session, input) {
        sent.push(input)
        turns += 1
        if (turns === 1) {
          for (const e of before) yield e
          yield REQUEST
        } else {
          yield { kind: 'final', text: 'It is the survey node.' }
        }
      },
    })
    return { client, sent }
  }

  const TOOLS: ClientToolRegistry = {
    'ui.selected_node': {
      description: 'The node the operator currently has selected on the canvas.',
      input_schema: { type: 'object', properties: {} },
      run: () => ({ node_id: 'survey', label: 'survey' }),
    },
  }

  it('stops the working pulse and leaves no blank bubble', async () => {
    const { client } = asksOnce()
    const store = createChatStore(client, 'ada')
    store.setTools(TOOLS)
    await store.send('which node am I on?')
    expect(store.getState().messages.filter((m) => m.type === 'text' && m.pending)).toEqual([])
  })

  it('renders it as no kind of failure — nothing went wrong', async () => {
    const { client } = asksOnce()
    const store = createChatStore(client, 'ada')
    store.setTools(TOOLS)
    await store.send('which node am I on?')
    expect(store.getState().messages.some((m) => m.type === 'notice')).toBe(false)
    expect(store.getState().fault).toBeNull()
  })

  it('keeps what the turn had already said before it asked', async () => {
    const { client } = asksOnce([{ kind: 'turn_started' }, { kind: 'partial', text: 'Let me look' }])
    const store = createChatStore(client, 'ada')
    store.setTools(TOOLS)
    await store.send('which node am I on?')
    expect(store.getState().messages.some((m) => m.type === 'text' && m.text === 'Let me look')).toBe(
      true,
    )
  })

  it('shows the operator that something ran in their own browser', async () => {
    // A tool acting on this page at an agent's request belongs in the same
    // place a server tool is, not inferred from an answer arriving later.
    const { client } = asksOnce()
    const store = createChatStore(client, 'ada')
    store.setTools(TOOLS)
    await store.send('which node am I on?')
    expect(store.getState().messages.find((m) => m.type === 'tool')).toMatchObject({
      tool: 'ui.selected_node',
      state: 'done',
      callId: 'c1',
    })
  })
})

group('running a tool the agent asked this browser for', () => {
  const REQUEST: TurnEvent = { kind: 'tool_request', tool: 'ui.focus', call_id: 'c9', args: { id: 'n1' } }

  function host(): { client: ChatClient; sent: TurnInput[] } {
    const sent: TurnInput[] = []
    let turns = 0
    const client = fake({
      async *turn(_session, input) {
        sent.push(input)
        turns += 1
        if (turns === 1) yield REQUEST
        else yield { kind: 'final', text: 'done' }
      },
    })
    return { client, sent }
  }

  it('answers with the tool result, on a new turn', async () => {
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({
      'ui.focus': {
        description: 'Focus a control.',
        input_schema: { type: 'object' },
        run: (args) => ({ focused: (args as { id: string }).id }),
      },
    })
    await store.send('focus n1')
    expect(sent).toHaveLength(2)
    expect(sent[1].toolResult).toEqual({
      call_id: 'c9',
      tool: 'ui.focus',
      result: { focused: 'n1' },
    })
  })

  it('refuses a tool it does not hold, with an error rather than silence', async () => {
    // From the model's side an unanswered request and a slow one look
    // identical, and it will simply wait.
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({})
    await store.send('focus n1')
    expect(sent[1].toolResult?.error).toContain('holds no tool named')
    expect(sent[1].toolResult?.result).toBeUndefined()
  })

  it('turns a throw into an error result rather than an unhandled rejection', async () => {
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({
      'ui.focus': {
        description: 'Focus a control.',
        input_schema: { type: 'object' },
        run: () => {
          throw new Error('no such control on this screen')
        },
      },
    })
    await store.send('focus n1')
    expect(sent[1].toolResult?.error).toBe('no such control on this screen')
    expect(store.getState().messages.find((m) => m.type === 'tool')).toMatchObject({
      state: 'failed',
      detail: 'no such control on this screen',
    })
  })

  it('declares its tools on EVERY turn, including ones that changed nothing', async () => {
    // The host does not remember the last set, on purpose.
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({
      'ui.focus': { description: 'Focus.', input_schema: { type: 'object' }, run: () => 1 },
    })
    await store.send('focus n1')
    expect(sent.map((t) => t.tools?.map((x) => x.name))).toEqual([['ui.focus'], ['ui.focus']])
  })

  it('declares the set as it is at the moment of the turn, not at mount', async () => {
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({ 'ui.a': { description: 'a', input_schema: {}, run: () => 1 } })
    store.setTools({ 'ui.focus': { description: 'b', input_schema: {}, run: () => 2 } })
    await store.send('focus n1')
    expect(sent[0].tools?.map((t) => t.name)).toEqual(['ui.focus'])
  })

  it('sends an empty declaration rather than omitting it', async () => {
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    await store.send('focus n1')
    expect(sent[0].tools).toEqual([])
  })

  it('sends no code over the wire — name, description and schema only', async () => {
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    store.setTools({
      'ui.focus': { description: 'Focus.', input_schema: { type: 'object' }, run: () => 1 },
    })
    await store.send('focus n1')
    expect(sent[0].tools).toEqual([
      { name: 'ui.focus', description: 'Focus.', input_schema: { type: 'object' } },
    ])
  })

  it('stops a model that has talked itself into a loop', async () => {
    // Each hop is a real HTTP turn and a real call into the page. Without a
    // brake this spins the operator's browser with no way to tell from outside
    // that it is stuck rather than working.
    let turns = 0
    const client = fake({
      async *turn() {
        turns += 1
        yield { kind: 'tool_request', tool: 'ui.focus', call_id: `c${turns}`, args: {} }
      },
    })
    const store = createChatStore(client, 'ada')
    store.setTools({
      'ui.focus': { description: 'Focus.', input_schema: {}, run: () => 1 },
    })
    await store.send('go')
    expect(turns).toBe(8)
    expect(store.getState().messages.at(-1)).toMatchObject({
      type: 'notice',
      text: 'Stopped after 8 tool round-trips.',
    })
    expect(store.getState().busy).toBe(false)
  })

  it('does not answer into a conversation that has been abandoned', async () => {
    // Abort is the mechanism, and it is the only one: there is no set of
    // outstanding call ids, because the answer is always built from a request
    // received moments earlier in the same chain.
    const { client, sent } = host()
    const store = createChatStore(client, 'ada')
    let started: (() => void) | null = null
    const ran = new Promise<void>((r) => {
      started = r
    })
    store.setTools({
      'ui.focus': {
        description: 'Focus.',
        input_schema: {},
        run: async () => {
          started?.()
          await new Promise((r) => setTimeout(r, 5))
          return 1
        },
      },
    })
    const sending = store.send('focus n1')
    await ran
    store.reset()
    await sending
    expect(sent).toHaveLength(1)
  })
})

group('a turn whose stream is cut without any terminal event', () => {
  // A truncated response or a proxy dropping the connection mid-turn. Distinct
  // from the group above: there, a terminal event arrived and applyEvent
  // settled it; here nothing arrives at all and the store's fallback does.
  const cut = (events: TurnEvent[]) => createChatStore(fake(streaming(events)), 'ada')

  it('leaves nothing pending', async () => {
    const store = cut([{ kind: 'turn_started' }])
    await store.send('what is wrong?')
    expect(store.getState().messages.filter((m) => m.type === 'text' && m.pending)).toEqual([])
  })

  it('keeps whatever the turn had already said', async () => {
    // A cut connection that erases what was on screen destroys what the person
    // was reading. Partial text stays; it just stops being pending.
    const store = cut([
      { kind: 'turn_started' },
      { kind: 'partial', text: 'Looking at the survey node' },
    ])
    await store.send('what is wrong?')
    expect(store.getState().messages.at(-1)).toMatchObject({
      text: 'Looking at the survey node',
      pending: false,
    })
  })

  it('adds no notice — a cut connection is not the agent failing', async () => {
    const store = cut([{ kind: 'turn_started' }, { kind: 'partial', text: 'Looking' }])
    await store.send('what is wrong?')
    expect(store.getState().messages.some((m) => m.type === 'notice')).toBe(false)
  })
})

group('a substituted model', () => {
  it('is carried onto the reply so the window can say so', async () => {
    const store = createChatStore(
      fake(
        streaming([
          { kind: 'turn_started' },
          { kind: 'final', text: 'done', model_served: 'grok-4.3', degraded_from: 'gpt-5.1' },
        ]),
      ),
      'ada',
    )
    await store.send('hi')
    expect(store.getState().messages.at(-1)).toMatchObject({
      served: { model: 'grok-4.3', insteadOf: 'gpt-5.1' },
    })
  })

  it('is absent on the common path, where they match', async () => {
    const store = createChatStore(
      fake(streaming([{ kind: 'turn_started' }, { kind: 'final', text: 'done' }])),
      'ada',
    )
    await store.send('hi')
    expect(store.getState().messages.at(-1)).not.toHaveProperty('served')
  })
})
