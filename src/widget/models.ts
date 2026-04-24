/**
 * Widget Models — types for the embeddable aibyai chat widget.
 *
 * Modeled after Onyx's widget/ (Lit web component).
 */

export interface WidgetConfig {
  /** aibyai API base URL. */
  apiBaseUrl: string;
  /** API key or JWT for authentication. */
  apiKey?: string;
  /** Widget display mode. */
  mode: "floating" | "inline";
  /** Default knowledge base to search. */
  defaultKbId?: string;
  /** Widget title shown in header. */
  title: string;
  /** Placeholder text in input field. */
  placeholder: string;
  /** Primary theme color (hex). */
  primaryColor: string;
  /** Widget position (floating mode only). */
  position: "bottom-right" | "bottom-left";
  /** Initial greeting message. */
  greeting?: string;
  /** Whether to show sources in responses. */
  showSources: boolean;
  /** Session persistence via localStorage. */
  persistSession: boolean;
  /** Custom CSS class for the container. */
  containerClass?: string;
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  apiBaseUrl: "",
  mode: "floating",
  title: "AIBYAI",
  placeholder: "Ask a question...",
  primaryColor: "#6366f1",
  position: "bottom-right",
  showSources: true,
  persistSession: true,
};

export interface WidgetMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: WidgetSource[];
  timestamp: number;
  isStreaming?: boolean;
}

export interface WidgetSource {
  title: string;
  url?: string;
  excerpt: string;
}

/** SSE stream packet types from the API. */
export type StreamPacket =
  | { type: "message_delta"; content: string }
  | { type: "citation"; source: WidgetSource }
  | { type: "search_start"; query: string }
  | { type: "search_complete"; resultCount: number }
  | { type: "thinking"; content: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface WidgetTheme {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  inputBackground: string;
  userBubbleColor: string;
  assistantBubbleColor: string;
  fontFamily: string;
  fontSize: string;
  borderRadius: string;
}

export const DEFAULT_THEME: WidgetTheme = {
  primaryColor: "#6366f1",
  backgroundColor: "#ffffff",
  textColor: "#1f2937",
  borderColor: "#e5e7eb",
  inputBackground: "#f9fafb",
  userBubbleColor: "#6366f1",
  assistantBubbleColor: "#f3f4f6",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: "14px",
  borderRadius: "12px",
};
