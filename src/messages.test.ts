import { describe as group, expect, it } from 'vitest'
import type { TurnEvent } from './contracts'
import { applyEvent, isPersistable, type ChatMessage } from './messages'

function fold(events: TurnEvent[]): ChatMessage[] {
  return events.reduce<ChatMessage[]>((acc, e) => applyEvent(acc, e), [])
}

group('folding a turn into messages', () => {
  it('finishes the running tool row instead of adding a second one', () => {
    const out = fold([
      { kind: 'turn_started' },
      { kind: 'tool_running', tool: 'read_design' },
      { kind: 'tool_result', tool: 'read_design', effect: 'read' },
      { kind: 'final', text: 'done' },
    ])
    const tools = out.filter((m) => m.type === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ state: 'done', effect: 'read' })
  })

  it('marks a tool that failed, and keeps the reason', () => {
    const out = fold([
      { kind: 'turn_started' },
      { kind: 'tool_running', tool: 'write_design' },
      { kind: 'tool_result', tool: 'write_design', detail: 'refused: no such node' },
      { kind: 'error', detail: 'the run failed' },
    ])
    expect(out.find((m) => m.type === 'tool')).toMatchObject({
      state: 'failed',
      detail: 'refused: no such node',
    })
  })

  it('fills the pending reply rather than appending beside it', () => {
    const out = fold([
      { kind: 'turn_started' },
      { kind: 'partial', text: 'It ' },
      { kind: 'partial', text: 'lives.' },
      { kind: 'final', text: 'It lives.' },
    ])
    const texts = out.filter((m) => m.type === 'text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatchObject({ text: 'It lives.', pending: false })
  })

  it('leaves nothing behind when a turn produced no text', () => {
    // An empty bubble is a visible defect; a placeholder pretending to be an
    // answer is worse.
    expect(fold([{ kind: 'turn_started' }, { kind: 'final', text: '' }])).toEqual([])
  })

  it('keeps what a stopped turn had already said', () => {
    const out = fold([
      { kind: 'turn_started' },
      { kind: 'partial', text: 'Half an ans' },
      { kind: 'interrupted', detail: 'cancelled' },
    ])
    expect(out.find((m) => m.type === 'text')).toMatchObject({
      text: 'Half an ans',
      pending: false,
    })
    expect(out.at(-1)).toMatchObject({ type: 'notice', tone: 'stopped' })
  })

  it('surfaces the server reason rather than a generic apology', () => {
    const out = fold([{ kind: 'turn_started' }, { kind: 'error', detail: 'budget_exceeded:cost' }])
    expect(out.at(-1)).toMatchObject({ text: 'budget_exceeded:cost' })
  })

  it('renders a widget the agent put up', () => {
    const out = fold([
      { kind: 'turn_started' },
      { kind: 'awaiting_input', widget: { id: 'w', kind: 'choice', title: 'Which?' } },
    ])
    expect(out.at(-1)).toMatchObject({ type: 'ask', spec: { id: 'w' } })
  })

  it('ignores an awaiting_input carrying no widget', () => {
    expect(fold([{ kind: 'turn_started' }, { kind: 'awaiting_input' }])).toHaveLength(1)
  })
})

group('what may be replayed after a reload', () => {
  it('never replays a live control', () => {
    // Replaying either would let someone approve a write twice, or answer a
    // question whose turn ended days ago.
    expect(
      isPersistable({ id: 'c', role: 'agent', type: 'confirmation', tool: 't', summary: 's' }),
    ).toBe(false)
    expect(
      isPersistable({ id: 'w', role: 'agent', type: 'ask', spec: { id: 'w', kind: 'choice', title: 'x' } }),
    ).toBe(false)
  })

  it('replays a widget that has already been answered', () => {
    expect(
      isPersistable({
        id: 'w',
        role: 'agent',
        type: 'ask',
        spec: { id: 'w', kind: 'choice', title: 'x' },
        answered: { widget_id: 'w', values: { value: 'a' } },
      }),
    ).toBe(true)
  })

  it('replays plain content', () => {
    expect(isPersistable({ id: 't', role: 'agent', type: 'text', text: 'hi' })).toBe(true)
  })
})

group('an agent that asks again under the same widget id', () => {
  const ask = (id: string, title: string): TurnEvent => ({
    kind: 'awaiting_input',
    widget: { id, kind: 'choice', title, fields: [{ name: 'value', label: 'Pick' }] },
  })

  it('kills the controls on the first one', () => {
    // The host replaces the spec it kept and describes any answer against the
    // NEW one, so an answer to the old card would come back through the wrong
    // labels. Two live cards under one id is also two questions the agent
    // cannot tell apart.
    const out = fold([ask('w1', 'Which model?'), ask('w1', 'Which model, of these three?')])
    const asks = out.filter((m) => m.type === 'ask')
    expect(asks).toHaveLength(2)
    expect(asks[0]).toMatchObject({ superseded: true })
    expect(asks[1]).not.toHaveProperty('superseded')
  })

  it('keeps it in the stream rather than erasing it', () => {
    // It was asked. A stream that quietly loses a question makes the next one
    // look like it came out of nowhere.
    const out = fold([ask('w1', 'Which model?'), ask('w1', 'Which model, of these three?')])
    expect((out.filter((m) => m.type === 'ask')[0] as { spec: { title: string } }).spec.title).toBe(
      'Which model?',
    )
  })

  it('leaves a different widget id alone', () => {
    const out = fold([ask('w1', 'Which model?'), ask('w2', 'Which node?')])
    for (const m of out.filter((m) => m.type === 'ask')) expect(m).not.toHaveProperty('superseded')
  })

  it('leaves an already-answered one alone', () => {
    const first = fold([ask('w1', 'Which model?')]).map((m) =>
      m.type === 'ask' ? { ...m, answered: { widget_id: 'w1', values: { value: 'a' } } } : m,
    )
    const out = applyEvent(first, ask('w1', 'Which model, of these three?'))
    expect(out.filter((m) => m.type === 'ask')[0]).not.toHaveProperty('superseded')
  })

  it('is persistable once superseded — nothing live is left to replay', () => {
    const out = fold([ask('w1', 'Which model?'), ask('w1', 'Which model, of these three?')])
    const [first, second] = out.filter((m) => m.type === 'ask')
    expect(isPersistable(first)).toBe(true)
    expect(isPersistable(second)).toBe(false)
  })
})
