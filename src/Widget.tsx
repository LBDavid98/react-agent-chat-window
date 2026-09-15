/* ============================================================================
 * Widget.tsx — a spec in; something drawn, and typed values out.
 *
 * The whole point of this component is that a host app writes NOTHING to ask a
 * structured question. An agent builds a spec procedurally — from the nodes it
 * just read, the models it just listed — and this renders it. A custom widget
 * (the registry) is for things this cannot express, not for asking a question.
 *
 * Two behaviours are load-bearing rather than cosmetic:
 *
 *   Required fields are enforced HERE, before submit, because the agent
 *   already said they were required and should not have to ask twice.
 *
 *   Nothing is autofocused, and a single-choice widget submits on selection
 *   only when it has one field. A form that submits under someone's hand
 *   while they are still reading it is worse than one extra click.
 * ========================================================================== */
import { useState } from 'react'
import type { ProposalAnswer, WidgetField, WidgetReply, WidgetSpec } from './contracts'
import { describe } from './messages'
import { WidgetBodyView } from './WidgetBody'
import { WidgetFrame } from './WidgetFrame'

export function Widget({
  spec,
  answered,
  superseded,
  onSubmit,
}: {
  spec: WidgetSpec
  /** Once answered the controls go inert and show what was chosen. A widget
   *  that stays live after it has been answered invites answering it twice. */
  answered?: WidgetReply
  /** The agent asked again under this id. Inert, and says so. */
  superseded?: boolean
  onSubmit: (reply: WidgetReply) => void
}) {
  const fields = spec.fields ?? []
  const [values, setValues] = useState<Record<string, unknown>>(() => initial(fields))
  const [missing, setMissing] = useState<string[]>([])

  function set(name: string, value: unknown): void {
    setValues((v) => ({ ...v, [name]: value }))
    setMissing((m) => m.filter((n) => n !== name))
  }

  function submit(override?: Record<string, unknown>): void {
    const payload = { ...values, ...(override ?? {}) }
    const absent = fields
      .filter((f) => f.required && isBlank(payload[f.name]))
      .map((f) => f.name)
    if (absent.length) {
      setMissing(absent)
      return
    }
    onSubmit({ widget_id: spec.id, values: payload })
  }

  const single = fields.length === 1 && fields[0].name === 'value'
  const submitLabel = spec.submit_label || (single ? '' : 'Send')

  if (superseded && !answered) {
    // Kept, not deleted: the agent did ask this, and a stream that quietly
    // loses a question makes the next one look like it came out of nowhere.
    return (
      <WidgetFrame tone="neutral" tag="Asked again" glyph="↺" title={spec.title} sub={spec.sub}>
        <WidgetBodyView spec={spec} />
        <span className="cai-detail">Replaced by the question below.</span>
      </WidgetFrame>
    )
  }

  if (spec.kind === 'propose_alternative') {
    return <Proposal spec={spec} answered={answered} onSubmit={onSubmit} />
  }

  if (answered) {
    return (
      <WidgetFrame tone="neutral" tag="Answered" glyph="✓" title={spec.title} sub={spec.sub}>
        <WidgetBodyView spec={spec} />
        <span className="cai-detail">{describe(spec, answered)}</span>
      </WidgetFrame>
    )
  }

  // A widget with a body and no fields is showing something, not asking. It
  // gets no submit affordance and no "Asked" tag, because nothing is pending.
  if (!fields.length) {
    return (
      <WidgetFrame tone="neutral" tag="Shown" glyph="▦" title={spec.title} sub={spec.sub}>
        <WidgetBodyView spec={spec} />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      tone="accent"
      tag="Asked"
      glyph="?"
      title={spec.title}
      sub={spec.sub}
      foot={
        submitLabel ? (
          <button type="button" className="cai-btn" onClick={() => submit()}>
            {submitLabel}
          </button>
        ) : null
      }
    >
      <WidgetBodyView spec={spec} />
      <div className="cai-fields">
        {fields.map((f) => (
          <Field
            key={f.name}
            field={f}
            value={values[f.name]}
            invalid={missing.includes(f.name)}
            onChange={(v) => set(f.name, v)}
            // A one-question widget commits the moment it is answered; there
            // is nothing else on it to fill in, and a Send button under a
            // single radio group is noise.
            onCommit={single ? (v) => submit({ [f.name]: v }) : undefined}
          />
        ))}
      </div>
    </WidgetFrame>
  )
}

/** An agent saying "I will, but I'd rather not, and here is why".
 *
 *  It exists as its own kind rather than as a two-option `choice` because of
 *  one property a generic choice cannot guarantee: WHICH ANSWER IS THE SAFE
 *  ONE IS DECIDED HERE, NOT BY THE AGENT. The operator's own request is always
 *  the first button and always the emphasised one; the agent's counter-proposal
 *  is always second and always the quiet one. An agent that could order these,
 *  label them, or choose which one looked like the obvious click could steer a
 *  decision by presentation, and an agent's disagreement should have to win on
 *  the reason it gave.
 *
 *  So the agent supplies prose and gets fixed controls. It is not being
 *  distrusted; it is being kept to arguing.
 *
 *  Neither button is autofocused, for the same reason no confirmation is: a
 *  decision reached by pressing Enter out of habit is not a decision. And this
 *  is NOT `awaiting_confirmation` — there is no parked run behind it and
 *  nothing is being written. It is an ordinary question, asked before the work
 *  rather than in the middle of it. */
function Proposal({
  spec,
  answered,
  onSubmit,
}: {
  spec: WidgetSpec
  answered?: WidgetReply
  onSubmit: (reply: WidgetReply) => void
}) {
  const send = (value: ProposalAnswer): void => onSubmit({ widget_id: spec.id, values: { value } })

  if (answered) {
    return (
      <WidgetFrame tone="neutral" tag="Answered" glyph="✓" title={spec.title} sub={spec.sub}>
        <WidgetBodyView spec={spec} />
        <span className="cai-detail">{describe(spec, answered)}</span>
      </WidgetFrame>
    )
  }

  return (
    // Accent, not warn. Warn is what a WRITE waiting on you looks like
    // (`confirmation`), and this is an ordinary question asked before any work
    // starts. Two amber cards meaning two different things is the flattening
    // that makes approving a write look like picking from a list. The pushback
    // still reads — it is the amber line inside the body, where the reason is.
    <WidgetFrame
      tone="accent"
      tag="Suggestion"
      glyph="↯"
      title={spec.title}
      sub={spec.sub ?? 'before I start'}
      foot={
        <>
          <button type="button" className="cai-btn" onClick={() => send('as_asked')}>
            Do it as I asked
          </button>
          <button type="button" className="cai-btn cai-ghost" onClick={() => send('alternative')}>
            Do it your way
          </button>
        </>
      }
    >
      <WidgetBodyView spec={spec} />
    </WidgetFrame>
  )
}

function Field({
  field,
  value,
  invalid,
  onChange,
  onCommit,
}: {
  field: WidgetField
  value: unknown
  invalid: boolean
  onChange: (value: unknown) => void
  onCommit?: (value: unknown) => void
}) {
  const type = field.type ?? 'text'
  const id = `cai-f-${field.name}`
  const describedBy = field.help ? `${id}-help` : undefined

  return (
    <div className={`cai-field${invalid ? ' cai-invalid' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>

      {type === 'select' && field.options ? (
        <div className="cai-options" role="group" aria-labelledby={id}>
          {field.options.map((o) => {
            const chosen = Array.isArray(value)
              ? (value as string[]).includes(o.value)
              : value === o.value
            return (
              <button
                key={o.value}
                type="button"
                className={`cai-opt${chosen ? ' cai-on' : ''}`}
                aria-pressed={chosen}
                title={o.hint}
                onClick={() => {
                  const next = Array.isArray(value)
                    ? toggle(value as string[], o.value)
                    : o.value
                  onChange(next)
                  onCommit?.(next)
                }}
              >
                {o.label ?? o.value}
              </button>
            )
          })}
        </div>
      ) : type === 'textarea' ? (
        <textarea
          id={id}
          className="cai-input"
          rows={3}
          aria-describedby={describedBy}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === 'checkbox' ? (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : (
        <input
          id={id}
          className="cai-input"
          type={type === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          aria-describedby={describedBy}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(type === 'number' ? numberOrBlank(e.target.value) : e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onCommit) {
              e.preventDefault()
              onCommit(
                type === 'number'
                  ? numberOrBlank((e.target as HTMLInputElement).value)
                  : (e.target as HTMLInputElement).value,
              )
            }
          }}
        />
      )}

      {field.help && (
        <span className="cai-help" id={describedBy}>
          {field.help}
        </span>
      )}
      {invalid && (
        <span className="cai-help cai-required" role="alert">
          {field.label} is needed.
        </span>
      )}
    </div>
  )
}

function initial(fields: WidgetField[]): Record<string, unknown> {
  const start: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.default !== undefined) start[f.name] = f.default
    else if (f.type === 'checkbox') start[f.name] = false
  }
  return start
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function numberOrBlank(raw: string): number | '' {
  if (raw === '') return ''
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : ''
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}
