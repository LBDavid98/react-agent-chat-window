/* ============================================================================
 * registry.ts — how a host application adds its own widgets.
 *
 * Aurora's chat grew an arc builder and a comic-page builder; a studio's
 * chat wants a graph diff. Those belong to their apps, not to this package —
 * but they belong INSIDE the message stream, in the same frame as everything
 * else, or they read as a bolted-on panel.
 *
 * So: the frame and the stream are here, the widgets are registered. A kind
 * nobody registered renders nothing rather than throwing — a message from a
 * newer host than this bundle is a thing to ignore, not a crash.
 * ========================================================================== */
import type { ComponentType } from 'react'

export interface WidgetProps<P = unknown> {
  payload: P
  /** Put text in the composer and send it, as though the person had typed it. */
  send: (text: string) => void
}

export type WidgetRegistry = Record<string, ComponentType<WidgetProps<never>>>

export function widgetFor(
  registry: WidgetRegistry | undefined,
  kind: string,
): ComponentType<WidgetProps<never>> | null {
  return registry?.[kind] ?? null
}
