// Typed wrappers around the Rust commands.

import { Channel, invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export interface Settings {
  ollamaUrl: string;
  model: string | null;
  defaultOutputType: string;
  defaultLanguage: string;
  defaultTone: string;
  lastOutputType: string | null;
  lastLanguage: string | null;
  lastTone: string | null;
  shortcut: string;
  theme: "system" | "light" | "dark";
  launchAtStartup: boolean;
  hideOnBlur: boolean;
}

export interface ShortcutInfo {
  active: string | null;
  preferred: string;
  warning: string | null;
}

export interface OllamaStatus {
  reachable: boolean;
  version: string | null;
  baseUrl: string;
  isRemote: boolean;
  error: string | null;
}

export interface ModelInfo {
  name: string;
  family: string | null;
  parameterSize: string | null;
  sizeBytes: number;
  isLlama: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateResult {
  text: string;
  stopped: boolean;
  evalCount: number | null;
  totalDurationMs: number | null;
}

type StreamEvent = { type: "delta"; content: string };

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  getShortcutInfo: () => invoke<ShortcutInfo>("get_shortcut_info"),
  setShortcut: (shortcut: string) => invoke<ShortcutInfo>("set_shortcut", { shortcut }),
  setLaunchAtStartup: (enabled: boolean) => invoke<boolean>("set_launch_at_startup", { enabled }),
  hideWindow: () => invoke<void>("hide_window"),
  status: (baseUrl: string) => invoke<OllamaStatus>("ollama_status", { baseUrl }),
  models: (baseUrl: string) => invoke<ModelInfo[]>("ollama_models", { baseUrl }),
  stop: () => invoke<void>("ollama_stop"),
  preload: (baseUrl: string, model: string) => invoke<void>("ollama_preload", { baseUrl, model }),
  generate(
    baseUrl: string,
    model: string,
    messages: ChatMessage[],
    temperature: number,
    onDelta: (chunk: string) => void,
  ) {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (ev) => {
      if (ev.type === "delta") onDelta(ev.content);
    };
    return invoke<GenerateResult>("ollama_generate", {
      request: { baseUrl, model, messages, temperature },
      onEvent: channel,
    });
  },
};

export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    // Fall back to the web clipboard API if the native plugin fails.
    await navigator.clipboard.writeText(text);
  }
}

export const errorMessage = (e: unknown): string =>
  typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
