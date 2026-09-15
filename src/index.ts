/* ============================================================================
 * react-agent-chat-window — an in-app chat window a host application embeds.
 *
 * What this package is: a turn stream, a widget kit, a composer, and a
 * placement. What it deliberately is not: a transport, a theme, or an opinion
 * about your state library. Those are the four things that made every previous
 * in-app chat unliftable from the app it grew in.
 * ========================================================================== */
export { ChatWindow } from './ChatWindow'
export { ChatDock, ChatLauncher, type Placement } from './ChatDock'
export { Composer } from './Composer'
export { MessageList } from './MessageList'
export { Widget } from './Widget'
export { WidgetBodyView } from './WidgetBody'
export { WidgetFrame, type FrameTone } from './WidgetFrame'
export { useChat, type ChatHandle } from './useChat'
export { mountChat, type MountOptions, type MountedChat } from './mount'
export { createChatStore, type ChatState, type ChatStore } from './store'
export { createHttpChatClient, type ChatClient, type HttpChatClientOptions, type TurnInput } from './client'
export { applyEvent, describe, fromTranscript, isPersistable, messageId, type ChatMessage, type ChatRole } from './messages'
export { widgetFor, type WidgetProps, type WidgetRegistry } from './widgets/registry'
export {
  clientToolsFromManifest,
  declareTools,
  uxToolRegistry,
  type ClientToolDefinition,
  type ClientToolRegistry,
  type UxResolver,
} from './tools'
export {
  UX_VERBS,
  type Action,
  TERMINAL_KINDS,
  isTerminal,
  type AgentCard,
  type ClientTool,
  type ToolResult,
  type FieldType,
  type Modality,
  type Persona,
  type SessionRef,
  type TranscriptEntry,
  type TurnEvent,
  type TurnEventKind,
  type WidgetBar,
  type WidgetBody,
  type WidgetColumn,
  type WidgetField,
  type WidgetKind,
  type WidgetMetric,
  type WidgetOption,
  type WidgetReply,
  type WidgetSpec,
  type WidgetStep,
} from './contracts'
