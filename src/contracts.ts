/* ============================================================================
 * contracts.ts — the wire, in TypeScript.
 *
 * SOURCE OF TRUTH IS the server-side contract definition. These are its TypeScript
 * twin, not a second design. A field added there is added here; a field added
 * only here is a field the host will drop.
 *
 * Why a copy exists at all: the Python package is what a server and every
 * Python caller share, and a browser cannot import it. The alternative — a
 * codegen step — buys less than it costs at this size, and would still need a
 * human to notice the wire changed. What keeps them together is that both
 * files say so, and that `TERMINAL_KINDS` below is asserted against a real
 * host response in the integration test rather than trusted.
 * ========================================================================== */

export type Modality = 'text' | 'voice' | 'video'

export interface Persona {
  identity?: string
  core_directive?: string
  operating_rules?: string[]
  greeting?: string
}

export interface AgentCard {
  agent_id: string
  name?: string
  description?: string
  persona?: Persona
  modalities?: Modality[]
  tools?: string[]
  credentialed?: boolean
  /** Null when the host cannot load this agent's design. */
  ir_sha256?: string | null
  unavailable?: string
}

export interface SessionRef {
  session_id: string
  agent_id: string
  /** Returned even when it names the host you just asked. It is where a media
   *  edge goes later, and a client that has never read it will not start when
   *  one appears. */
  stream_url?: string
  expires_at?: string | null
  modality?: Modality
  /** Whether events actually arrive incrementally on THIS path. The gateway's
   *  production plan buffers them. A client that reads this renders a working
   *  indicator; one that assumes incremental output shows a frozen panel and
   *  then a wall of text. */
  streaming?: 'incremental' | 'buffered'
}

/** A tool the CLIENT holds, declared on EVERY turn.
 *
 *  Per turn, not per session, because in a routed app the tools that make sense
 *  over a canvas are not the ones that make sense in a library — a set declared
 *  once goes stale the first time somebody navigates, and the failure is a
 *  model calling something that is no longer there. The host does not remember
 *  the last set on purpose; omitting this offers the model nothing client-side
 *  for that turn.
 *
 *  There is no `effect` field, deliberately. A client tool acts only on the
 *  browser it came from, and that bound is what makes accepting a
 *  browser-declared tool safe at all. A client tool that performs a network
 *  write is a server tool wearing the wrong hat. */
export interface ClientTool {
  name: string
  /** Written for the MODEL: when to reach for it, not what the function does. */
  description: string
  input_schema: Record<string, unknown>
}

/** One thing an app lets an in-app agent DO (ENG-AH-018) — a row of the
 *  capability manifest `GET /v1/capabilities` serves.
 *
 *  An action is always a CLIENT tool: it executes in the embedding page and
 *  is bounded to that browser — which is why, like `ClientTool`, it carries
 *  no `effect` field. It keys on the app CONTRACT's IDs (the control or
 *  surface it operates), never on DOM selectors: the contract is the shared
 *  language, and a page's internals are nobody's contract.
 *
 *  Mirror of `the server SDK.capabilities.Action` (total=False — every field
 *  optional on the wire). */
export interface Action {
  name?: string
  description?: string
  input_schema?: Record<string, unknown>
  /** The contract control this action operates, by ID. Empty for a
   *  surface-level action, which names `surface` instead. */
  control?: string
  surface?: string
}

/** The six standard verbs, schemas and all — the mirror of
 *  `the server SDK.capabilities.UX_VERBS`, asserted equal to the generated
 *  fixture by wire.test.ts. An app's manifest declares support by NAME; the
 *  schema always comes from this table (ENG-AH-019 B1), because a `ux.focus`
 *  that means something different per app is worse than no vocabulary.
 *
 *  Two of the six carry their one-line "why":
 *  - `ux.highlight` changes nothing — no state, no focus, no navigation. It
 *    is the pointing half of teaching; an agent that cannot point without
 *    touching cannot teach.
 *  - `ux.read_selection` answers "where is the user", never "what is in the
 *    user's browser" — identity, not content. */
