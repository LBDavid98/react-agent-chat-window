/* ============================================================================
 * WidgetFrame.tsx — one frame, every widget.
 *
 * Lifted in spirit from Aurora's `AWFrame`, and the reason is the same: a
 * chat where each widget invents its own chrome reads as a pile of unrelated
 * cards. Icon, title, tag, body, foot — in that order, always.
 * ========================================================================== */
import type { ReactNode } from 'react'

export type FrameTone = 'neutral' | 'accent' | 'warn' | 'danger'

export function WidgetFrame({
  tone = 'neutral',
  tag,
  title,
  sub,
  glyph,
  children,
  foot,
}: {
  tone?: FrameTone
  tag: string
  title: string
  sub?: string
  /** A single character or short symbol. Deliberately not an icon set: this
   *  package has no dependencies and no opinion about the host's icons. */
  glyph?: string
  children?: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className={`cai-w cai-w-${tone}`}>
      <div className="cai-w-head">
        {glyph && <span className="cai-w-glyph" aria-hidden="true">{glyph}</span>}
        <div className="cai-w-headtext">
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </div>
        <span className="cai-w-tag">{tag}</span>
      </div>
      {children && <div className="cai-w-body">{children}</div>}
      {foot && <div className="cai-w-foot">{foot}</div>}
    </div>
  )
}
