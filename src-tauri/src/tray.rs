//! Tray icon, close/minimize to tray, and start with the operating system.
//!
//! The behaviour flags live in atomics, because window events arrive on the event loop and must
//! not wait for the async config lock. Menu texts come from the frontend, which owns the wording.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};
#[cfg(test)]
use ts_rs::TS;

const TRAY_ID: &str = "main";
/// Argument the autostart entry passes, so a start with the system can stay in the tray.
pub const HIDDEN_ARG: &str = "--hidden";

#[derive(Default)]
pub struct TrayState {
    pub available: AtomicBool,
    pub close_to_tray: AtomicBool,
    pub minimize_to_tray: AtomicBool,
    /// Set by "Quit": from then on closing really closes.
    pub quitting: AtomicBool,
    /// The first hide tells the user once that the app keeps running.
    pub hidden_once: AtomicBool,
    pub started_hidden: AtomicBool,
}

impl TrayState {
    pub fn apply(&self, close: bool, minimize: bool) {
        self.close_to_tray.store(close, Ordering::Relaxed);
        self.minimize_to_tray.store(minimize, Ordering::Relaxed);
    }

    fn hides_on_close(&self) -> bool {
        self.available.load(Ordering::Relaxed) && self.close_to_tray.load(Ordering::Relaxed) && !self.quitting.load(Ordering::Relaxed)
    }

    fn hides_on_minimize(&self) -> bool {
        self.available.load(Ordering::Relaxed) && self.minimize_to_tray.load(Ordering::Relaxed)
    }
}

/// Texts and state of the tray menu, sent by the frontend in the current language.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct TrayStatus {
    pub tooltip: String,
    pub open: String,
    pub refresh: String,
    pub notify: String,
    pub notify_on: bool,
    pub quit: String,
}

/// What the settings can offer on this system.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct WindowCapabilities {
    pub tray: bool,
    pub autostart: bool,
    pub started_hidden: bool,
    /// For display only: paths below it show as `~`.
    pub home: Option<String>,
}

/// Start with the system: the saved wish wins when saving, the system wins at start (the user may
/// have removed the entry in the OS settings). Returns the flag to keep and whether to change the system.
pub fn reconcile_autostart(wanted: bool, system: bool, at_start: bool) -> (bool, Option<bool>) {
    if wanted == system {
        (wanted, None)
    } else if at_start {
        (system, None)
    } else {
        (wanted, Some(wanted))
    }
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn menu<R: Runtime>(app: &AppHandle<R>, s: &TrayStatus) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", &s.open, true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", &s.refresh, true, None::<&str>)?;
    let notify = CheckMenuItem::with_id(app, "notify", &s.notify, true, s.notify_on, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", &s.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &refresh, &notify, &sep, &quit])
}

/// Builds the tray icon; on a desktop without a tray host this fails and the window keeps its
/// normal close behaviour.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Option<TrayIcon<R>> {
    let initial = TrayStatus {
        tooltip: "McBranchFace".into(),
        open: "Open".into(),
        refresh: "Refresh".into(),
        notify: "Notifications".into(),
        notify_on: true,
        quit: "Quit".into(),
    };
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip(&initial.tooltip).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    if let Ok(m) = menu(app, &initial) {
        builder = builder.menu(&m);
    }
    let tray = builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "refresh" => {
                let _ = app.emit("tray-refresh", ());
            }
            "notify" => {
                let _ = app.emit("tray-toggle-notify", ());
            }
            "quit" => {
                if let Some(s) = app.try_state::<TrayState>() {
                    s.quitting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)
        .ok()?;
    if let Some(s) = app.try_state::<TrayState>() {
        s.available.store(true, Ordering::Relaxed);
    }
    Some(tray)
}

pub fn update<R: Runtime>(app: &AppHandle<R>, status: &TrayStatus) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return Ok(()) };
    tray.set_tooltip(Some(&status.tooltip))?;
    tray.set_menu(Some(menu(app, status)?))?;
    Ok(())
}

/// Close and minimize hide the window instead, when the settings say so and a tray exists.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    let Some(state) = window.app_handle().try_state::<TrayState>() else { return };
    let hide = match event {
        WindowEvent::CloseRequested { api, .. } if state.hides_on_close() => {
            api.prevent_close();
            true
        }
        WindowEvent::Resized(_) if state.hides_on_minimize() && window.is_minimized().unwrap_or(false) => true,
        _ => false,
    };
    if hide {
        let _ = window.hide();
        if !state.hidden_once.swap(true, Ordering::Relaxed) {
            let _ = window.app_handle().emit("hidden-to-tray", ());
        }
    }
}

pub fn keep_hidden<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.app_handle().try_state::<TrayState>().is_some_and(|s| s.started_hidden.load(Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_follows_the_system_at_start_and_the_wish_when_saving() {
        assert_eq!(reconcile_autostart(true, true, true), (true, None));
        assert_eq!(reconcile_autostart(true, false, true), (false, None), "removed in the OS settings");
        assert_eq!(reconcile_autostart(false, true, true), (true, None));
        assert_eq!(reconcile_autostart(true, false, false), (true, Some(true)));
        assert_eq!(reconcile_autostart(false, true, false), (false, Some(false)));
        assert_eq!(reconcile_autostart(false, false, false), (false, None));
    }

    #[test]
    fn hiding_needs_a_tray_and_stops_once_quitting() {
        let s = TrayState::default();
        s.apply(true, true);
        assert!(!s.hides_on_close() && !s.hides_on_minimize(), "no tray, no hiding");
        s.available.store(true, Ordering::Relaxed);
        assert!(s.hides_on_close() && s.hides_on_minimize());
        s.quitting.store(true, Ordering::Relaxed);
        assert!(!s.hides_on_close());
        s.apply(false, false);
        assert!(!s.hides_on_minimize());
    }
}