const CONTROL_ARG = {
  type: 'string',
  description: 'A contract control ID, e.g. CTRL-03-001.',
} as const
const SURFACE_ARG = {
  type: 'string',
  description: 'A contract surface ID, e.g. IF-03.',
} as const

function verbSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

export const UX_VERBS: Record<string, Required<Pick<Action, 'name' | 'description' | 'input_schema'>>> = {
  'ux.navigate': {
    name: 'ux.navigate',
    description: 'Go to a surface of the app, by surface ID.',
    input_schema: verbSchema({ surface: SURFACE_ARG }, ['surface']),
  },
  'ux.open': {
    name: 'ux.open',
    description: 'Open what a control reveals — a dialog, panel, or row — by control ID.',
    input_schema: verbSchema({ control: CONTROL_ARG }, ['control']),
  },
  'ux.focus': {
    name: 'ux.focus',
    description: 'Move keyboard focus to a control, by control ID.',
    input_schema: verbSchema({ control: CONTROL_ARG }, ['control']),
  },
  'ux.highlight': {
    name: 'ux.highlight',
    description:
      'Draw the user\'s attention to a control without touching it — no state change, no focus change, no navigation.',
    input_schema: verbSchema(
      {
        control: CONTROL_ARG,
        note: {
          type: 'string',
          description: 'Optional short caption shown beside the highlight.',
        },
      },
      ['control'],
    ),
  },
  'ux.fill': {
    name: 'ux.fill',
    description: 'Put a value into an input control, by control ID.',
    input_schema: verbSchema({ control: CONTROL_ARG, value: { type: 'string' } }, ['control', 'value']),
  },
  'ux.read_selection': {
    name: 'ux.read_selection',
    description:
      'Report where the user is: the active surface, focused control, and what is selected — identity, not content.',
    input_schema: verbSchema({}, []),
  },
}

/** The answer to a `tool_request`, carried by the NEXT turn.
 *
 *  Exactly one of `result` or `error` is set. An error is a real answer and
 *  must be sent: the model has to be told a tool failed, and a client that
 *  goes quiet is indistinguishable from a slow one, so the turn simply never
 *  comes back.
 *
 *  NOTE: the host reads this as an untyped dict (`agent_host/routes.py`), so
 *  unlike everything else in this file it has no `the server SDK` twin to mirror.
 *  The shape below is the one that route documents. If a Python type lands,
 *  this becomes a mirror like the rest and the parity test should cover it. */
export interface ToolResult {
  call_id: string
  tool: string
  result?: unknown
  error?: string
}

export type TurnEventKind =
  | 'turn_started'
  | 'partial'
  | 'tool_running'
  | 'tool_result'
  | 'awaiting_input'
  | 'awaiting_confirmation'
  | 'tool_request'
  | 'final'
  | 'interrupted'
  | 'error'

export interface TurnEvent {
  kind: TurnEventKind
  session_id?: string
  turn_id?: string
  run_id?: string
  seq?: number
  at?: string
  /** `partial` and `final`. */
  text?: string
  /** `tool_running`, `tool_result`, `awaiting_confirmation`. */
  tool?: string
  effect?: 'read' | 'write'
  result?: unknown
  /** `awaiting_confirmation` — the one-line statement of what would be done. */
  summary?: string
  args?: Record<string, unknown>
  /** `awaiting_confirmation`, when the proposal is stored host-side: the id a
   *  decision names. A client approves an ID, never a payload. */
  proposal_id?: string
  /** `awaiting_input` — a question with a typed answer. See WidgetSpec. */
  widget?: WidgetSpec
  /** `tool_request` — the host asking the CLIENT to run one of its own tools.
   *  Answered by the NEXT turn carrying a `tool_result` with the same
   *  `call_id`. Deliberately not terminal and deliberately not parked: the
   *  turn simply ends, because a browser cannot promise to answer — it may
   *  navigate away mid-request — and a design that held a turn open would hang
   *  on the most ordinary thing a browser does. */
  call_id?: string
  /** `error` and `interrupted` — the server's own reason, never a generic one. */
  detail?: string
  /** `final` — the model that actually answered, and the one that was asked
   *  for, present ONLY when they differ. Attaching a tool definition makes the
   *  gateway silently substitute one model for another; a window that cannot
   *  say so reports another model's answer as the one you chose. Absent on the
   *  common path, which is why both are optional rather than always sent. */
  model_served?: string
  degraded_from?: string
}

