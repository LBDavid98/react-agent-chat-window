import { fireEvent, render, screen } from '@testing-library/react'
import { describe as group, expect, it, vi } from 'vitest'
import type { WidgetSpec } from './contracts'
import { describe as describeReply } from './messages'
import { Widget } from './Widget'

const PICK: WidgetSpec = {
  id: 'pick',
  kind: 'choice',
  title: 'Which node retries?',
  fields: [
    {
      name: 'value',
      label: 'Node',
      type: 'select',
      required: true,
      options: [
        { value: 'n-1', label: 'Fetch' },
        { value: 'n-2', label: 'Summarise' },
      ],
    },
  ],
}

group('a widget that asks', () => {
  it('answers with the option value, not the label the person read', () => {
    const onSubmit = vi.fn()
    render(<Widget spec={PICK} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Summarise' }))
    expect(onSubmit).toHaveBeenCalledWith({ widget_id: 'pick', values: { value: 'n-2' } })
  })

  it('holds a required field rather than letting the agent ask twice', () => {
    const onSubmit = vi.fn()
    const form: WidgetSpec = {
      id: 'f',
      kind: 'form',
      title: 'Retry policy',
      submit_label: 'Send',
      fields: [
        { name: 'attempts', label: 'Attempts', type: 'number', required: true },
        { name: 'note', label: 'Note' },
      ],
    }
    render(<Widget spec={form} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Attempts is needed')
  })

  it('goes inert once answered, and says what was chosen', () => {
    render(
      <Widget spec={PICK} answered={{ widget_id: 'pick', values: { value: 'n-2' } }} onSubmit={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Summarise' })).toBeNull()
    expect(screen.getByText('Summarise')).toBeTruthy()
  })
})

group('a widget that only shows', () => {
  it('offers nothing to submit', () => {
    render(
      <Widget
        spec={{
          id: 't',
          kind: 'table',
          title: 'Recent runs',
          body: { columns: [{ key: 'id' }], rows: [['run-1'], ['run-2']] },
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('run-2')).toBeTruthy()
  })

  it('draws the evidence and asks in the same card', () => {
    render(
      <Widget
        spec={{
          id: 'pick-run',
          kind: 'table',
          title: 'Which run went wrong?',
          submit_label: 'Send',
          body: { columns: [{ key: 'id' }], rows: [['run-1'], ['run-2']] },
          fields: PICK.fields,
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText('run-2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeTruthy()
  })
})

group('reading an answer back', () => {
  it('resolves labels so a transcript is legible a week later', () => {
    expect(describeReply(PICK, { widget_id: 'pick', values: { value: 'n-2' } })).toBe('Summarise')
  })

  it('names each field when several were answered', () => {
    const form: WidgetSpec = {
      id: 'f',
      kind: 'form',
      title: 'Retry',
      fields: [
        { name: 'attempts', label: 'Attempts', type: 'number' },
        { name: 'backoff', label: 'Backoff', type: 'select', options: [{ value: 'exp', label: 'Exponential' }] },
      ],
    }
    expect(
      describeReply(form, { widget_id: 'f', values: { attempts: 3, backoff: 'exp' } }),
    ).toBe('Attempts: 3 · Backoff: Exponential')
  })
})

group('a form the agent arrived with already filled in', () => {
  // An agent builds these procedurally from what it just read, so every field has a
  // value before anyone touches it. If a default does not reach the control the
  // person retypes what the agent already knew, which is the exact round trip
  // widgets exist to remove.
  const FILLED: WidgetSpec = {
    id: 'intake',
    kind: 'form',
    title: 'New knowledge node',
    fields: [
      { name: 'name', label: 'Name', type: 'text', default: 'vault-lookup' },
      { name: 'why', label: 'Why', type: 'textarea', default: 'answers from the vault' },
      { name: 'top_k', label: 'Results', type: 'number', default: 5 },
      { name: 'cite', label: 'Cite', type: 'checkbox', default: true },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'strict',
        options: [
          { value: 'strict', label: 'Strict' },
          { value: 'loose', label: 'Loose' },
        ],
      },
    ],
  }

  it('shows every default in its control', () => {
    render(<Widget spec={FILLED} onSubmit={() => undefined} />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('vault-lookup')
    expect((screen.getByLabelText('Why') as HTMLTextAreaElement).value).toBe('answers from the vault')
    expect((screen.getByLabelText('Results') as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText('Cite') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Strict').getAttribute('aria-pressed')).toBe('true')
  })

  it('sends them back untouched when nothing is changed', () => {
    const onSubmit = vi.fn()
    render(<Widget spec={FILLED} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Send'))
    expect(onSubmit).toHaveBeenCalledWith({
      widget_id: 'intake',
      values: { name: 'vault-lookup', why: 'answers from the vault', top_k: 5, cite: true, mode: 'strict' },
    })
  })
})
