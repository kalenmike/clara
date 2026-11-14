use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Clone, Deserialize)]
struct RuntimeEndpoint {
    url: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    state: String,
    #[serde(default)]
    panel: Option<RuntimeEndpoint>,
    #[serde(default)]
    #[allow(dead_code)]
    local: Option<RuntimeEndpoint>,
}

struct AppState {
    child: Mutex<Option<CommandChild>>,
    runtime: Mutex<Option<RuntimeState>>,
    quitting: AtomicBool,
    config_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_panel_from_state(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let config_dir =
                clara_config_dir().ok_or("Could not resolve the Clara config directory")?;
            let data_dir = clara_data_dir().ok_or("Could not resolve the Clara data directory")?;
            let cache_dir = app.path().app_cache_dir()?;
            let log_dir = app.path().app_log_dir()?;
            fs::create_dir_all(&config_dir)?;
            fs::create_dir_all(&data_dir)?;
            fs::create_dir_all(&cache_dir)?;
            fs::create_dir_all(&log_dir)?;

            app.manage(AppState {
                child: Mutex::new(None),
                runtime: Mutex::new(read_runtime_state()),
                quitting: AtomicBool::new(false),
                config_dir: config_dir.clone(),
            });

            build_tray(app.handle())?;
            start_sidecar(
                app.handle().clone(),
                config_dir,
                data_dir,
                cache_dir,
                log_dir,
            )?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Clara Hub")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_sidecar(app);
            }
        });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open panel", true, None::<&str>)?;
    let token = MenuItem::with_id(app, "token", "Copy setup token", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &token, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_panel_from_state(app),
            "token" => copy_setup_token(app),
            "quit" => quit(app),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    } else if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/32x32.png")) {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn start_sidecar(
    app: AppHandle,
    config_dir: PathBuf,
    data_dir: PathBuf,
    cache_dir: PathBuf,
    log_dir: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let command = app
        .shell()
        .sidecar("clara-server")?
        .env("CLARA_CONFIG_DIR", &config_dir)
        .env("CLARA_DATA_DIR", &data_dir)
        .env("CLARA_CACHE_DIR", &cache_dir)
        .env("CLARA_PANEL_BIND_HOST", "127.0.0.1")
        .env("CLARA_LOCAL_BIND_HOST", "127.0.0.1")
        .env("CLARA_CONTROL_STDIN", "1");

    let (mut rx, child) = command.spawn()?;
    *app.state::<AppState>().child.lock().unwrap() = Some(child);

    let log_path = log_dir.join("hub.log");
    let log_line = log_path.clone();
    let log_error = log_path.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => append_log(&log_line, &bytes),
                CommandEvent::Stderr(bytes) => append_log(&log_error, &bytes),
                CommandEvent::Error(error) => {
                    append_log(&log_error, format!("{error}\n").as_bytes());
                }
                CommandEvent::Terminated(payload) => {
                    append_log(
                        &log_error,
                        format!("hub sidecar exited ({:?})\n", payload.code).as_bytes(),
                    );
                    let state = app_handle.state::<AppState>();
                    if !state.quitting.load(Ordering::SeqCst) {
                        app_handle
                            .dialog()
                            .message(
                                "The Clara hub service stopped unexpectedly. Check the hub log in the app log directory.",
                            )
                            .title("Clara Hub")
                            .kind(MessageDialogKind::Error)
                            .show(|_| {});
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    watch_runtime(app);
    Ok(())
}

fn watch_runtime(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..120 {
            if let Some(state) = read_runtime_state() {
                if state.state == "running" {
                    if let Some(panel) = &state.panel {
                        if let Ok(mut current) = app.state::<AppState>().runtime.lock() {
                            *current = Some(state.clone());
                        }
                        open_panel(&app, &panel.url);
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        app.dialog()
            .message(
                "The Clara hub service did not start. Check the hub log in the app log directory.",
            )
            .title("Clara Hub")
            .kind(MessageDialogKind::Error)
            .show(|_| {});
    });
}

fn open_panel_from_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    let runtime = state
        .runtime
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .or_else(read_runtime_state);
    if let Some(panel) = runtime.and_then(|value| value.panel) {
        if open_panel(app, &panel.url) {
            return;
        }
    }
    app.dialog()
        .message("The Clara hub is not ready yet.")
        .title("Clara Hub")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}

fn open_panel(app: &AppHandle, url: &str) -> bool {
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.show();
        let _ = window.set_focus();
        return true;
    }

    let Ok(url) = url.parse::<Url>() else {
        return false;
    };
    let builder = WebviewWindowBuilder::new(app, "panel", WebviewUrl::External(url))
        .title("Clara Hub")
        .inner_size(1200.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .on_navigation(|url| {
            if is_panel_url(url) {
                true
            } else {
                open_externally(url);
                false
            }
        })
        .on_new_window(|url, _features| {
            open_externally(&url);
            tauri::webview::NewWindowResponse::Deny
        });

    let Ok(window) = builder.build() else {
        return false;
    };
    let handle = app.clone();
    let window_handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if !handle.state::<AppState>().quitting.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = window_handle.hide();
            }
        }
    });
    let _ = window.show();
    let _ = window.set_focus();
    true
}

fn is_panel_url(url: &Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
}

fn open_externally(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

fn copy_setup_token(app: &AppHandle) {
    let path = app.state::<AppState>().config_dir.join("admin-setup.txt");
    match fs::read_to_string(&path) {
        Ok(value) if !value.trim().is_empty() => {
            if let Err(error) = app.clipboard().write_text(value.trim().to_string()) {
                app.dialog()
                    .message(format!("Could not copy the setup token: {error}"))
                    .title("Clara Hub")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }
        }
        _ => {
            app.dialog()
                .message("No setup token is available. The panel may already be set up.")
                .title("Clara Hub")
                .kind(MessageDialogKind::Info)
                .show(|_| {});
        }
    }
}

fn quit(app: &AppHandle) {
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
    stop_sidecar(app);
    app.exit(0);
}

fn stop_sidecar(app: &AppHandle) {
    let child = app
        .state::<AppState>()
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.take());
    if let Some(mut child) = child {
        let _ = child.write(b"shutdown\n");
        std::thread::sleep(Duration::from_millis(700));
        let _ = child.kill();
    }
}

fn append_log(path: &Path, bytes: &[u8]) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(bytes);
    }
}

fn read_runtime_state() -> Option<RuntimeState> {
    let path = runtime_file()?;
    let text = fs::read_to_string(path).ok()?;
    let value: RuntimeState = serde_json::from_str(&text).ok()?;
    if value.state != "running" {
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

fn clara_config_dir() -> Option<PathBuf> {
    let base = env_path("XDG_CONFIG_HOME")
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))?;
    Some(base.join("clara"))
}

fn clara_data_dir() -> Option<PathBuf> {
    let base = env_path("XDG_DATA_HOME")
        .or_else(|| dirs::home_dir().map(|home| home.join(".local").join("share")))?;
    Some(base.join("clara"))
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
