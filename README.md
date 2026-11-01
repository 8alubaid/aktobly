# Aktobly

A local, keyboard-first AI writing assistant for Windows. Press **Ctrl + K** anywhere and a small panel opens in the top-right corner of your screen. Type a rough draft in any mix of English and Arabic (including Saudi slang), pick an output type, language and tone, and Meta Llama running in [Ollama](https://ollama.com) rewrites it into a polished message you can copy and paste.

- **Native desktop app**: Tauri 2 with a Rust backend and a React + TypeScript + Tailwind UI. No browser tab.
- **System-wide shortcut**: Ctrl + K toggles the popup from Chrome, Outlook, VS Code, WhatsApp and other apps. You can change it in Settings.
- **Real local inference**: streams from Meta Llama models through Ollama's `/api/chat`. Nothing is mocked, and no cloud service or paid API is involved.
- **Private**: your text goes only to your Ollama server. No accounts, analytics, telemetry or history, and no global keylogging.

---

## Quick start

### 1. Prerequisites (Windows 10/11)

| Requirement | Why | Install |
|---|---|---|
| Node.js 20+ | frontend tooling | https://nodejs.org |
| Rust (stable, MSVC) | Tauri backend | `winget install Rustlang.Rustup` |
| Visual Studio C++ Build Tools | Rust linker on Windows | `winget install Microsoft.VisualStudio.2022.BuildTools` and select **Desktop development with C++** |
| WebView2 runtime | UI rendering | Preinstalled on Windows 11 |
| Ollama | runs the Llama models | see below |

### 2. Install project dependencies

```bash
npm install
```

### 3. Install and configure Ollama

```bash
winget install Ollama.Ollama
```

Ollama runs in the background after you install it (look for its tray icon). If it isn't running, start it from the Start menu or run:

```bash
ollama serve
```

### 4. Pull a Meta Llama model

Recommended default (about 4.9 GB; good quality and speed):

```bash
ollama pull llama3.1:8b
```

Lighter option for low-RAM machines (about 2 GB):

```bash
ollama pull llama3.2:3b
```

Best quality, but needs a workstation with about 40 GB+ of RAM/VRAM. Aktobly never downloads this one automatically:

```bash
ollama pull llama3.3:70b
```

### 5. Run in development mode

```bash
npm run app:dev
```

The first run compiles the Rust backend, which takes a few minutes. Aktobly then starts **hidden in the system tray**. Press **Ctrl + K** to open it.

### 6. Build a Windows executable and installer

```bash
npm run app:build
```

Outputs:

- `src-tauri/target/release/aktobly.exe`: the standalone executable
- `src-tauri/target/release/bundle/nsis/Aktobly_0.1.0_x64-setup.exe`: an installer that installs per-user and needs no admin rights
- `src-tauri/target/release/bundle/msi/Aktobly_0.1.0_x64_en-US.msi`: an MSI installer

---

## Using Aktobly

1. In any app, press **Ctrl + K**. The popup appears top-right on the monitor holding your active window, with the cursor already in the input.
2. Type or paste your draft, e.g. `hey wanted to ask if you guys have any cloud engineer jobs available im a new grad thanks`.
3. Choose **Output type**, **Language** and **Tone**. Your last choices are remembered.
4. Press **Ctrl + Enter** (or click **Generate**). The text streams in from Llama.
5. Edit the result if you like, then click **Copy** (or press **Ctrl + Shift + C**).
6. Press **Ctrl + K** or **Esc** to hide Aktobly. Focus goes back to your app, where you paste.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl + K` | Show / focus / hide (global, configurable) |
| `Ctrl + Enter` | Generate |
| `Esc` | Stop generating, leave Settings, or hide |
| `Ctrl + Shift + C` | Copy result |
| `Ctrl + R` | Regenerate |
| `Alt + S` / `Alt + I` | Make shorter / Improve wording |
| `Alt + F` / `Alt + W` | More formal / More friendly |
| `Ctrl + L` | Clear |
| `Ctrl + ,` | Settings |

When the popup is visible but another app has focus, Ctrl + K brings the popup back into focus instead of hiding it.

### Output types

Professional Email (with subject), Casual Email, WhatsApp / Chat (no email formatting), Formal Letter, Plain Translation (meaning preserved, nothing added), Grammar Correction (minimal changes), Professional Rewrite, Short Summary.

### Languages and tones

- **Languages:** Arabic — Formal (MSA), Arabic — Saudi Professional, Arabic — Saudi Casual, English — Professional, English — Casual. The input language (Arabic / English / mixed) is detected automatically. Arabic is shown right-to-left in an Arabic-friendly font.
- **Tones:** Formal, Professional, Friendly, Casual, Polite, Direct, Concise.
- **Swap (⇄):** flips the target between Arabic and English. If there is already a result, it also moves the result into the input, so you can translate it back.

### System tray

Aktobly keeps running in the tray. Left-click the tray icon to open the popup. Right-click it for **Open Aktobly**, **Settings** and **Quit**. Closing the popup only hides it, and it never stops Ollama.

### Settings

You can change the Ollama endpoint URL, the model (Automatic or a specific installed Llama), connection status and **Refresh models**, the default output type, language and tone, the global shortcut (record one or pick a preset), the theme (System / Light / Dark), **Launch at Windows startup**, and **Hide when switching apps**.

Settings are saved in `%APPDATA%\com.aktobly.app\settings.json`.

---

## How it works

```
 Ctrl+K (Win32 RegisterHotKey via tauri-plugin-global-shortcut)
   │
   ▼
 Rust backend (src-tauri/src)
   lib.rs       shortcut, toggle/debounce, tray, autostart, commands
   window.rs    top-right placement on the active monitor (DPI-aware)
   ollama.rs    /api/version, /api/tags, streaming /api/chat, stop, timeouts
   settings.rs  JSON settings persistence
   │  Tauri IPC + streaming Channel
   ▼
 React UI (src)
   App.tsx                 popup UI, keyboard handling, generation state
   components/SettingsView settings screen
   lib/prompts.ts          system prompt, few-shot examples, refinement, cleanup
   lib/options.ts          output types / languages / tones and their guidance
   lib/glossary.ts         Arabic renderings of common tech/business terms
   lib/detect.ts           Arabic/English detection and text direction
   lib/models.ts           model selection (prefers ~8B Llama)
```

- **Model selection.** Only models whose name starts with `llama` are offered, and other installed models are hidden rather than silently substituted. In Automatic mode, an installed ~8B Llama is preferred, then the largest smaller one. 70B is used only if you pick it.
- **Prompting.** A fixed set of rules (preserve intent, never invent facts, names or qualifications, no placeholders, output only the final text), plus guidance for the chosen output type, language and tone, plus three short few-shot examples. Together these teach the model to *rewrite* the draft as the sender instead of replying to it. When the target is Arabic, a small glossary gives the accepted Arabic terms for any tech or business words found in the draft.
- **Networking.** All Ollama traffic goes through Rust (`reqwest`). The webview's CSP blocks any direct network access from the UI.
- **Security.** The Tauri capability file grants only event listening, window dragging and clipboard write.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama isn't running" | Start Ollama from the Start menu, or run `ollama serve`. Then click **Retry**. |
| "Ollama doesn't appear to be installed" | `winget install Ollama.Ollama` |
| "No Meta Llama model is installed" | `ollama pull llama3.1:8b`, then click **Refresh models** in Settings |
| "Model … isn't installed" | Pull it, or choose another model in Settings |
| First generation is slow | The model is loading into memory. Aktobly preloads it when it starts and keeps it warm for 30 minutes. |
| Ctrl + K doesn't open Aktobly | Another program has already registered it, and Aktobly shows a warning and falls back to Ctrl + Alt + K. Pick another shortcut in Settings. |
| Ctrl + K no longer works inside Chrome/VS Code | That's expected: a global hotkey takes the key combination system-wide. Choose another shortcut if you need Ctrl + K in those apps. |
| Doesn't open over admin windows | Windows prevents normal apps from taking over elevated windows. Run Aktobly elevated if you need this. |
| Using a remote Ollama | Set the URL in Settings (e.g. `http://192.168.1.20:11434`). On the server, set `OLLAMA_HOST=0.0.0.0`. Aktobly warns you that your text leaves this PC. |

### Quality notes

`llama3.1:8b` handles English very well and Arabic well. Its Arabic can occasionally sound slightly unnatural. If that happens, use **Regenerate** or **Improve**, or switch to a larger Llama model if your hardware allows it.

---

## Download website

`website/` holds the public download page. It is plain static HTML/CSS/JS and makes no third-party requests: no fonts, analytics or cookies.

| File | Purpose |
|---|---|
| `index.html` | Landing and download page: hero demo, examples, features, setup steps, FAQ, changelog |
| `privacy.html`, `license.html` | Privacy policy, MIT license and terms |
| `release.js` | **Generated.** Version, file names, sizes and SHA-256 of the installers |
| `downloads/` | **Generated.** The installers served by the site |

### Publishing a release

```bash
npm run app:build
```
```bash
npm run site:prepare
```
```bash
npm run site:serve
```

`site:prepare` copies the new installers into `website/downloads/` and rewrites `release.js`. `site:serve` previews the site at http://localhost:4321.

Once you have a public source repository, set `repoUrl` in `website/release.js`. That turns on the **Source** and **Report an issue** links, and the value is kept when you run `site:prepare` again.

### Hosting (all free)

- **Netlify:** drag the `website` folder onto https://app.netlify.com/drop.
- **Cloudflare Pages:** create a project, pick *Direct upload*, and upload `website/`.
- **GitHub Pages (how the official site is published):** the workflow in `.github/workflows/pages.yml` deploys `website/` whenever it changes on `main`. In the repo, *Settings → Pages → Source* must be set to **GitHub Actions**. Each installer is about 2 MB, far under GitHub's 100 MB per-file limit.

If you'd rather host the installers on GitHub Releases, upload the two files there and change each `url` in `release.js` to the release-asset URL.

Windows SmartScreen warns about unsigned installers from new publishers, and the FAQ on the site explains this to users. To remove the warning, sign the installers with a code-signing certificate. Tauri supports this through `bundle.windows.certificateThumbprint` or `signCommand`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run app:dev` | Run the desktop app with hot reload |
| `npm run app:build` | Build the release exe plus NSIS and MSI installers |
| `npm run typecheck` | TypeScript check |
| `npm run icons` | Regenerate app icons from `app-icon.svg` |
| `cd src-tauri && cargo test` | Rust unit tests (URL validation, local-host detection) |
| `npm run site:prepare` | Copy installers into the website and refresh `release.js` |
| `npm run site:serve` | Preview the download website at http://localhost:4321 |

## License

[MIT](LICENSE). Free for personal and commercial use.
