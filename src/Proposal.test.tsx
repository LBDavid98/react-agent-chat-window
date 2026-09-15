import { fireEvent, render, screen } from '@testing-library/react'
import { describe as group, expect, it, vi } from 'vitest'
import type { WidgetSpec } from './contracts'
import { describe as describeReply, isPersistable } from './messages'
import { Widget } from './Widget'

const PROPOSAL: WidgetSpec = {
  id: 'p1',
  kind: 'propose_alternative',
  title: 'Before I widen that timeout',
  body: {
    asked: 'Raise survey.timeout_ms from 5000 to 20000.',
    instead: 'Point survey at the mesh route and leave the timeout alone.',
    because: 'It is not slow, it is unreachable — 20s of waiting still fails, four times more slowly.',
  },
}

group('an agent pushing back before it starts', () => {
  it('reads in the operator own order: asked, then suggested, then why', () => {
    render(<Widget spec={PROPOSAL} onSubmit={() => undefined} />)
    const terms = screen.getAllByRole('term').map((t) => t.textContent)
    expect(terms).toEqual(['You asked', "I'd suggest", 'Because'])
  })

  it('gives the operator own request the first and emphasised button', () => {
    // Not decoration. The agent supplies the prose and gets fixed controls, so
    // it cannot make its own idea the obvious click — a disagreement has to win
    // on the reason it gave, not on which button looks like the default.
    render(<Widget spec={PROPOSAL} onSubmit={() => undefined} />)
    const [first, second] = screen.getAllByRole('button')
    expect(first.textContent).toBe('Do it as I asked')
    expect(first.className).not.toContain('cai-ghost')
    expect(second.textContent).toBe('Do it your way')
    expect(second.className).toContain('cai-ghost')
  })

  it('autofocuses neither', () => {
    render(<Widget spec={PROPOSAL} onSubmit={() => undefined} />)
    for (const b of screen.getAllByRole('button')) expect(b).not.toBe(document.activeElement)
  })

  it('answers with a fixed value the agent did not choose', () => {
    const onSubmit = vi.fn()
    render(<Widget spec={PROPOSAL} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Do it your way'))
    expect(onSubmit).toHaveBeenCalledWith({ widget_id: 'p1', values: { value: 'alternative' } })
  })

  it('proceeding as asked says so', () => {
    const onSubmit = vi.fn()
    render(<Widget spec={PROPOSAL} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Do it as I asked'))
    expect(onSubmit).toHaveBeenCalledWith({ widget_id: 'p1', values: { value: 'as_asked' } })
  })

  it('goes inert once answered, and says which way it went', () => {
    render(
      <Widget
        spec={PROPOSAL}
        answered={{ widget_id: 'p1', values: { value: 'alternative' } }}
        onSubmit={() => undefined}
      />,
    )
    expect(screen.queryByText('Do it as I asked')).toBeNull()
    expect(screen.getByText('Do it your way.')).toBeTruthy()
  })

  it('is not persistable until it has been answered', () => {
    // The persistence rule: replaying a live control lets someone answer a
    // question whose turn ended days ago.
    const live = { id: 'm', role: 'agent', type: 'ask', spec: PROPOSAL } as const
    expect(isPersistable(live)).toBe(false)
    expect(isPersistable({ ...live, answered: { widget_id: 'p1', values: { value: 'as_asked' } } })).toBe(true)
  })

  it('describes its answer without any option labels to look it up in', () => {
    // Whole sentences: this string is also the `message` the store sends, and
    // the agent reads it as the thing the person said.
    expect(describeReply(PROPOSAL, { widget_id: 'p1', values: { value: 'as_asked' } })).toBe(
      'Go ahead as I asked.',
    )
    expect(describeReply(PROPOSAL, { widget_id: 'p1', values: { value: 'alternative' } })).toBe(
      'Do it your way.',
    )
  })
})
