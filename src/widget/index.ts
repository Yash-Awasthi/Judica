/**
 * Widget Entry Point — auto-registers the <judica-widget> custom element.
 */

export { AibyaiWidget } from "./widget.js";
export type {
  WidgetConfig,
  WidgetMessage,
  WidgetSource,
  WidgetTheme,
  StreamPacket,
} from "./models.js";
export { DEFAULT_WIDGET_CONFIG, DEFAULT_THEME } from "./models.js";
export { generateWidgetStyles } from "./styles.js";

// Auto-register the custom element when loaded in a browser context
if (typeof customElements !== "undefined") {
  const { AibyaiWidget } = await import("./widget.js");
  if (!customElements.get("judica-widget")) {
    customElements.define("judica-widget", AibyaiWidget);
  }
}
