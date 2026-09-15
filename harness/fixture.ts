/* ============================================================================
 * fixture.ts — one of everything, so a look at the page is a look at the whole
 * surface.
 *
 * It supplies a ChatStore rather than a ChatClient. `ChatStore` is an
 * interface, so a fake one drives the real ChatWindow, MessageList, Widget and
 * stylesheet with no transport in the way — and, unlike a scripted client, it
 * can produce the two message kinds no turn event makes: a `session` marker and
 * a host's own registered `widget`. A harness that could not show those would
 * be checking most of the window and reporting on all of it.
 * ========================================================================== */
import type { ChatMessage, ChatState, ChatStore, WidgetSpec } from '../src'

const ask = (id: string, spec: Omit<WidgetSpec, 'id'>): ChatMessage => ({
  id,
  role: 'agent',
  type: 'ask',
  spec: { id, ...spec },
})

export const DEMO: ChatMessage[] = [
  { id: 'm1', role: 'agent', type: 'session', label: 'Yesterday, 4:12pm' },
  { id: 'm2', role: 'operator', type: 'text', text: 'Which agents are in this studio?' },
  { id: 'm3', role: 'agent', type: 'tool', tool: 'studio.list_agents', effect: 'read', state: 'done' },
  {
    id: 'm4',
    role: 'agent',
    type: 'text',
    text: 'Four: Ada, the compose-draft pair, and the QA grader.\nAda is the only one on the roster with studio tools.',
  },
  { id: 'm5', role: 'agent', type: 'session', label: 'Today, 9:03am' },
  { id: 'm6', role: 'operator', type: 'text', text: 'Show me the failing nodes.' },
  { id: 'm7', role: 'agent', type: 'tool', tool: 'studio.read_design', effect: 'read', state: 'running' },
  {
    id: 'm8',
    role: 'agent',
    type: 'tool',
    tool: 'vault.search',
    effect: 'read',
    state: 'failed',
    detail: 'refused: no such collection "drafts-2024"',
  },

  /* ---- every widget body -------------------------------------------------- */
  ask('w-table', {
    kind: 'table',
    title: 'Nodes that failed last run',
    sub: 'run 8fc21a, 12 minutes ago',
    body: {
      columns: [
        { key: 'node', label: 'Node' },
        { key: 'kind', label: 'Type' },
        { key: 'ms', label: 'Took', align: 'number' },
      ],
      rows: [
        ['survey', 'tool_call', 4120],
        ['reason', 'model_call', 9877],
        ['gate', 'approval', 12],
      ],
    },
    fields: [
      {
        name: 'value',
        label: 'Which one should I look at?',
        type: 'select',
        required: true,
        options: [
          { value: 'survey', label: 'survey', hint: 'timed out reaching the studio' },
          { value: 'reason', label: 'reason', hint: 'the model returned nothing' },
          { value: 'gate', label: 'gate' },
        ],
      },
    ],
  }),
  ask('w-metrics', {
    kind: 'metrics',
    title: 'This week',
    body: {
      metrics: [
        { label: 'Runs', value: '312' },
        { label: 'Passed', value: '289', tone: 'good' },
        { label: 'Degraded', value: '18', tone: 'warn', hint: 'model substituted' },
        { label: 'Failed', value: '5', tone: 'bad' },
      ],
    },
  }),
  ask('w-bars', {
    kind: 'bars',
    title: 'Time by node',
    body: {
      bars: [
        { label: 'reason', value: 9877, hint: 'gpt-4o-mini' },
        { label: 'survey', value: 4120 },
        { label: 'gate', value: 12 },
      ],
    },
  }),
  ask('w-timeline', {
    kind: 'timeline',
    title: 'Run 8fc21a',
    body: {
      steps: [
        { label: 'start', at: '09:03:01', state: 'done' },
        { label: 'survey', at: '09:03:05', state: 'done' },
        { label: 'reason', at: '09:03:15', state: 'current' },
        { label: 'gate', state: 'todo' },
        { label: 'end', state: 'failed' },
      ],
    },
  }),
  ask('w-code', {
    kind: 'code',
    title: 'The node as it stands',
    body: {
      language: 'json',
      text: '{\n  "id": "survey",\n  "type": "tool_call",\n  "tool": "studio.list_agents",\n  "args": {}\n}',
    },
  }),
  ask('w-diff', {
    kind: 'diff',
    title: 'Proposed change to survey',
    body: {
      before: '"timeout_ms": 5000',
      after: '"timeout_ms": 20000',
    },
    fields: [
      {
        name: 'value',
        label: 'Apply it?',
        type: 'select',
        options: [
          { value: 'apply', label: 'Apply' },
          { value: 'discard', label: 'Discard' },
        ],
      },
    ],
  }),
  ask('w-markdown', {
    kind: 'markdown',
    title: 'What I would do',
    body: {
      text: 'Raise the timeout and re-run. If it fails again the studio is unreachable, not slow, and the next thing to check is the mesh route rather than this node.',
    },
  }),

  /* ---- every widget question ---------------------------------------------- */
  ask('w-choice', {
    kind: 'choice',
    title: 'Which model should reason use?',
    fields: [
      {
        name: 'value',
        label: 'Model',
        type: 'select',
        required: true,
        options: [
          { value: 'gpt-4o-mini', label: 'gpt-4o-mini', hint: 'the current one' },
          { value: 'gpt-5.1', label: 'gpt-5.1' },
          { value: 'grok-4.3', label: 'grok-4.3' },
        ],
      },
    ],
  }),
  ask('w-multi', {
    kind: 'multi_choice',
    title: 'Which nodes should I re-run?',
    submit_label: 'Choose',
    fields: [
      {
        name: 'value',
        label: 'Nodes',
        type: 'select',
        options: [
          { value: 'survey', label: 'survey' },
          { value: 'reason', label: 'reason' },
          { value: 'gate', label: 'gate' },
        ],
      },
    ],
  }),
  ask('w-form', {
    kind: 'form',
    title: 'New knowledge node',
    submit_label: 'Send',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'vault-lookup' },
      { name: 'why', label: 'What is it for?', type: 'textarea', help: 'One sentence.' },
      { name: 'top_k', label: 'Results', type: 'number', default: 5, min: 1, max: 20 },
      { name: 'cite', label: 'Cite sources', type: 'checkbox', default: true },
    ],
  }),
  ask('w-scale', {
    kind: 'scale',
    title: 'How confident are you in that answer?',
    fields: [{ name: 'value', label: '1 to 5', type: 'number', min: 1, max: 5 }],
  }),
  {
    ...ask('w-answered', {
      kind: 'choice',
      title: 'Already answered',
      sub: 'the controls are inert, and it says what was chosen',
      fields: [
        {
          name: 'value',
          label: 'Model',
          type: 'select',
          options: [{ value: 'gpt-5.1', label: 'gpt-5.1' }],
        },
      ],
    }),
    answered: { widget_id: 'w-answered', values: { value: 'gpt-5.1' } },
  } as ChatMessage,

  ask('w-proposal', {
    kind: 'propose_alternative',
    title: 'Before I widen that timeout',
    body: {
      asked: 'Raise survey.timeout_ms from 5000 to 20000.',
      instead: 'Point survey at the mesh route and leave the timeout alone.',
      because:
        'It is not slow, it is unreachable — 20s of waiting still fails, four times more slowly.',
    },
  }),

  /* ---- the live control, and a host's own widget --------------------------- */
  {
    id: 'm20',
    role: 'agent',
    type: 'confirmation',
    tool: 'studio.write_design',
    summary: 'Raise survey.timeout_ms from 5000 to 20000',
    args: { agent_id: 'ada', node: 'survey', field: 'timeout_ms', value: 20000 },
    runId: 'run-8fc21a',
  },
  { id: 'm21', role: 'agent', type: 'widget', kind: 'graph-diff', payload: { added: 2, removed: 1 } },
  {
    id: 'm22',
    role: 'agent',
    type: 'text',
    text: 'Raised it, and the re-run passed.',
    served: { model: 'grok-4.3', insteadOf: 'gpt-5.1' },
  },
  { id: 'm23', role: 'agent', type: 'notice', tone: 'stopped', text: 'Stopped.' },
  {
    id: 'm24',
    role: 'agent',
    type: 'notice',
    tone: 'error',
    text: 'That turn failed: the provider has no credential for this workspace.',
  },
]