/* ---- widgets -------------------------------------------------------------
 * An agent that needs a decision usually asks in prose and reads prose back,
 * which puts a model in the business of turning a sentence into a value whose
 * shape it already knew. A widget removes the interpretation: the agent emits
 * the spec, this package renders it, and typed values go back.
 *
 * Mirrors `the server SDK/widgets.py`, which is the source of truth. */

export type WidgetKind =
  // ask
  | 'choice'
  | 'multi_choice'
  | 'form'
  | 'confirm'
  | 'scale'
  | 'propose_alternative'
  // show — and any of these may also carry fields
  | 'table'
  | 'metrics'
  | 'bars'
  | 'timeline'
  | 'code'
  | 'diff'
  | 'markdown'
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox'

export interface WidgetOption {
  value: string
  label?: string
  hint?: string
}

export interface WidgetField {
  name: string
  label: string
  type?: FieldType
  options?: WidgetOption[]
  required?: boolean
  placeholder?: string
  help?: string
  default?: unknown
  min?: number
  max?: number
}

export interface WidgetColumn {
  key: string
  label?: string
  align?: 'text' | 'number' | 'code'
}

export interface WidgetMetric {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}

export interface WidgetBar {
  label: string
  value: number
  hint?: string
}

export interface WidgetStep {
  label: string
  at?: string
  state?: 'done' | 'current' | 'todo' | 'failed'
}

/** What a widget SHOWS. Only the keys its kind uses are set. */
export interface WidgetBody {
  columns?: WidgetColumn[]
  rows?: unknown[][]
  metrics?: WidgetMetric[]
  bars?: WidgetBar[]
  max?: number
  steps?: WidgetStep[]
  text?: string
  language?: string
  before?: string
  after?: string
  /** `propose_alternative` — what the operator asked for, what the agent would
   *  do instead, and why. The reason is the whole widget: an agent that can
   *  only comply or refuse cannot warn you. */
  asked?: string
  instead?: string
  because?: string
}

/** The answer a `propose_alternative` widget sends back, under the field name
 *  `value`. Fixed rather than agent-supplied — see `Widget.tsx`. */
export type ProposalAnswer = 'as_asked' | 'alternative'

export interface WidgetSpec {
  id: string
  kind: WidgetKind
  title: string
  sub?: string
  /** What it shows. Absent on a widget that only asks. */
  body?: WidgetBody
  /** What it asks. Absent on a widget that only shows. */
  fields?: WidgetField[]
  submit_label?: string
  /** Whether the composer stays usable while this is open. Defaults to true:
   *  a widget is a shortcut, never a cage. */
  allow_free_text?: boolean
}

export interface WidgetReply {
  widget_id: string
  values: Record<string, unknown>
}

export interface TranscriptEntry {
  seq: number
  role: 'operator' | 'agent' | 'tool' | 'system'
  modality?: Modality
  started_at?: string
  ended_at?: string | null
  text?: string
  run_id?: string | null
}

/** Exactly one of these ends a turn.
 *
 *  Use `isTerminal`, never `kind === 'final'`. A loop that waits for `final`
 *  alone never stops when a turn is cancelled or errors, and the symptom is a
 *  spinner that spins forever. */
export const TERMINAL_KINDS: ReadonlySet<TurnEventKind> = new Set([
  'final',
  'interrupted',
  'error',
  // Terminal because there is genuinely nothing more coming until the browser
  // answers. It is the one terminal kind that is not an ENDING — the turn
  // stopped to ask something, and the next turn carries the answer. So it must
  // not be rendered as a failure, and it must still settle the pending reply.
  'tool_request',
])

export function isTerminal(event: TurnEvent): boolean {
  return TERMINAL_KINDS.has(event.kind)
}
