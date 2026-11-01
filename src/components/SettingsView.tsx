import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, Keyboard, Loader2, RefreshCw } from "lucide-react";
import { api, errorMessage, type ModelInfo, type OllamaStatus, type Settings, type ShortcutInfo } from "../lib/api";
import { LANGUAGES, OUTPUT_TYPES, TONES } from "../lib/options";
import { formatSize } from "../lib/models";
import { IconButton, Select } from "./ui";

interface Props {
  settings: Settings;
  shortcut: ShortcutInfo | null;
  status: OllamaStatus | null;
  models: ModelInfo[];
  activeModel: string | null;
  refreshing: boolean;
  onBack: () => void;
  onSave: (s: Settings) => Promise<void>;
  onRefresh: (url?: string) => void;
  onShortcutChange: (info: ShortcutInfo) => void;
}

const PRESETS = ["Ctrl+K", "Ctrl+Alt+K", "Ctrl+Shift+Space", "Alt+Space"];

/** Turn a keydown into an accelerator string such as "Ctrl+Alt+K". */
function accelFromEvent(e: React.KeyboardEvent): string | null {
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (["Slash", "Period", "Comma", "Semicolon", "Backquote", "Enter"].includes(code)) key = code;
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11.5px] font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <div className="text-[11px] leading-snug text-zinc-500">{hint}</div>}
    </label>
  );
}

const inputCls =
  "h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[12.5px] outline-none focus:border-accent dark:border-zinc-700/80 dark:bg-zinc-800/60";

