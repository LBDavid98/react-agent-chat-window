# Adapters

One file per host application. Each maps that app's design tokens onto this
window's eighteen roles, and **contains nothing but custom-property
declarations** — no selector in here paints anything. `contract.test.ts`
enforces that.

```ts
import 'react-agent-chat-window/chat.css'
import 'react-agent-chat-window/adapters/atlas.css'
```

| App | File | Notes |
|---|---|---|
| Atlas / agent-builder | `atlas.css` | Maps all sixteen; nothing derived. |
| a host app, or any the core `_ds` app | `minimal.css` | Derives raised/sunken/muted/status, which the core does not have. |
| Almanac / a dashboard app | `almanac.css` | Disjoint vocabulary — `--surface`, `--ink`, `--border`. Reached through the IIFE build. |
| Aurora | `aurora.css` | Its theme is inline style on `:root`; see the file. |

An app that imports no adapter gets the literal defaults in `chat.css`, which
are a plain legible window rather than a broken one.

## Adding a fifth app

Copy the closest file, remap, done. Nothing in the package changes. That is the
whole point of the layer: the alternative — one long fallback chain per role,
`var(--cai-bg, var(--color-surface, var(--surface, var(--panel, #fff))))` —
grows a term per app, has to be edited inside the package each time, and
resolves on whichever name the host happens to define rather than on which one
means the right thing. Aurora's `--card` and Atlas's
`--color-surface-raised` are not the same role.

The pattern generalizes: vendor a design system as-is rather than forking it,
take every value from its own variables, and put the mapping in a layer that
only redefines custom properties and paints nothing.

## Always map INTO `--cai-*`, never out of it

Write `--cai-bg: var(--panel)`. Never `--color-surface: var(--panel)`.

Aurora applies its theme as inline style on `document.documentElement`, and
inline style beats an author stylesheet — a rule redefining a host's own name
would be silently ignored there. Mapping into our vocabulary is the only
direction that holds in every host, and it has a second benefit everywhere:
substitution happens at *use*, so one mapping covers a host's light block, its
`prefers-color-scheme` block, its explicit `[data-theme]` block and any runtime
theme switch, with nothing to keep in step.

## There is no `auto.css`, and there cannot be

The obvious convenience — one stylesheet that detects the host and applies the
right mapping — is not expressible in CSS. `@supports` can test whether a
*property/value pair* is understood; it cannot test whether a custom property
has been **defined**, because `color: var(--anything)` is syntactically valid
whether or not `--anything` exists. There is no `@supports var(--x)`.

The alternatives were a runtime detector in JS that reads `getComputedStyle` and
guesses which vocabulary is present, or a `:root[data-cai-adapter="…"]` stamp
the host has to write. Both are more moving parts than the one import line they
would save, and the detector guesses. One explicit import, and you can see in
the app which mapping it uses.
