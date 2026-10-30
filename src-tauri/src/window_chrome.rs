//! Presses on the window's own frame (title bar, borders, its buttons). The webview never sees them and
//! the window keeps its focus, so an open menu would stay open; the frontend is told instead.

pub const EVENT: &str = "window-chrome-pressed";

#[cfg(windows)]
pub fn watch(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    use windows_sys::Win32::UI::Shell::SetWindowSubclass;
    let Ok(hwnd) = window.hwnd() else { return };
    let raw = hwnd.0 as usize;
    let app = window.app_handle().clone();
    // A subclass belongs to the thread that owns the window.
    let _ = window.run_on_main_thread(move || {
        let data = Box::into_raw(Box::new(app)) as usize;
        // SAFETY: the window lives as long as the app; the leaked handle is the subclass's data for that long.
        unsafe { SetWindowSubclass(raw as _, Some(on_message), 1, data) };
    });
}

#[cfg(windows)]
unsafe extern "system" fn on_message(
    hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
    _id: usize,
    data: usize,
) -> windows_sys::Win32::Foundation::LRESULT {
    use tauri::Emitter;
    use windows_sys::Win32::UI::Shell::DefSubclassProc;
    use windows_sys::Win32::UI::WindowsAndMessaging::{WM_NCLBUTTONDOWN, WM_NCMBUTTONDOWN, WM_NCRBUTTONDOWN};
    if matches!(msg, WM_NCLBUTTONDOWN | WM_NCRBUTTONDOWN | WM_NCMBUTTONDOWN) {
        // SAFETY: `data` is the handle boxed in `watch`, never freed.
        let app = unsafe { &*(data as *const tauri::AppHandle) };
        let _ = app.emit(EVENT, ());
    }
    // The press itself goes on as always: moving, resizing, the window menu.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Elsewhere moving or resizing the window reaches the frontend through the window's own events.
#[cfg(not(windows))]
pub fn watch(_window: &tauri::WebviewWindow) {}
