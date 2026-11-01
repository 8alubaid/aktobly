mod ollama;
mod settings;
mod window;

use serde::Serialize;
use settings::{Settings, SettingsState, DEFAULT_SHORTCUT, FALLBACK_SHORTCUT};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState as KeyState};

const MAIN: &str = "main";
const TRAY_ID: &str = "aktobly-tray";
/// Ignore repeat toggles faster than this (key bounce / rapid Ctrl+K mashing).
const TOGGLE_DEBOUNCE: Duration = Duration::from_millis(180);

#[derive(Default)]
struct ShortcutState {
    active: Mutex<Option<(Shortcut, String)>>,
    warning: Mutex<Option<String>>,
}

#[derive(Default)]
struct ToggleState {
    last: Mutex<Option<Instant>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutInfo {
    active: Option<String>,
    preferred: String,
    warning: Option<String>,
}

// ---------------------------------------------------------------- popup show/hide

fn show_popup(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    window::position_top_right(&win);
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
    let _ = app.emit_to(MAIN, "aktobly://shown", ());
}

fn hide_popup(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.hide();
    }
}

fn toggle_popup(app: &AppHandle) {
    {
        let state = app.state::<ToggleState>();
        let mut last = state.last.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < TOGGLE_DEBOUNCE) {
            return;
        }
        *last = Some(Instant::now());
    }
    let Some(win) = app.get_webview_window(MAIN) else { return };
    let visible = win.is_visible().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);
    if visible && focused {
        hide_popup(app);
    } else if visible {
        // Visible behind another app's focus: bring it forward instead of hiding it.
        let _ = win.set_focus();
        let _ = app.emit_to(MAIN, "aktobly://shown", ());
    } else {
        show_popup(app);
    }
}

// ---------------------------------------------------------------- global shortcut

fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    s.parse::<Shortcut>()
        .map_err(|_| format!("\"{s}\" isn't a valid shortcut. Use something like Ctrl+K or Ctrl+Alt+K."))
}

/// Replace the active global shortcut. On failure the previous one stays registered.
fn register_shortcut(app: &AppHandle, accel: &str) -> Result<(), String> {
    let new = parse_shortcut(accel)?;
    let gs = app.global_shortcut();
    let state = app.state::<ShortcutState>();
    let mut active = state.active.lock().unwrap();

    if let Some((old, _)) = active.as_ref() {
        if *old == new {
            *active = Some((new, accel.to_string()));
            return Ok(());
        }
        let _ = gs.unregister(*old);
    }
    match gs.register(new) {
        Ok(()) => {
            *active = Some((new, accel.to_string()));
            drop(active);
            update_tray_tooltip(app);
            Ok(())
        }
        Err(e) => {
            if let Some((old, _)) = active.as_ref() {
                let _ = gs.register(*old);
            }
            Err(format!(
                "Couldn't register {accel} — another app is probably using it ({e}). Choose a different shortcut in Settings."
            ))
        }
    }
}

fn register_initial_shortcut(app: &AppHandle, preferred: &str) {
    let state = app.state::<ShortcutState>();
    let warning = match register_shortcut(app, preferred) {
        Ok(()) => None,
        Err(err) => {
            let fallback = if preferred.eq_ignore_ascii_case(FALLBACK_SHORTCUT) {
                DEFAULT_SHORTCUT
            } else {
                FALLBACK_SHORTCUT
            };
            match register_shortcut(app, fallback) {
                Ok(()) => Some(format!("{err} Using {fallback} for now.")),
                Err(_) => Some(format!("{err} The fallback {fallback} is also unavailable — open Aktobly from the tray icon and pick another shortcut.")),
            }
        }
    };
    *state.warning.lock().unwrap() = warning;
}

fn shortcut_info(app: &AppHandle) -> ShortcutInfo {
    let state = app.state::<ShortcutState>();
    let preferred = app.state::<SettingsState>().0.lock().unwrap().shortcut.clone();
    let active = state.active.lock().unwrap().as_ref().map(|(_, s)| s.clone());
    let warning = state.warning.lock().unwrap().clone();
    ShortcutInfo { active, preferred, warning }
}

// ---------------------------------------------------------------- tray

