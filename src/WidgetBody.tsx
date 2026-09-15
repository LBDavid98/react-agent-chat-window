/* ============================================================================
 * WidgetBody.tsx — the half a widget SHOWS.
 *
 * Every one of these is drawn from data with no chart library and no
 * dependency. That is a constraint worth keeping: the moment this package
 * needs a charting dependency, every app embedding it inherits that choice,
 * and the first app whose bundler disagrees stops embedding it.
 * ========================================================================== */
import type { WidgetBody as Body, WidgetSpec } from './contracts'

export function WidgetBodyView({ spec }: { spec: WidgetSpec }) {
  const body = spec.body
  if (!body) return null
  switch (spec.kind) {
    case 'table':
      return <TableBody body={body} />
    case 'metrics':
      return <MetricsBody body={body} />
    case 'bars':
      return <BarsBody body={body} />
    case 'timeline':
      return <TimelineBody body={body} />
    case 'code':
      return (
        <pre className="cai-code" data-language={body.language}>
          <code>{body.text}</code>
        </pre>
      )
    case 'diff':
      return <DiffBody body={body} />
    case 'markdown':
      return <div className="cai-prose">{body.text}</div>
    case 'propose_alternative':
      return <ProposalBody body={body} />
    default:
      return null
  }
}

/** Two courses of action, and the reason for the second.
 *
 *  Read order is deliberate and is the opposite of how an agent would pitch it:
 *  what YOU asked for comes first, then what it would do instead, then why. An
 *  agent leading with its own idea is an agent framing the question. */
function ProposalBody({ body }: { body: Body }) {
  return (
    <dl className="cai-proposal">
      {body.asked && (
        <div>
          <dt>You asked</dt>
          <dd>{body.asked}</dd>
        </div>
      )}
      {body.instead && (
        <div className="cai-instead">
          <dt>I'd suggest</dt>
          <dd>{body.instead}</dd>
        </div>
      )}
      {body.because && (
        <div>
          <dt>Because</dt>
          <dd>{body.because}</dd>
        </div>
      )}
    </dl>
  )
}

function TableBody({ body }: { body: Body }) {
  const columns = body.columns ?? []
  const rows = body.rows ?? []
  if (!rows.length) return <span className="cai-detail">Nothing to show.</span>
  return (
    // Wide content scrolls inside its own box. A table that widens the panel
    // pushes the composer off screen, which is a worse problem than a
    // horizontal scrollbar.
    <div className="cai-tablewrap">
      <table className="cai-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`cai-al-${c.align ?? 'text'}`} scope="col">
                {c.label ?? c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={`cai-al-${columns[j]?.align ?? 'text'}`}>
                  {cell === null || cell === undefined ? '' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MetricsBody({ body }: { body: Body }) {
  return (
    <div className="cai-metrics">
      {(body.metrics ?? []).map((m) => (
        <div key={m.label} className={`cai-metric cai-tone-${m.tone ?? 'neutral'}`}>
          <span className="cai-metric-v">{m.value}</span>
          <span className="cai-metric-l">{m.label}</span>
          {m.hint && <span className="cai-metric-h">{m.hint}</span>}
        </div>
      ))}
    </div>
  )
}

function BarsBody({ body }: { body: Body }) {
  const series = body.bars ?? []
  // Without an explicit max the largest bar fills the row, which compares the
  // bars to each other. `max` is how a caller compares them to a budget.
  const ceiling = body.max ?? Math.max(1, ...series.map((b) => b.value))
  return (
    <div className="cai-bars">
      {series.map((b) => (
        <div key={b.label} className="cai-bar" title={b.hint}>
          <span className="cai-bar-l">{b.label}</span>
          <span className="cai-bar-track">
            <span
              className="cai-bar-fill"
              style={{ width: `${Math.min(100, (b.value / ceiling) * 100)}%` }}
            />
          </span>
          <span className="cai-bar-v">{b.value}</span>
        </div>
      ))}
    </div>
  )
}

function TimelineBody({ body }: { body: Body }) {
  return (
    <ol className="cai-timeline">
      {(body.steps ?? []).map((s, i) => (
        <li key={i} className={`cai-step cai-st-${s.state ?? 'todo'}`}>
          <span className="cai-step-dot" aria-hidden="true" />
          <span className="cai-step-l">{s.label}</span>
          {s.at && <span className="cai-step-at">{s.at}</span>}
        </li>
      ))}
    </ol>
  )
}

function DiffBody({ body }: { body: Body }) {
  return (
    <div className="cai-diff">
      <div className="cai-diff-side cai-before">
        <span className="cai-diff-tag">before</span>
        <pre>{body.before}</pre>
      </div>
      <div className="cai-diff-side cai-after">
        <span className="cai-diff-tag">after</span>
        <pre>{body.after}</pre>
      </div>
    </div>
  )
}
