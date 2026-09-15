/* ============================================================================
 * capabilities.test.ts — the manifest derivation, the verb executors, and the
 * app-scoped registry (P2-2-CHAT-VERBS; ENG-AH-018/019/020).
 * ========================================================================== */
import { describe, expect, it, vi } from 'vitest'
import { UX_VERBS, type Action } from './contracts'
import {
  clientToolsFromManifest,
  declareTools,
  uxToolRegistry,
  type UxResolver,
} from './tools'
import { createChatStore } from './store'
import type { ChatClient } from './client'

const MANIFEST: Action[] = [
  { name: 'ux.navigate' },
  { name: 'ux.highlight', description: 'WRONG — a manifest must not redefine this' },
  { name: 'atlas.rescan_tools', description: 'Rescan', input_schema: { type: 'object' } },
]

describe('clientToolsFromManifest (ENG-AH-018 B4)', () => {
  it('drops everything outside the implemented set — ceiling, never floor', () => {
    const tools = clientToolsFromManifest(MANIFEST, new Set(['ux.navigate']))
    expect(tools.map((t) => t.name)).toEqual(['ux.navigate'])
  })

  it('substitutes the canonical schema for standard verbs regardless of the manifest', () => {
    const tools = clientToolsFromManifest(MANIFEST, new Set(['ux.highlight']))
    expect(tools[0].description).toBe(UX_VERBS['ux.highlight'].description)
    expect(tools[0].input_schema).toEqual(UX_VERBS['ux.highlight'].input_schema)
  })

  it('passes bespoke actions through as declared, sorted', () => {
    const tools = clientToolsFromManifest(MANIFEST)
    expect(tools.map((t) => t.name)).toEqual([
      'atlas.rescan_tools',
      'ux.highlight',
      'ux.navigate',
    ])
  })
})

describe('uxToolRegistry (ENG-AH-019)', () => {
  it('offers exactly what the resolver implements — the honest implemented set', () => {
    const registry = uxToolRegistry({ navigate: vi.fn(), highlight: vi.fn() })
    expect(Object.keys(registry).sort()).toEqual(['ux.highlight', 'ux.navigate'])
  })

  it('B3: ux.highlight can reach nothing but highlight — no state, focus, or navigation', async () => {
    const resolver: UxResolver = {
      navigate: vi.fn(),
      open: vi.fn(),
      focus: vi.fn(),
      fill: vi.fn(),
      highlight: vi.fn(() => ({ highlighted: 'CTRL-03-005' })),
      readSelection: vi.fn(),
    }
    const registry = uxToolRegistry(resolver)
    const out = await registry['ux.highlight'].run({ control: 'CTRL-03-005', note: 'here' })
    expect(resolver.highlight).toHaveBeenCalledWith('CTRL-03-005', 'here')
    for (const untouched of ['navigate', 'open', 'focus', 'fill', 'readSelection'] as const) {
      expect(resolver[untouched]).not.toHaveBeenCalled()
    }
    expect(out).toEqual({ highlighted: 'CTRL-03-005' })
  })

  it('keys every executor on contract IDs — the args are IDs, never selectors', async () => {
    const resolver: UxResolver = { fill: vi.fn(), navigate: vi.fn() }
    const registry = uxToolRegistry(resolver)
    await registry['ux.fill'].run({ control: 'CTRL-04-004', value: 'demo' })
    expect(resolver.fill).toHaveBeenCalledWith('CTRL-04-004', 'demo')
    await registry['ux.navigate'].run({ surface: 'IF-03' })
    expect(resolver.navigate).toHaveBeenCalledWith('IF-03')
  })
})

function fakeClient(): ChatClient {
  return {
    roster: vi.fn(async () => ({ agents: [] })),
    openSession: vi.fn(async () => ({ session_id: 's1', agent_id: 'ada', streaming: 'buffered' })),
    transcript: vi.fn(async () => ({ entries: [] })),
    turn: vi.fn(),
    cancel: vi.fn(async () => undefined),
    decideProposal: vi.fn(async () => undefined),
  } as unknown as ChatClient
}

describe('the app-scoped registry (ENG-AH-020)', () => {
  const tool = (description: string) => ({
    description,
    input_schema: { type: 'object' },
    run: () => null,
  })

  it('refuses an unprefixed bespoke name in a named scope', () => {
    const store = createChatStore(fakeClient(), 'ada')
    expect(() => store.setTools({ search: tool('bare name') }, 'atlas')).toThrow(
      /must be 'atlas\.'-prefixed/,
    )
  })

  it('merges two app scopes without collision, ux.* staying unscoped', () => {
    const store = createChatStore(fakeClient(), 'ada')
    store.setTools(
      { 'ux.highlight': tool('point'), 'atlas.rescan': tool('a') },
      'atlas',
    )
    store.setTools({ 'aurora.compose': tool('b') }, 'aurora')
    expect(store.declaredTools().map((t) => t.name)).toEqual([
      'atlas.rescan',
      'aurora.compose',
      'ux.highlight',
    ])
    // clearing ONE scope leaves the other's tools standing
    store.setTools(undefined, 'atlas')
    expect(store.declaredTools().map((t) => t.name)).toEqual(['aurora.compose'])
  })

  it('a retried declaration is byte-identical (sorted)', () => {
    const a = declareTools({ b: tool('2'), a: tool('1'), c: tool('3') })
    const b = declareTools({ c: tool('3'), a: tool('1'), b: tool('2') })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.map((t) => t.name)).toEqual(['a', 'b', 'c'])
  })
})