fn update_tray_tooltip(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let label = app
            .state::<ShortcutState>()
            .active
            .lock()
            .unwrap()
            .as_ref()
            .map(|(_, s)| format!("Aktobly — press {s}"))
            .unwrap_or_else(|| "Aktobly".into());
        let _ = tray.set_tooltip(Some(label));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Aktobly", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Aktobly", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Aktobly")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_popup(app),
            "settings" => {
                show_popup(app);
                let _ = app.emit_to(MAIN, "aktobly://open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_popup(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_settings(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<SettingsState>, mut settings: Settings) -> Result<Settings, String> {
    settings.ollama_url = ollama::normalize_base_url(&settings.ollama_url)?
        .as_str()
        .trim_end_matches('/')
        .to_string();
    let mut current = state.0.lock().unwrap();
    // Shortcut and autostart have dedicated commands because they touch the OS.
    settings.shortcut = current.shortcut.clone();
    settings.launch_at_startup = current.launch_at_startup;
    settings::save(&app, &settings)?;
    *current = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn get_shortcut_info(app: AppHandle) -> ShortcutInfo {
    shortcut_info(&app)
}

#[tauri::command]
fn set_shortcut(app: AppHandle, shortcut: String) -> Result<ShortcutInfo, String> {
    let shortcut = shortcut.trim().to_string();
    register_shortcut(&app, &shortcut)?;
    *app.state::<ShortcutState>().warning.lock().unwrap() = None;
    {
        let state = app.state::<SettingsState>();
        let mut s = state.0.lock().unwrap();
        s.shortcut = shortcut;
        settings::save(&app, &s)?;
    }
    Ok(shortcut_info(&app))
}

#[tauri::command]
fn set_launch_at_startup(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    let res = if enabled { al.enable() } else { al.disable() };
    res.map_err(|e| format!("Couldn't change the Windows startup setting: {e}"))?;
    let actual = al.is_enabled().unwrap_or(enabled);
    let state = app.state::<SettingsState>();
    let mut s = state.0.lock().unwrap();
    s.launch_at_startup = actual;
    settings::save(&app, &s)?;
    Ok(actual)
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    hide_popup(&app);
}

#[tauri::command]
async fn ollama_status(base_url: String) -> Result<ollama::Status, String> {
    ollama::status(&base_url).await
}

#[tauri::command]
async fn ollama_models(base_url: String) -> Result<Vec<ollama::ModelInfo>, String> {
    ollama::list_models(&base_url).await
}

#[tauri::command]
async fn ollama_generate(
    state: State<'_, ollama::GenerationState>,
    request: ollama::GenerateRequest,
    on_event: Channel<ollama::StreamEvent>,
) -> Result<ollama::GenerateResult, String> {
    ollama::generate(&state, request, on_event).await
}

#[tauri::command]
fn ollama_stop(state: State<ollama::GenerationState>) {
    ollama::stop(&state);
}

#[tauri::command]
async fn ollama_preload(base_url: String, model: String) -> Result<(), String> {
    ollama::preload(&base_url, &model).await
}

// ---------------------------------------------------------------- app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just opens the existing popup.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_popup(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == KeyState::Pressed {
                        toggle_popup(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(ShortcutState::default())
        .manage(ToggleState::default())
        .manage(ollama::GenerationState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let mut loaded = settings::load(&handle);
            // Trust the OS for the real autostart state (the user may have changed it in Task Manager).
            if let Ok(enabled) = handle.autolaunch().is_enabled() {
                loaded.launch_at_startup = enabled;
            }
            let preferred = loaded.shortcut.clone();
            app.manage(SettingsState(Mutex::new(loaded)));

            build_tray(&handle)?;
            register_initial_shortcut(&handle, &preferred);
            update_tray_tooltip(&handle);
            // Start hidden in the tray; the popup appears on the shortcut.
            Ok(())
        })
        .on_window_event(|win, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Closing only hides; the app keeps running in the tray.
                api.prevent_close();
                let _ = win.hide();
            }
            WindowEvent::Focused(false) => {
                let hide = win.state::<SettingsState>().0.lock().unwrap().hide_on_blur;
                if hide {
                    let _ = win.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_shortcut_info,
            set_shortcut,
            set_launch_at_startup,
            hide_window,
            ollama_status,
            ollama_models,
            ollama_generate,
            ollama_stop,
            ollama_preload
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aktobly");
}