export default function SettingsView(props: Props) {
  const { settings, shortcut, status, models, activeModel, refreshing } = props;
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accel, setAccel] = useState(shortcut?.preferred ?? settings.shortcut);
  const [recording, setRecording] = useState(false);
  const [shortcutMsg, setShortcutMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);

  useEffect(() => setDraft((d) => ({ ...d, launchAtStartup: settings.launchAtStartup })), [settings.launchAtStartup]);

  const llamas = models.filter((m) => m.isLlama);
  const others = models.length - llamas.length;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await props.onSave(draft);
      setSaved(true);
      props.onRefresh(draft.ollamaUrl);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function applyShortcut(value: string) {
    setShortcutMsg(null);
    try {
      const info = await api.setShortcut(value);
      props.onShortcutChange(info);
      setAccel(value);
      setShortcutMsg({ ok: true, text: `${value} now opens Aktobly from anywhere.` });
    } catch (e) {
      setShortcutMsg({ ok: false, text: errorMessage(e) });
    }
  }

  async function toggleStartup(enabled: boolean) {
    setStartupBusy(true);
    try {
      const actual = await api.setLaunchAtStartup(enabled);
      set("launchAtStartup", actual);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStartupBusy(false);
    }
  }

  const isRemoteDraft = (() => {
    try {
      const u = new URL(draft.ollamaUrl.includes("://") ? draft.ollamaUrl : `http://${draft.ollamaUrl}`);
      return !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && !u.hostname.startsWith("127.");
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <IconButton onClick={props.onBack} title="Back (Esc)">
          <ArrowLeft size={15} />
        </IconButton>
        <span className="text-[13px] font-semibold">Settings</span>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ollama</h3>
          <Field
            label="Endpoint URL"
            hint={
              isRemoteDraft ? (
                <span className="flex gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={12} className="mt-px shrink-0" />
                  Remote server: everything you write will be sent to this machine over the network.
                </span>
              ) : (
                "Local by default — your text never leaves this computer."
              )
            }
          >
            <input
              className={inputCls}
              value={draft.ollamaUrl}
              onChange={(e) => set("ollamaUrl", e.target.value)}
              spellCheck={false}
              placeholder="http://127.0.0.1:11434"
            />
          </Field>

          <div className="flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-2 text-[12px] dark:bg-zinc-800/50">
            <span className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${status?.reachable ? "bg-emerald-500" : status ? "bg-red-500" : "bg-zinc-400"}`}
              />
              {status?.reachable ? `Connected · Ollama ${status.version ?? ""}` : status ? "Not connected" : "Checking…"}
            </span>
            <IconButton onClick={() => props.onRefresh(draft.ollamaUrl)} disabled={refreshing}>
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh models
            </IconButton>
          </div>
          {status && !status.reachable && status.error && (
            <p className="text-[11.5px] leading-snug text-red-600 dark:text-red-400">{status.error}</p>
          )}

          <Field
            label="Model"
            hint={
              llamas.length === 0
                ? "No Meta Llama model found. Run: ollama pull llama3.1:8b"
                : others > 0
                  ? `${others} non-Llama model${others > 1 ? "s" : ""} hidden — Aktobly only uses Meta Llama.`
                  : undefined
            }
          >
            <select
              className={inputCls}
              value={draft.model ?? ""}
              onChange={(e) => set("model", e.target.value || null)}
            >
              <option value="">Automatic{activeModel && !draft.model ? ` (${activeModel})` : ""}</option>
              {llamas.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} · {m.parameterSize ?? "?"} · {formatSize(m.sizeBytes)}
                </option>
              ))}
              {draft.model && !llamas.some((m) => m.name === draft.model) && (
                <option value={draft.model}>{draft.model} (not installed)</option>
              )}
            </select>
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Defaults</h3>
          <Field label="Output type">
            <Select className="w-full" options={OUTPUT_TYPES} value={draft.defaultOutputType} onChange={(e) => set("defaultOutputType", e.target.value)} />
          </Field>
          <Field label="Target language">
            <Select className="w-full" options={LANGUAGES} value={draft.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value)} />
          </Field>
          <Field label="Tone">
            <Select className="w-full" options={TONES} value={draft.defaultTone} onChange={(e) => set("defaultTone", e.target.value)} />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Shortcut</h3>
          <Field
            label="Global shortcut"
            hint={
              shortcutMsg ? (
                <span className={shortcutMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                  {shortcutMsg.text}
                </span>
              ) : (
                `Active now: ${shortcut?.active ?? "none"}. Note: a global shortcut takes the key away from other apps.`
              )
            }
          >
            <div className="flex gap-1.5">
              <input
                className={`${inputCls} ${recording ? "border-accent" : ""}`}
                value={recording ? "Press keys…" : accel}
                readOnly={recording}
                onChange={(e) => setAccel(e.target.value)}
                onKeyDown={(e) => {
                  if (!recording) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const a = accelFromEvent(e);
                  if (a) {
                    setAccel(a);
                    setRecording(false);
                  }
                }}
                onBlur={() => setRecording(false)}
                spellCheck={false}
              />
              <IconButton
                className="border border-zinc-200 dark:border-zinc-700"
                title="Record a shortcut"
                onClick={(e) => {
                  setRecording(true);
                  (e.currentTarget.previousElementSibling as HTMLInputElement)?.focus();
                }}
              >
                <Keyboard size={13} />
              </IconButton>
              <IconButton className="border border-zinc-200 px-2 dark:border-zinc-700" onClick={() => applyShortcut(accel)}>
                Apply
              </IconButton>
            </div>
          </Field>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyShortcut(p)}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${shortcut?.active === p ? "border-accent text-accent" : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">App</h3>
          <Field label="Theme">
            <Select
              className="w-full"
              options={[
                { id: "system", label: "System", guide: "" },
                { id: "light", label: "Light", guide: "" },
                { id: "dark", label: "Dark", guide: "" },
              ]}
              value={draft.theme}
              onChange={(e) => set("theme", e.target.value as Settings["theme"])}
            />
          </Field>
          <Toggle
            label="Launch at Windows startup"
            hint="Starts silently in the tray."
            checked={draft.launchAtStartup}
            disabled={startupBusy}
            onChange={toggleStartup}
          />
          <Toggle
            label="Hide when switching apps"
            hint="Off: the popup stays on top until you press the shortcut or Esc."
            checked={draft.hideOnBlur}
            onChange={(v) => set("hideOnBlur", v)}
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            Privacy: no accounts, analytics or history. Aktobly only reads what you type into it.
          </p>
        </section>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        {error && <span className="flex-1 text-[11.5px] leading-snug text-red-600 dark:text-red-400">{error}</span>}
        {!error && saved && (
          <span className="flex flex-1 items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
            <Check size={12} /> Saved
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-8 rounded-md bg-zinc-900 px-3 text-[12.5px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
    >
      <span>
        <span className="block text-[12.5px]">{props.label}</span>
        {props.hint && <span className="block text-[11px] text-zinc-500">{props.hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${props.checked ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${props.checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
