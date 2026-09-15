/* ============================================================================
 * tools.ts — tools the BROWSER holds, that the agent may call.
 *
 * The split is about where the state lives, not about who is in charge.
 * Reading a design needs the host's database; knowing which control an operator
 * has selected needs this browser. So the model is offered both sets and does
 * not know there are two.
 *
 * WHY THIS IS SAFE TO ACCEPT FROM A PAGE. A client tool acts only on the
 * browser that declared it. That bound is the whole of the argument — it is why
 * `ClientTool` has no `effect` field, and why these do not go through the
 * confirmation gate that a write tool does. A client tool that performs a
 * network write is a server tool wearing the wrong hat, and belongs on the host
 * where the credential and the gate are.
 *
 * Two checks, and they answer different questions. The host refuses a client
 * tool whose name shadows one of its own, which only it can do — a window
 * cannot know the server's tool set, and a page that could replace
 * `studio.read_design` could make the model believe anything. This side refuses
 * a request naming a tool it does not hold, which only it can do. Neither is
 * redundant: one asks "did I ask this", the other asks "was I asked this".
 * ========================================================================== */
import type { ClientTool } from './contracts'

export interface ClientToolDefinition<Args = Record<string, unknown>> {
  /** Written for the MODEL: when to reach for this, not what the code does. */
  description: string
  /** JSON Schema for the arguments. Without it the model is guessing. */
  input_schema: Record<string, unknown>
  /** Do the thing. May be async. Whatever it returns is JSON-serialised into
   *  the transcript, so return something a reader would recognise — and throw
   *  rather than returning a sentinel, because a throw becomes an error result
   *  the model is told about. */
  run(args: Args): unknown | Promise<unknown>
}

export type ClientToolRegistry = Record<string, ClientToolDefinition>

/** The registry as the wire wants it: names, descriptions, schemas, no code.
 *
 *  Sorted by name so a turn that declares the same tools sends a byte-identical
 *  block. The host sorts too; this costs nothing and means a retry of the same
 *  turn is the same request rather than a differently-ordered one. */
export function declareTools(registry: ClientToolRegistry | undefined): ClientTool[] {
  if (!registry) return []
  return Object.keys(registry)
    .sort()
    .map((name) => ({
      name,
      description: registry[name].description,
      input_schema: registry[name].input_schema,
    }))
}

/* ----------------------------------------------------------------------------
 * The capability manifest — derivation and the six verb executors
 * (P2-2-CHAT-VERBS; ENG-AH-018/019/020).
 * ------------------------------------------------------------------------- */
import { UX_VERBS, type Action } from './contracts'

/** The per-turn declaration derived from an app's manifest — the TS twin of
 *  `the server SDK.capabilities.client_tools`.
 *
 *  Standard verbs get their canonical schema regardless of what the manifest
 *  carried (the vocabulary is defined once — ENG-AH-019 B1). When
 *  `implemented` is given, anything outside it is DROPPED: the manifest is
 *  the ceiling of the agent's reach, never the floor (ENG-AH-018 B4) —
 *  declaring a tool the page cannot run leaves the model calling into a
 *  void. */
export function clientToolsFromManifest(
  actions: Action[],
  implemented?: Set<string>,
): ClientTool[] {
  const out: ClientTool[] = []
  for (const action of actions) {
    const name = String(action.name ?? '')
    if (!name) continue
    if (implemented !== undefined && !implemented.has(name)) continue
    const source = UX_VERBS[name] ?? action
    out.push({
      name,
      description: String(source.description ?? ''),
      input_schema: { ...(source.input_schema ?? {}) },
    })
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** What a host page supplies to lend the agent hands: one method per verb,
 *  everything keyed on CONTRACT IDs — never DOM selectors (ENG-AH-019 B2).
 *  A resolver implements only what its page can honour; the executors it
 *  parameterizes are exactly the `implemented` set. */
export interface UxResolver {
  navigate?(surface: string): unknown | Promise<unknown>
  open?(control: string): unknown | Promise<unknown>
  focus?(control: string): unknown | Promise<unknown>
  /** MUST change nothing — no state, no focus, no navigation (ENG-AH-019
   *  B3). Pointing, not touching. */
  highlight?(control: string, note?: string): unknown | Promise<unknown>
  fill?(control: string, value: string): unknown | Promise<unknown>
  /** Reports position and selection IDENTITY, never content (B4). */
  readSelection?(): unknown | Promise<unknown>
}

const VERB_TO_METHOD: Record<string, keyof UxResolver> = {
  'ux.navigate': 'navigate',
  'ux.open': 'open',
  'ux.focus': 'focus',
  'ux.highlight': 'highlight',
  'ux.fill': 'fill',
  'ux.read_selection': 'readSelection',
}

/** The registry factory a host app parameterizes with its resolver.
 *
 *  Only the verbs the resolver actually implements appear — which makes
 *  `Object.keys(uxToolRegistry(resolver))` the page's honest `implemented`
 *  set for `clientToolsFromManifest`. Each executor delegates to exactly one
 *  resolver method; `ux.highlight` can reach nothing but `highlight`, which
 *  is how "changes nothing" stays provable rather than promised. */
export function uxToolRegistry(resolver: UxResolver): ClientToolRegistry {
  const registry: ClientToolRegistry = {}
  for (const [verb, method] of Object.entries(VERB_TO_METHOD)) {
    const impl = resolver[method]
    if (typeof impl !== 'function') continue
    const spec = UX_VERBS[verb]
    registry[verb] = {
      description: spec.description,
      input_schema: spec.input_schema,
      run(args: Record<string, unknown>) {
        switch (verb) {
          case 'ux.navigate':
            return resolver.navigate!(String(args.surface ?? ''))
          case 'ux.open':
            return resolver.open!(String(args.control ?? ''))
          case 'ux.focus':
            return resolver.focus!(String(args.control ?? ''))
          case 'ux.highlight':
            return resolver.highlight!(
              String(args.control ?? ''),
              args.note === undefined ? undefined : String(args.note),
            )
          case 'ux.fill':
            return resolver.fill!(String(args.control ?? ''), String(args.value ?? ''))
          default:
            return resolver.readSelection!()
        }
      },
    }
  }
  return registry
}
