/* ============================================================================
 * mount.ts — the window, for a host that is not a React application.
 *
 * Not every host is a React application. A Flask app is `app.py`, one Jinja
 * template, a stylesheet and hand-written vanilla JS — there is no
 * `package.json` in the repo, so there is nothing to `import` from, and
 * "droppable into any app" is not true of a package whose only entry point is
 * a TypeScript module.
 *
 * So this, plus the IIFE build, is the other half of being droppable. A page
 * adds a div, a stylesheet, an adapter and a script tag, and gets the same
 * window a React app gets. No wrapper component, no second implementation.
 *
 * It is also the right seam for a React app that renders the window from
 * outside its own tree — a portal target, a legacy screen — but a React app
 * should normally use `useChat` + `<ChatWindow>` and keep its own root.
 * ========================================================================== */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatWindow } from './ChatWindow'
import { createHttpChatClient, type ChatClient } from './client'
import { createChatStore, type ChatStore } from './store'
import type { ClientToolRegistry } from './tools'
import type { WidgetRegistry } from './widgets/registry'

export interface MountOptions {
  /** Which agent to talk to. */
  agentId: string
  /** Supply a client, or a `baseUrl` for the bundled one — not both. A host
   *  with its own fetch conventions (a mount prefix, a credential, a proxy)
   *  supplies the client; a plain page supplies the URL. */
  client?: ChatClient
  /** Where the agent host lives. Under a mount prefix, include it. */
  baseUrl?: string
  headers?: Record<string, string>
  title?: string
  subtitle?: string
  placeholder?: string
  draftKey?: string
  widgets?: WidgetRegistry
  /** Tools in this page the agent may call. Re-declared on every turn, so a
   *  page that swaps them as the operator moves around is fine. */
  tools?: ClientToolRegistry
  onClose?: () => void
  onConfirm?: (runId: string | undefined, outcome: 'approved' | 'denied') => void
}

export interface MountedChat {
  store: ChatStore
  unmount(): void
}

/** Render the window into an element, and hand back the way to take it down.
 *
 *  `target` may be an element or a selector, because the caller is often a
 *  script tag in a template that has a string and not a reference. */
export function mountChat(target: Element | string, options: MountOptions): MountedChat {
  const element = typeof target === 'string' ? document.querySelector(target) : target
  // Named, because the alternative is a null-pointer deep inside React that
  // says nothing about the selector that was wrong.
  if (!element) throw new Error(`mountChat: no element matched ${JSON.stringify(target)}`)

  const client =
    options.client ??
    createHttpChatClient({ baseUrl: options.baseUrl ?? '', headers: options.headers })
  const store = createChatStore(client, options.agentId)

  let root: Root | null = createRoot(element)
  root.render(
    createElement(ChatWindow, {
      store,
      title: options.title ?? options.agentId,
      subtitle: options.subtitle,
      placeholder: options.placeholder,
      draftKey: options.draftKey,
      widgets: options.widgets,
      tools: options.tools,
      onClose: options.onClose,
      onConfirm: options.onConfirm,
    }),
  )

  return {
    store,
    unmount() {
      // Idempotent: a page that tears down twice — a turbo navigation, a hot
      // reload — must not throw on the second one.
      root?.unmount()
      root = null
    },
  }
}
