/* ============================================================================
 * wire.test.ts — contracts.ts against the Python it is a twin of.
 *
 * the server-side contract definition and `widgets.py` are the source of truth, and
 * `src/contracts.ts` is maintained by hand. A field added there and not here is
 * a field the host sends and this drops; a kind added here and not there is a
 * kind no agent can ever emit. Neither fails loudly — the first renders
 * nothing, the second is simply never exercised — which is exactly why the two
 * files were kept in step by nothing but a comment saying to.
 *
 * `wire.fixture.json` is generated from the Python. This test reads the union
 * literals out of contracts.ts as TEXT, because a TypeScript union does not
 * exist at runtime and there is nothing to import. `the server SDK`'s own
 * `tests/test_ts_parity.py` asserts the fixture still matches the Python, so
 * the fixture cannot go stale on either side without something going red.
 * ========================================================================== */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe as group, expect, it } from 'vitest'
import { TERMINAL_KINDS, UX_VERBS } from './contracts'

const src = join(process.cwd(), 'src')
const wire = JSON.parse(readFileSync(join(src, 'wire.fixture.json'), 'utf8'))
const contracts = readFileSync(join(src, 'contracts.ts'), 'utf8').replace(/\/\/[^\n]*/g, '')

/** The field names of `export interface <name> { … }`.
 *
 *  The vocabulary is only half the wire. A field added in Python and not
 *  mirrored here is a field the window drops on the floor, and it fails as
 *  quietly as a missing kind: nothing throws, the value is simply never
 *  rendered. `model_served` and `tool_result` both reached this side because
 *  somebody mentioned them, which is not a mechanism. */
function fields(name: string): string[] {
  const start = contracts.indexOf(`export interface ${name} {`)
  if (start === -1) throw new Error(`contracts.ts has no exported interface ${name}`)
  // These are all top-level and none contains a nested object literal, so the
  // first `}` at the start of a line closes it.
  const body = contracts.slice(start, contracts.indexOf('\n}', start))
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort()
}

/** The string literals of `export type <name> = 'a' | 'b' | …`, in order. */
function union(name: string): string[] {
  const start = contracts.indexOf(`export type ${name} =`)
  if (start === -1) throw new Error(`contracts.ts has no exported type ${name}`)
  // A union runs to the next top-level declaration.
  const body = contracts.slice(start, contracts.indexOf('export', start + 10))
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

group('contracts.ts is the Python twin it says it is', () => {
  // Order is not incidental: the ask kinds come before the show kinds in both
  // files, and someone reading either one is being told which is which.
  for (const name of ['TurnEventKind', 'Modality', 'WidgetKind', 'FieldType']) {
    it(`${name} matches, member for member and in order`, () => {
      expect(union(name)).toEqual(wire[name])
    })
  }

  it('TERMINAL_KINDS matches — the set a loop actually stops on', () => {
    // The one that costs the most to get wrong. A reader that waits for `final`
    // alone never stops when a turn is cancelled or errors, and the symptom is
    // a spinner that spins forever.
    expect([...TERMINAL_KINDS].sort()).toEqual(wire.TERMINAL_KINDS)
  })

  it('every terminal kind is a kind that exists', () => {
    for (const kind of wire.TERMINAL_KINDS) expect(wire.TurnEventKind).toContain(kind)
  })

  it('UX_VERBS matches the SDK table, schemas and all', () => {
    // The verb vocabulary is defined ONCE (ENG-AH-019 B1). Deep equality, not
    // name equality: a schema that drifts is a call the host rejects or —
    // worse — accepts with different meaning.
    expect(UX_VERBS).toEqual(wire.UX_VERBS)
  })

  // Field-for-field, not just kind-for-kind. Set equality in both directions:
  // a field only in Python is one this window silently drops, and a field only
  // here is one the host silently drops.
  for (const name of Object.keys(wire.shapes)) {
    it(`${name} has the same fields on both sides`, () => {
      expect(fields(name)).toEqual(wire.shapes[name])
    })
  }
})
