//! Ollama client. All requests go through Rust so the webview never needs CORS access,
//! and the CSP can forbid the frontend from talking to any network host directly.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::PathBuf, sync::Arc, sync::Mutex, time::Duration};
use tauri::ipc::Channel;
use tokio::sync::Notify;
use url::Url;

/// Generous: the first token waits for the model to load into memory (8B on CPU can take a while).
const FIRST_TOKEN_TIMEOUT: Duration = Duration::from_secs(240);
const NEXT_TOKEN_TIMEOUT: Duration = Duration::from_secs(90);
const KEEP_ALIVE: &str = "30m";

#[derive(Default)]
pub struct GenerationState {
    current: Mutex<Option<Arc<Notify>>>,
}

fn client(timeout: Option<Duration>) -> reqwest::Client {
    let mut b = reqwest::Client::builder().connect_timeout(Duration::from_secs(4));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.build().expect("failed to build HTTP client")
}

/// Validate and normalise a user-supplied Ollama endpoint.
pub fn normalize_base_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("The Ollama URL is empty. The default is http://127.0.0.1:11434".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme)
        .map_err(|_| format!("\"{trimmed}\" is not a valid URL. Example: http://127.0.0.1:11434"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("The Ollama URL must start with http:// or https://".into());
    }
    if url.host_str().map_or(true, str::is_empty) {
        return Err("The Ollama URL needs a host, e.g. http://127.0.0.1:11434".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials in the Ollama URL are not supported.".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}

pub fn is_local(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
        Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    }
}

fn endpoint(base: &Url, path: &str) -> String {
    format!("{}{}", base.as_str().trim_end_matches('/'), path)
}

/// Best-effort check for a local Ollama install without spawning processes.
fn ollama_installed() -> bool {
    let exe = if cfg!(windows) { "ollama.exe" } else { "ollama" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join(exe)).collect())
        .unwrap_or_default();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs").join("Ollama").join(exe));
    }
    candidates.iter().any(|p| p.is_file())
}

fn connect_error(base: &Url, e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return format!("Ollama at {base} did not respond in time. It may be busy or loading a model — try again.");
    }
    if is_local(base) {
        if ollama_installed() {
            format!("Ollama isn't running. Start the Ollama app from the Start menu (or run `ollama serve`), then click Retry.")
        } else {
            "Ollama doesn't appear to be installed. Install it from https://ollama.com/download, then run `ollama pull llama3.1:8b`.".into()
        }
    } else {
        format!("Can't reach the Ollama server at {base}. Check the address, that the server is running, and that it accepts network connections (OLLAMA_HOST=0.0.0.0).")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub reachable: bool,
    pub version: Option<String>,
    pub base_url: String,
    pub is_remote: bool,
    pub error: Option<String>,
}

