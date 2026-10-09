use crate::models::app_type::AppType;
use crate::services::provider_service;
use crate::store::AppState;
use tauri::{
    image::Image,
    menu::{CheckMenuItemBuilder, MenuBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

const TRAY_ID: &str = "main-tray";
/// 托盘切换菜单项 id：`switch::<app>::<provider_id>`
const SWITCH_PREFIX: &str = "switch::";
/// 供应商变化后通知前端刷新列表
pub const PROVIDERS_CHANGED_EVENT: &str = "providers-changed";

/// 托盘里展示的应用（与 cc-switch 的托盘切换范围一致）
const TRAY_APPS: &[AppType] = &[
    AppType::Claude,
    AppType::ClaudeDesktop,
    AppType::Codex,
    AppType::Gemini,
];

/// AppType 显示名称
fn display_name(app_type: &AppType) -> &'static str {
    match app_type {
        AppType::Claude => "Claude",
        AppType::Codex => "Codex",
        AppType::Gemini => "Gemini",
        AppType::OpenCode => "OpenCode",
        AppType::OpenClaw => "OpenClaw",
        AppType::ClaudeDesktop => "Claude Desktop",
    }
}

/// 显示并聚焦主窗口
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

/// 初始化系统托盘
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app.handle())?;

    // 加载托盘图标（使用 app icon）
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("CCG Switch")
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            match id {
                "show" => {
                    show_main_window(app_handle);
                }
                "quit" => {
                    app_handle.exit(0);
                }
                other => {
                    if let Some(rest) = other.strip_prefix(SWITCH_PREFIX) {
                        switch_from_tray(app_handle, rest);
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 托盘里点击切换供应商：与界面走同一个 `switch_provider_in_db`
fn switch_from_tray(app_handle: &tauri::AppHandle, rest: &str) {
    let Some((app, provider_id)) = rest.split_once("::") else {
        return;
    };
    let Ok(app_type) = app.parse::<AppType>() else {
        return;
    };
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    match provider_service::switch_provider_in_db(&state.db, app_type, provider_id) {
        Ok(()) => {
            let _ = app_handle.emit(PROVIDERS_CHANGED_EVENT, app);
        }
        Err(e) => tracing::warn!("[Tray] 切换供应商失败: {e}"),
    }
    refresh(app_handle);
}

/// 构建托盘菜单：每个应用一个子菜单，列出全部供应商，当前项打勾
fn build_tray_menu(
    handle: &tauri::AppHandle,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let mut builder = MenuBuilder::new(handle);

    // 标题
    builder = builder.text("title", "CCG Switch");
    builder = builder.separator();

    // 只列「切换」型应用（OpenCode 是多供应商共存，没有单一当前项）
    let providers = handle
        .try_state::<AppState>()
        .and_then(|state| state.db.list_providers().ok())
        .unwrap_or_default();
    for app_type in TRAY_APPS {
        let list: Vec<_> = providers.iter().filter(|p| p.app_type == *app_type).collect();
        let active = list.iter().find(|p| p.is_active).map(|p| p.name.as_str());
        let title = format!("{}: {}", display_name(app_type), active.unwrap_or("(none)"));

        let mut sub = SubmenuBuilder::new(handle, title);
        if list.is_empty() {
            sub = sub.item(
                &tauri::menu::MenuItemBuilder::with_id(format!("empty_{}", app_type.as_str()), "(无供应商)")
                    .enabled(false)
                    .build(handle)?,
            );
        }
        for p in list {
            let item = CheckMenuItemBuilder::with_id(
                format!("{SWITCH_PREFIX}{}::{}", app_type.as_str(), p.id),
                &p.name,
            )
            .checked(p.is_active)
            .build(handle)?;
            sub = sub.item(&item);
        }
        builder = builder.item(&sub.build()?);
    }

    builder = builder.separator();

    // 显示窗口
    builder = builder.text("show", "显示窗口");

    // 退出
    builder = builder.text("quit", "退出");

    let menu = builder.build()?;
    Ok(menu)
}

/// 供应商增删改 / 切换后刷新托盘（失败只记日志，不影响调用方）
pub fn refresh(app_handle: &tauri::AppHandle) {
    if let Err(e) = rebuild_tray_menu(app_handle) {
        tracing::warn!("[Tray] 刷新菜单失败: {e}");
    }
}

/// 重新构建托盘菜单
pub fn rebuild_tray_menu(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app_handle)?;
    if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}
