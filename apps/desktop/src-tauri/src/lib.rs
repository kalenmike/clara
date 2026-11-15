use std::{
    path::PathBuf,
    sync::{Mutex, atomic::{AtomicBool, Ordering}},
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Url,
    webview::NewWindowResponse,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const ADAPTER_HOST_READY: &str = "CLARA_ADAPTER_HOST ";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostRuntime {
    base_url: String,
    token: String,
}

struct AppState {
    child: Mutex<Option<CommandChild>>,
    runtime: Mutex<Option<HostRuntime>>,
    pending_link: Mutex<Option<String>>,
    quitting: AtomicBool,
}

#[derive(Deserialize)]
struct ReadyLine {
    port: u16,
}

/// The bundled client is served from a custom protocol on macOS and Linux, and
/// from `http://tauri.localhost` on Windows. The Vite dev server replaces both
/// while running `tauri dev`.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

fn is_dev_server(url: &Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
}

/// Links leave the app; internal navigations stay in the webview. Only web and
/// mail links are handed to the system, so a model cannot launch local files or
/// other app protocols from a message.
fn open_externally(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/**
 * Let the desktop web client discover a local hub whose port changed. The hub
 * writes this file; the webview never reads it directly.
 */
#[tauri::command]
fn hub_runtime() -> Option<serde_json::Value> {
    let path = runtime_file()?;
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    if value.get("state")?.as_str()? != "running" {
        return None;
    }
    Some(value)
}

/// The loopback adapter host the webview calls to run local/SSH/Docker installs.
#[tauri::command]
fn adapter_host_runtime(state: tauri::State<'_, AppState>) -> Option<HostRuntime> {
    state.runtime.lock().ok().and_then(|runtime| runtime.clone())
}

/// A `clara://adapter?code=…` link the shell received before the webview asked.
#[tauri::command]
fn adapter_take_link(state: tauri::State<'_, AppState>) -> Option<String> {
    state.pending_link.lock().ok().and_then(|mut link| link.take())
}

fn runtime_file() -> Option<PathBuf> {
    if let Some(configured) = env_path("CLARA_RUNTIME_FILE") {
        return Some(configured);
    }

    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir().map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("Clara")
                .join("runtime.json")
        });
    }

    #[cfg(target_os = "windows")]
    {
        let base = env_path("LOCALAPPDATA")
            .or_else(|| env_path("APPDATA"))
            .or_else(dirs::data_local_dir)?;
        return Some(base.join("Clara").join("runtime.json"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(runtime) = env_path("XDG_RUNTIME_DIR") {
            return Some(runtime.join("clara").join("runtime.json"));
        }
        let base = env_path("XDG_DATA_HOME").or_else(dirs::data_dir)?;
        return Some(base.join("Clara").join("runtime.json"));
    }

    #[allow(unreachable_code)]
    None
}

fn env_path(name: &str) -> Option<PathBuf> {
    let value = std::env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn random_token() -> String {
    (0..32)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect()
}

fn start_adapter_host(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let token = random_token();
    let command = app
        .shell()
        .sidecar("clara-adapter-host")?
        .args(["--token", &token]);
    let (mut rx, child) = command.spawn()?;
    *app.state::<AppState>().child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(ready) = line.trim().strip_prefix(ADAPTER_HOST_READY) {
                        if let Ok(value) = serde_json::from_str::<ReadyLine>(ready) {
                            if let Ok(mut runtime) = app_handle.state::<AppState>().runtime.lock() {
                                *runtime = Some(HostRuntime {
                                    base_url: format!("http://127.0.0.1:{}", value.port),
                                    token: token.clone(),
                                });
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("clara-adapter-host: {}", line.trim_end());
                }
                CommandEvent::Error(error) => {
                    eprintln!("clara-adapter-host: {error}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("clara-adapter-host exited ({:?})", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn stop_adapter_host(app: &AppHandle) {
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
    let child = app
        .state::<AppState>()
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.take());
    if let Some(mut child) = child {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            hub_runtime,
            adapter_host_runtime,
            adapter_take_link
        ])
        .setup(|app| {
            app.manage(AppState {
                child: Mutex::new(None),
                runtime: Mutex::new(None),
                pending_link: Mutex::new(None),
                quitting: AtomicBool::new(false),
            });

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Ok(mut link) = handle.state::<AppState>().pending_link.lock() {
                        *link = Some(url.to_string());
                    }
                    let _ = handle.emit("adapter-link", url.to_string());
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                let _ = app.deep_link().register_all();
            }

            if let Err(error) = start_adapter_host(app.handle().clone()) {
                eprintln!("could not start the adapter host: {error}");
            }

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Clara")
            .inner_size(1280.0, 860.0)
            .min_inner_size(960.0, 640.0)
            .center()
            .on_navigation(|url| {
                if is_app_url(url) || (tauri::is_dev() && is_dev_server(url)) {
                    return true;
                }
                open_externally(url);
                false
            })
            .on_new_window(|url, _features| {
                open_externally(&url);
                NewWindowResponse::Deny
            })
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Clara")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_adapter_host(app);
            }
        });
}
