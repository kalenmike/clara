use tauri::webview::NewWindowResponse;
use tauri::Url;
use std::path::PathBuf;

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
        return Some(base.join("clara").join("runtime.json"));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![hub_runtime])
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running Clara");
}
