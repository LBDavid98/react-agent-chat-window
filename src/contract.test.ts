/* ============================================================================
 * contract.test.ts — the promises this package makes about its own CSS.
 *
 * These are the three claims that decide whether the window can be dropped into
 * an app nobody here has seen, and all three are the kind that rot silently:
 * nothing throws when a stylesheet reads a token that does not exist, or when a
 * component quietly grows a `position: fixed`. Atlas is living proof —
 * `--color-border` is referenced 29 times there and defined nowhere, so those
 * borders compute to currentColor and have never rendered.
 *
 * So they are checked rather than documented.
 * ========================================================================== */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe as group, expect, it } from 'vitest'

// vitest runs from the package root; import.meta.url is rewritten by the
// transform and does not point at this file.
const here = join(process.cwd(), 'src')
const read = (name: string): string => readFileSync(join(here, name), 'utf8')
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const chat = strip(read('chat.css'))
const dock = strip(read('dock.css'))

const ADAPTERS = readdirSync(join(here, 'adapters')).filter((f: string) => f.endsWith('.css'))

/** Every `--name:` declared anywhere in the text, in source order. */
function declared(css: string): string[] {
  return [...css.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)].map((m) => m[1])
}

/** Every `var(--name` read anywhere in the text. */
function used(css: string): Set<string> {
  return new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
}

group('the token vocabulary holds together', () => {
  // The one block in chat.css that resolves the public --cai-* hooks into the
  // private --_ roles everything else paints with.
  const roles = declared(chat.slice(chat.indexOf(':where('), chat.indexOf('.cai-chat {')))

  it('declares eighteen roles, each resolving a --cai-* hook and a literal', () => {
    expect(roles).toHaveLength(18)
    for (const role of roles) {
      const line = chat.match(new RegExp(`\\${role}:([^;]+);`))?.[1] ?? ''
      // `var(--cai-x, <literal>)` — the hook first so a host can override it,
      // a literal second so an app that maps nothing still gets a window.
      expect(line, role).toMatch(/var\(\s*--cai-[\w-]+\s*,\s*\S/)
    }
  })

  it('paints only from roles it declares — no read of an undefined token', () => {
    const readsPrivate = [...used(chat), ...used(dock)].filter((t) => t.startsWith('--_'))
    for (const token of readsPrivate) expect(roles, token).toContain(token)
  })

  it('declares no role nothing paints with', () => {
    const reads = new Set([...used(chat), ...used(dock)])
    for (const role of roles) expect(reads, role).toContain(role)
  })

  it('reads a --cai-* hook only where it resolves one into a role', () => {
    // A painting rule reaching straight for --cai-x would be a second place the
    // default lives, which is how ten copies of #6b6b73 got into this file.
    const body = chat.slice(chat.indexOf('.cai-chat {')) + dock
    expect([...used(body)].filter((t) => t.startsWith('--cai-'))).toEqual([])
  })
})

group('the window renders into the host container', () => {
  // The mechanical form of "droppable": chat.css cannot position itself, cannot
  // claim a layer, and cannot measure the viewport. Anything that needs to do
  // those things is placement, and placement lives in dock.css, which is
  // optional. Without this test the claim is a comment.
  const FORBIDDEN = /(?:^|[;{])\s*(position|z-index|inset|inset-block|inset-inline|top|right|bottom|left)\s*:/g

  it('declares no position, layer or offset', () => {
    expect([...chat.matchAll(FORBIDDEN)].map((m) => m[1])).toEqual([])
  })

  it('measures nothing in viewport units', () => {
    expect(chat.match(/\b\d[\d.]*(?:vh|vw|vmin|vmax|dvh|svh)\b/g)).toBeNull()
  })

  it('and dock.css is where that lives instead', () => {
    // Guards against someone "fixing" the test above by deleting the dock.
    expect(dock).toMatch(/position:\s*fixed/)
    expect(dock).toMatch(/z-index:/)
  })
})

group('an adapter maps tokens and paints nothing', () => {
  /** The --cai-* hooks chat.css actually resolves. An adapter that sets
   *  anything else is writing to a name nothing reads — the exact silent
   *  failure this suite exists for. */
  const hooks = new Set(
    [...chat.matchAll(/--_[\w-]+:\s*var\(\s*(--cai-[\w-]+)/g)].map((m) => m[1]),
  )

  for (const file of ADAPTERS) {
    const css = strip(readFileSync(join(here, 'adapters', file), 'utf8'))

    it(`${file} declares custom properties and only custom properties`, () => {
      for (const block of css.matchAll(/\{([^}]*)\}/g)) {
        for (const decl of block[1].split(';')) {
          const property = decl.split(':')[0].trim()
          if (!property) continue
          // A rule that paints is a rule that fights the host's own stylesheet.
          // The same rule a host app keeps by hand for its theme layer.
          expect(property, `${file}: ${decl.trim()}`).toMatch(/^--/)
        }
      }
    })

    it(`${file} maps INTO --cai-*, never out of it`, () => {
      // Aurora writes its theme as inline style on :root, and inline style
      // beats an author stylesheet — a file redefining a host's own name would
      // be silently ignored there. Mapping inward is the only direction that
      // holds in every host.
      for (const property of declared(css)) expect(property, file).toMatch(/^--cai-/)
    })

    it(`${file} maps only hooks the window reads`, () => {
      for (const property of declared(css)) {
        expect([...hooks], `${file}: ${property}`).toContain(property)
      }
    })
  }
})