pub async fn status(raw: &str) -> Result<Status, String> {
    let base = normalize_base_url(raw)?;
    let is_remote = !is_local(&base);
    #[derive(Deserialize)]
    struct V {
        version: String,
    }
    let res = client(Some(Duration::from_secs(5)))
        .get(endpoint(&base, "/api/version"))
        .send()
        .await;
    Ok(match res {
        Ok(r) if r.status().is_success() => Status {
            reachable: true,
            version: r.json::<V>().await.ok().map(|v| v.version),
            base_url: base.to_string(),
            is_remote,
            error: None,
        },
        Ok(r) => Status {
            reachable: false,
            version: None,
            base_url: base.to_string(),
            is_remote,
            error: Some(format!(
                "{base} answered with HTTP {} — is this really an Ollama server?",
                r.status()
            )),
        },
        Err(e) => Status {
            reachable: false,
            version: None,
            base_url: base.to_string(),
            is_remote,
            error: Some(connect_error(&base, &e)),
        },
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub size_bytes: u64,
    /// True for Meta Llama models (llama3.x etc). Only these are offered in the UI.
    pub is_llama: bool,
}

pub async fn list_models(raw: &str) -> Result<Vec<ModelInfo>, String> {
    let base = normalize_base_url(raw)?;
    #[derive(Deserialize)]
    struct Details {
        family: Option<String>,
        parameter_size: Option<String>,
    }
    #[derive(Deserialize)]
    struct M {
        name: String,
        #[serde(default)]
        size: u64,
        details: Option<Details>,
    }
    #[derive(Deserialize)]
    struct Tags {
        models: Vec<M>,
    }
    let res = client(Some(Duration::from_secs(8)))
        .get(endpoint(&base, "/api/tags"))
        .send()
        .await
        .map_err(|e| connect_error(&base, &e))?;
    if !res.status().is_success() {
        return Err(format!("Ollama returned HTTP {} while listing models.", res.status()));
    }
    let tags: Tags = res
        .json()
        .await
        .map_err(|e| format!("Unexpected response from Ollama /api/tags: {e}"))?;
    Ok(tags
        .models
        .into_iter()
        .map(|m| {
            // Judge by model name: some third-party fine-tunes report family "llama"
            // but are not Meta models, and we must not silently substitute those.
            let base_name = m.name.rsplit('/').next().unwrap_or(&m.name).to_ascii_lowercase();
            let is_llama = base_name.starts_with("llama");
            ModelInfo {
                is_llama,
                family: m.details.as_ref().and_then(|d| d.family.clone()),
                parameter_size: m.details.and_then(|d| d.parameter_size),
                size_bytes: m.size,
                name: m.name,
            }
        })
        .collect())
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Delta { content: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub text: String,
    pub stopped: bool,
    pub eval_count: Option<u64>,
    pub total_duration_ms: Option<u64>,
}

fn http_error(model: &str, status: reqwest::StatusCode, body: &str) -> String {
    let msg = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect());
    if status == reqwest::StatusCode::NOT_FOUND || msg.contains("not found") {
        format!("The model \"{model}\" isn't installed on this Ollama server. Run `ollama pull {model}` or choose another model in Settings.")
    } else if msg.contains("memory") {
        format!("Ollama couldn't load \"{model}\": {msg}. Try a smaller model such as llama3.2:3b.")
    } else {
        format!("Ollama error ({status}): {msg}")
    }
}

pub async fn generate(
    state: &GenerationState,
    req: GenerateRequest,
    on_event: Channel<StreamEvent>,
) -> Result<GenerateResult, String> {
    let base = normalize_base_url(&req.base_url)?;
    if req.model.trim().is_empty() {
        return Err("No Meta Llama model selected. Install one with `ollama pull llama3.1:8b`.".into());
    }

    // Only one generation at a time: starting a new one stops the previous.
    let stop = Arc::new(Notify::new());
    if let Some(prev) = state.current.lock().unwrap().replace(stop.clone()) {
        prev.notify_one();
    }

    let body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true,
        "keep_alive": KEEP_ALIVE,
        "options": {
            "temperature": req.temperature.unwrap_or(0.4),
            "top_p": 0.9,
            "num_ctx": 4096,
            "repeat_penalty": 1.1
        }
    });

    let result = async {
        let send = client(None).post(endpoint(&base, "/api/chat")).json(&body).send();
        let res = tokio::select! {
            r = tokio::time::timeout(FIRST_TOKEN_TIMEOUT, send) => match r {
                Ok(r) => r.map_err(|e| connect_error(&base, &e))?,
                Err(_) => return Err("Ollama took too long to start responding. The model may still be loading — try again.".to_string()),
            },
            _ = stop.notified() => return Ok(GenerateResult { text: String::new(), stopped: true, eval_count: None, total_duration_ms: None }),
        };
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(http_error(&req.model, status, &text));
        }

        let mut stream = res.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut text = String::new();
        let mut first = true;
        loop {
            let wait = if first { FIRST_TOKEN_TIMEOUT } else { NEXT_TOKEN_TIMEOUT };
            let chunk = tokio::select! {
                c = tokio::time::timeout(wait, stream.next()) => c,
                _ = stop.notified() => {
                    return Ok(GenerateResult { text, stopped: true, eval_count: None, total_duration_ms: None });
                }
            };
            let chunk = match chunk {
                Err(_) => return Err("Generation timed out waiting for Ollama. Try again or pick a smaller model.".into()),
                Ok(None) => break,
                Ok(Some(Err(e))) => return Err(format!("Connection to Ollama was interrupted: {e}")),
                Ok(Some(Ok(bytes))) => bytes,
            };
            first = false;
            buf.extend_from_slice(&chunk);

            // Ollama streams newline-delimited JSON; a chunk may hold several or partial lines.
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let v: serde_json::Value = serde_json::from_str(line)
                    .map_err(|e| format!("Unexpected streaming data from Ollama: {e}"))?;
                if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                    return Err(format!("Ollama error: {err}"));
                }
                if let Some(c) = v.pointer("/message/content").and_then(|c| c.as_str()) {
                    if !c.is_empty() {
                        text.push_str(c);
                        let _ = on_event.send(StreamEvent::Delta { content: c.to_string() });
                    }
                }
                if v.get("done").and_then(|d| d.as_bool()) == Some(true) {
                    return Ok(GenerateResult {
                        text,
                        stopped: false,
                        eval_count: v.get("eval_count").and_then(|x| x.as_u64()),
                        total_duration_ms: v
                            .get("total_duration")
                            .and_then(|x| x.as_u64())
                            .map(|ns| ns / 1_000_000),
                    });
                }
            }
        }
        Ok(GenerateResult { text, stopped: false, eval_count: None, total_duration_ms: None })
    }
    .await;

    // Clear our slot unless a newer generation has replaced it.
    let mut cur = state.current.lock().unwrap();
    if cur.as_ref().is_some_and(|c| Arc::ptr_eq(c, &stop)) {
        *cur = None;
    }
    result
}

pub fn stop(state: &GenerationState) {
    if let Some(n) = state.current.lock().unwrap().take() {
        n.notify_one();
    }
}

/// Ask Ollama to load the model into memory so the first real request is fast.
pub async fn preload(raw: &str, model: &str) -> Result<(), String> {
    let base = normalize_base_url(raw)?;
    let body = serde_json::json!({ "model": model, "messages": [], "keep_alive": KEEP_ALIVE });
    client(Some(Duration::from_secs(240)))
        .post(endpoint(&base, "/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| connect_error(&base, &e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls() {
        assert_eq!(normalize_base_url("127.0.0.1:11434").unwrap().as_str(), "http://127.0.0.1:11434/");
        assert_eq!(normalize_base_url(" http://localhost:11434/ ").unwrap().as_str(), "http://localhost:11434/");
        assert!(normalize_base_url("ftp://x").is_err());
        assert!(normalize_base_url("").is_err());
        assert!(normalize_base_url("http://u:p@host").is_err());
    }

    #[test]
    fn detects_local() {
        assert!(is_local(&normalize_base_url("http://127.0.0.1:11434").unwrap()));
        assert!(is_local(&normalize_base_url("http://localhost:11434").unwrap()));
        assert!(is_local(&normalize_base_url("http://[::1]:11434").unwrap()));
        assert!(!is_local(&normalize_base_url("http://192.168.1.20:11434").unwrap()));
    }
}
