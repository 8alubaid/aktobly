//! Settings persisted as JSON in the app config directory. Nothing leaves the machine.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+K";
pub const FALLBACK_SHORTCUT: &str = "Ctrl+Alt+K";
pub const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ollama_url: String,
    /// Explicitly chosen model. `None` means "pick the best installed Llama".
    pub model: Option<String>,
    pub default_output_type: String,
    pub default_language: String,
    pub default_tone: String,
    pub last_output_type: Option<String>,
    pub last_language: Option<String>,
    pub last_tone: Option<String>,
    pub shortcut: String,
    pub theme: String,
    pub launch_at_startup: bool,
    pub hide_on_blur: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ollama_url: DEFAULT_OLLAMA_URL.into(),
            model: None,
            default_output_type: "professional_email".into(),
            default_language: "en_professional".into(),
            default_tone: "professional".into(),
            last_output_type: None,
            last_language: None,
            last_tone: None,
            shortcut: DEFAULT_SHORTCUT.into(),
            theme: "system".into(),
            launch_at_startup: false,
            hide_on_blur: false,
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("Could not locate the settings folder.")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Could not create settings folder: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Write to a temp file first so a crash never leaves a half-written settings file.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Could not save settings: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not save settings: {e}"))
}
