import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  Eraser,
  Loader2,
  RotateCcw,
  Scissors,
  Settings as SettingsIcon,
  Smile,
  Sparkles,
  Square,
  Briefcase,
  Wand2,
  X,
} from "lucide-react";
import { api, copyText, errorMessage, type ModelInfo, type OllamaStatus, type Settings, type ShortcutInfo } from "./lib/api";
import { byId, isValid, LANGUAGES, OUTPUT_TYPES, TONES } from "./lib/options";
import { buildGenerateMessages, buildRefineMessages, cleanOutput, type Refinement, type Selection } from "./lib/prompts";
import { DETECTED_LABEL, detectLanguage, directionOf } from "./lib/detect";
import { pickModel } from "./lib/models";
import { IconButton, Kbd, Logo, Select } from "./components/ui";
import SettingsView from "./components/SettingsView";

type Phase = "idle" | "generating";
type LastRequest = { kind: "generate"; draft: string; sel: Selection } | { kind: "refine"; how: Refinement; text: string; sel: Selection };

const STATUS_POLL_MS = 20_000;
const PRELOAD_EVERY_MS = 10 * 60_000;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shortcut, setShortcut] = useState<ShortcutInfo | null>(null);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"main" | "settings">("main");

  const [sel, setSel] = useState<Selection>({ outputType: OUTPUT_TYPES[0].id, language: LANGUAGES[0].id, tone: TONES[0].id });
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [last, setLast] = useState<LastRequest | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runId = useRef(0);
  const lastPreload = useRef<{ model: string; at: number } | null>(null);
  const lastStatusAt = useRef(0);

  const activeModel = useMemo(() => pickModel(models, settings?.model ?? null), [models, settings?.model]);
  const generating = phase === "generating";

  // ------------------------------------------------------------ bootstrap & ollama status

  const refresh = useCallback(async (url?: string) => {
    const base = url ?? settings?.ollamaUrl;
    if (!base) return;
    setRefreshing(true);
    lastStatusAt.current = Date.now();
    try {
      const st = await api.status(base);
      setStatus(st);
      setModels(st.reachable ? await api.models(base) : []);
    } catch (e) {
      setStatus({ reachable: false, version: null, baseUrl: base, isRemote: false, error: errorMessage(e) });
      setModels([]);
    } finally {
      setRefreshing(false);
    }
  }, [settings?.ollamaUrl]);

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      setSel({
        outputType: isValid(OUTPUT_TYPES, s.lastOutputType) ? s.lastOutputType : byId(OUTPUT_TYPES, s.defaultOutputType).id,
        language: isValid(LANGUAGES, s.lastLanguage) ? s.lastLanguage : byId(LANGUAGES, s.defaultLanguage).id,
        tone: isValid(TONES, s.lastTone) ? s.lastTone : byId(TONES, s.defaultTone).id,
      });
      setShortcut(await api.getShortcutInfo());
    })().catch((e) => setError(`Couldn't load settings: ${errorMessage(e)}`));
  }, []);

  useEffect(() => {
    if (settings?.ollamaUrl) refresh();
  }, [settings?.ollamaUrl, refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !generating) refresh();
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, generating]);

  // Warm the model so the first generation after opening is fast.
  const preload = useCallback(() => {
    if (!settings || !activeModel || !status?.reachable) return;
    const p = lastPreload.current;
    if (p && p.model === activeModel && Date.now() - p.at < PRELOAD_EVERY_MS) return;
    lastPreload.current = { model: activeModel, at: Date.now() };
    api.preload(settings.ollamaUrl, activeModel).catch(() => {});
  }, [settings, activeModel, status?.reachable]);
  useEffect(preload, [preload]);

  // ------------------------------------------------------------ theme

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = settings?.theme ?? "system";
      document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && mq.matches));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings?.theme]);

  // ------------------------------------------------------------ window events

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const un = [
      listen("aktobly://shown", () => {
        setView((v) => v); // keep current view
        requestAnimationFrame(focusInput);
        if (Date.now() - lastStatusAt.current > 5000) refresh();
        preload();
      }),
      listen("aktobly://open-settings", () => setView("settings")),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, [focusInput, refresh, preload]);

  useEffect(() => {
    if (view === "main") requestAnimationFrame(focusInput);
  }, [view, focusInput]);

  // Auto-grow the input up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [input, view]);

  // ------------------------------------------------------------ selection persistence

  const updateSel = (patch: Partial<Selection>) => {
    const next = { ...sel, ...patch };
    setSel(next);
    if (!settings) return;
    const s = { ...settings, lastOutputType: next.outputType, lastLanguage: next.language, lastTone: next.tone };
    setSettings(s);
    api.saveSettings(s).catch(() => {});
  };

  // ------------------------------------------------------------ generation

  const run = async (req: LastRequest, temperature: number) => {
    if (!settings) return;
    if (!status?.reachable) {
      setError(status?.error ?? "Ollama isn't reachable. Start Ollama, then click Retry.");
      setLast(req);
      return;
    }
    if (!activeModel) {
      setError("No Meta Llama model is installed. Open a terminal and run:  ollama pull llama3.1:8b");
      setLast(req);
      return;
    }
    const id = ++runId.current;
    const previous = output;
    const messages =
      req.kind === "generate" ? buildGenerateMessages(req.draft, req.sel) : buildRefineMessages(req.text, req.how, req.sel);
    setLast(req);
    setError(null);
    setNotice(null);
    setCopied(false);
    setOutput("");
    setPhase("generating");
    try {
      const res = await api.generate(settings.ollamaUrl, activeModel, messages, temperature, (chunk) => {
        if (runId.current === id) setOutput((o) => o + chunk);
      });
      if (runId.current !== id) return;
      if (res.stopped) {
        setNotice("Stopped.");
        setOutput(res.text.trim() || (req.kind === "refine" ? previous : ""));
      } else {
        const text = cleanOutput(res.text, req.sel);
        setOutput(text);
        if (!text) setError("The model returned an empty response. Click Retry or try a different model.");
      }
    } catch (e) {
      if (runId.current !== id) return;
      setError(errorMessage(e));
      if (req.kind === "refine") setOutput(previous);
    } finally {
      if (runId.current === id) setPhase("idle");
    }
  };

  const generate = () => {
    if (generating) return;
    const draft = input.trim();
    if (!draft) {
      focusInput();
      return;
    }
    run({ kind: "generate", draft, sel }, 0.4);
  };

  const refine = (how: Refinement) => {
    if (generating || !output.trim()) return;
    run({ kind: "refine", how, text: output, sel }, 0.4);
  };

  const regenerate = () => {
    if (generating || !last) return;
    // Retry an identical request; regenerate gets a little more variety.
    run({ ...last, sel: last.kind === "generate" ? sel : last.sel } as LastRequest, error ? 0.4 : 0.75);
  };

  const stop = () => {
    api.stop().catch(() => {});
  };

  const copy = async () => {
    if (!output.trim()) return;
    try {
      await copyText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(`Couldn't copy to the clipboard: ${errorMessage(e)}. Select the text and press Ctrl+C instead.`);
    }
  };

  const swap = () => {
    const lang = byId(LANGUAGES, sel.language);
    if (output.trim() && !generating) {
      setInput(output);
      setOutput("");
      setLast(null);
    }
    updateSel({ language: lang.swap });
  };

  const clear = () => {
    setInput("");
    setOutput("");
    setError(null);
    setNotice(null);
    setLast(null);
    focusInput();
  };

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        if (generating) stop();
        else if (view === "settings") setView("main");
        else api.hideWindow();
        return;
      }
      // Block webview reload / find / print shortcuts that make no sense here.
      if ((ctrl && ["r", "p", "f", "g", "j", "u"].includes(e.key.toLowerCase())) || e.key === "F5") {
        e.preventDefault();
        if (ctrl && e.key.toLowerCase() === "r" && view === "main") regenerate();
        return;
      }
      if (ctrl && e.key === ",") {
        e.preventDefault();
        setView((v) => (v === "main" ? "settings" : "main"));
        return;
      }
      if (view !== "main") return;
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        generate();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copy();
      } else if (ctrl && e.key.toLowerCase() === "l") {
        e.preventDefault();
        clear();
      } else if (e.altKey && !ctrl) {
        const map: Record<string, Refinement> = { s: "shorten", i: "improve", f: "formal", w: "friendly" };
        const how = map[e.key.toLowerCase()];
        if (how) {
          e.preventDefault();
          refine(how);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------ render

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        settings={settings}
        shortcut={shortcut}
        status={status}
        models={models}
        activeModel={activeModel}
        refreshing={refreshing}
        onBack={() => setView("main")}
        onRefresh={refresh}
        onShortcutChange={setShortcut}
        onSave={async (s) => {
          const saved = await api.saveSettings(s);
          const defaultsChanged =
            saved.defaultOutputType !== settings.defaultOutputType ||
            saved.defaultLanguage !== settings.defaultLanguage ||
            saved.defaultTone !== settings.defaultTone;
          setSettings(saved);
          if (defaultsChanged) {
            setSel({ outputType: saved.defaultOutputType, language: saved.defaultLanguage, tone: saved.defaultTone });
          }
        }}
      />
    );
  }

  const detected = detectLanguage(input);
  const inputDir = directionOf(input);
  const outputDir = directionOf(output);
  const connected = !!status?.reachable;
  const hasOutput = output.trim().length > 0;
  const keyHint = shortcut?.active ?? settings.shortcut;

  return (
    <div className="flex h-full flex-col">
      {/* Header — draggable */}
      <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-100 pl-3 pr-1.5 dark:border-zinc-800">
        <span data-tauri-drag-region className="flex items-center gap-2">
          <Logo />
          <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight">Aktobly</span>
        </span>
        <button
          type="button"
          onClick={() => setView("settings")}
          className="ml-1 max-w-[160px] truncate rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
          title="Change model in Settings"
        >
          {activeModel ?? "no Llama model"}
        </button>
        <span data-tauri-drag-region className="flex-1 self-stretch" />
        <IconButton onClick={() => setView("settings")} title="Settings (Ctrl+,)">
          <SettingsIcon size={15} />
        </IconButton>
        <IconButton onClick={() => api.hideWindow()} title={`Hide (Esc or ${keyHint})`}>
          <X size={16} />
        </IconButton>
      </header>

      {shortcut?.warning && (
        <div className="flex shrink-0 gap-1.5 bg-amber-50 px-3 py-1.5 text-[11.5px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{shortcut.warning}</span>
        </div>
      )}
      {status?.reachable && status.isRemote && (
        <div className="shrink-0 bg-amber-50 px-3 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Using a remote Ollama server — your text is sent to {status.baseUrl}
        </div>
      )}

      {/* Input */}
      <div className="relative shrink-0 px-3 pt-3">
        <textarea
          ref={inputRef}
          value={input}
          dir={inputDir}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Write anything, in any language..."
          rows={3}
          spellCheck={false}
          className="prose-text block max-h-[150px] min-h-[72px] w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 pb-6 outline-none placeholder:text-zinc-400 focus:border-accent/70 dark:border-zinc-700/80 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
        />
        <div className="pointer-events-none absolute bottom-1.5 left-5 right-5 flex items-center justify-between text-[10.5px] text-zinc-400">
          <span>{detected !== "none" ? `Detected: ${DETECTED_LABEL[detected]}` : ""}</span>
          {input && (
            <button type="button" onClick={clear} className="pointer-events-auto flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200" title="Clear (Ctrl+L)">
              <Eraser size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 space-y-2 px-3 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <Select options={OUTPUT_TYPES} value={sel.outputType} onChange={(e) => updateSel({ outputType: e.target.value })} title="Output type" />
          <Select options={LANGUAGES} value={sel.language} onChange={(e) => updateSel({ language: e.target.value })} title="Target language" />
        </div>
        <div className="flex gap-2">
          <Select className="flex-1" options={TONES} value={sel.tone} onChange={(e) => updateSel({ tone: e.target.value })} title="Tone" />
          <IconButton
            onClick={swap}
            className="h-8 border border-zinc-200 px-2 dark:border-zinc-700/80"
            title={hasOutput ? "Swap: use the result as input and flip the target language" : "Flip target language (Arabic ⇄ English)"}
          >
            <ArrowLeftRight size={14} />
          </IconButton>
          {generating ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-8 w-[118px] items-center justify-center gap-1.5 rounded-md bg-zinc-200 text-[12.5px] font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
              title="Stop (Esc)"
            >
              <Square size={11} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={!input.trim()}
              className="flex h-8 w-[118px] items-center justify-center gap-1.5 rounded-md bg-zinc-900 text-[12.5px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              title="Generate (Ctrl+Enter)"
            >
              <Sparkles size={13} /> Generate
            </button>
          )}
        </div>
      </div>

      {/* Output */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-3">
        <div className="relative flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/30">
          {error ? (
            <div className="flex flex-1 flex-col items-start gap-2 overflow-y-auto p-3 text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
              <span className="flex gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="select-text whitespace-pre-wrap">{error}</span>
              </span>
              <div className="flex gap-2">
                {last && (
                  <button type="button" onClick={regenerate} className="rounded-md border border-red-300 px-2 py-0.5 text-[12px] hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">
                    Retry
                  </button>
                )}
                <button type="button" onClick={() => refresh()} className="rounded-md border border-zinc-300 px-2 py-0.5 text-[12px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  Check connection
                </button>
              </div>
              {hasOutput && <p className="text-[11.5px] text-zinc-500">Your previous result is kept — dismiss with Retry or Generate.</p>}
            </div>
          ) : generating && !hasOutput ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-zinc-400">
              <Loader2 size={14} className="animate-spin" /> Writing with {activeModel}…
            </div>
          ) : hasOutput || generating ? (
            <textarea
              value={output}
              dir={outputDir}
              readOnly={generating}
              onChange={(e) => setOutput(e.target.value)}
              spellCheck={false}
              className="prose-text min-h-0 flex-1 resize-none bg-transparent p-3 outline-none"
              aria-label="Generated text (editable)"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-[11.5px] text-zinc-400">
              <span>
                <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> generate · <Kbd>Esc</Kbd> hide
              </span>
              <span>Result appears here — editable before copying.</span>
            </div>
          )}
        </div>

        {/* Output actions */}
        <div className="flex shrink-0 items-center gap-0.5 pt-1.5">
          <button
            type="button"
            onClick={copy}
            disabled={!hasOutput || generating}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${copied ? "bg-emerald-600 text-white" : "bg-accent text-white hover:bg-violet-700"}`}
            title="Copy (Ctrl+Shift+C)"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <IconButton onClick={regenerate} disabled={!last || generating} title="Regenerate (Ctrl+R)">
            <RotateCcw size={13} />
          </IconButton>
          <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <IconButton onClick={() => refine("shorten")} disabled={!hasOutput || generating} title="Make shorter (Alt+S)">
            <Scissors size={13} /> Shorter
          </IconButton>
          <IconButton onClick={() => refine("improve")} disabled={!hasOutput || generating} title="Improve wording (Alt+I)">
            <Wand2 size={13} /> Improve
          </IconButton>
          <IconButton onClick={() => refine("formal")} disabled={!hasOutput || generating} title="More formal (Alt+F)">
            <Briefcase size={13} />
          </IconButton>
          <IconButton onClick={() => refine("friendly")} disabled={!hasOutput || generating} title="More friendly (Alt+W)">
            <Smile size={13} />
          </IconButton>
          {notice && <span className="ml-auto text-[11px] text-zinc-400">{notice}</span>}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-zinc-100 px-3 text-[10.5px] text-zinc-500 dark:border-zinc-800">
        <span className="flex items-center gap-1.5" title={status?.error ?? status?.baseUrl}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : status ? "bg-red-500" : "bg-zinc-400"} ${refreshing ? "animate-pulse" : ""}`}
          />
          {connected ? "Ollama connected" : status ? "Ollama offline" : "Checking Ollama…"}
        </span>
        {connected && <span className="truncate">· {activeModel ?? "no Llama model"}</span>}
        <span className="ml-auto shrink-0">
          <Kbd>{keyHint}</Kbd> toggle
        </span>
      </footer>
    </div>
  );
}