/** A store backed by the array above. Answering and sending work — they append
 *  locally — so the interactive states (a widget going inert, a fault, the
 *  working pulse) can be reached by hand rather than only described. */
export function demoStore(initial: ChatMessage[] = DEMO): ChatStore {
  let state: ChatState = {
    agentId: 'ada',
    session: { session_id: 'demo', agent_id: 'ada', streaming: 'buffered' },
    messages: initial,
    busy: false,
    incremental: false,
    fault: null,
    loading: false,
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<ChatState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    declaredTools: () => [],
    ensureSession: async () => state.session!,
    hydrate: async () => undefined,
    async send(text) {
      set({
        messages: [...state.messages, { id: `u${Date.now()}`, role: 'operator', type: 'text', text }],
        busy: true,
        fault: null,
      })
      await pause(900)
      set({
        messages: [
          ...state.messages,
          { id: `a${Date.now()}`, role: 'agent', type: 'text', text: `You said: ${text}` },
        ],
        busy: false,
      })
      return true
    },
    async answer(id, reply) {
      set({
        messages: state.messages.map((m) => (m.id === id && m.type === 'ask' ? { ...m, answered: reply } : m)),
      })
      return true
    },
    async stop() {
      set({ busy: false })
    },
    setTools: () => undefined,
    resolveConfirmation(id, outcome) {
      set({
        messages: state.messages.map((m) =>
          m.id === id && m.type === 'confirmation' ? { ...m, resolved: outcome } : m,
        ),
      })
    },
    reset() {
      set({ messages: [], busy: false, fault: null })
    },
  }
}
