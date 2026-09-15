# Host stand-ins

Each file reproduces the tokens ONE real app defines — its own names, its real
values, light and dark — so the adapter beside it can be exercised against the
thing it actually maps.

These are stand-ins, and the limitation is worth stating: they use a
`[data-scheme]` attribute for dark, whereas the real apps each get there
differently (Atlas has a media query *and* a `[data-theme]` block; a host app
has three selectors per palette; Almanac has a media query; Aurora writes
inline style from JS). The harness needs to force a mode side by side, which no
single one of those allows. What it does test faithfully is the mapping: the
token NAMES and VALUES are copied from the source, and the adapter files loaded
next to them are the real ones, unmodified.

Values copied 2026-08-31 from:

| File | Source |
|---|---|
| `atlas.css` | `atlas/frontend/src/styles/design-tokens.css` |
| `modernist.css` | the vendored `_ds/modernist-*/styles.css` + `a host app/packages/ui/src/theme.css`, cobalt |
| `almanac.css` | `project-management/webapp/static/style.css` |
| `aurora.css` | `the host repo` `src/design/themes.ts`, plain (light) and nebula (dark) |

If a host retunes its palette these drift, and the harness quietly stops
representing it. That is a real cost and it is the reason these files are as
small as they are — only the tokens an adapter reads.
