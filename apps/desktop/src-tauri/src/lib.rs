use tauri::webview::NewWindowResponse;
use tauri::Url;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
