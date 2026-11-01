//! Popup placement: top-right of the monitor that holds the user's active window.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const MARGIN: f64 = 20.0;

/// Work area (excludes the taskbar) in physical pixels: (left, top, right, bottom).
type Rect = (i32, i32, i32, i32);

#[cfg(windows)]
fn active_work_area(own: &WebviewWindow) -> Option<Rect> {
    use windows_sys::Win32::Foundation::{HWND, POINT};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetForegroundWindow};

    unsafe {
        let own_hwnd = own.hwnd().ok().map(|h| h.0 as HWND);
        let fg = GetForegroundWindow();
        let monitor = if !fg.is_null() && Some(fg) != own_hwnd {
            MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST)
        } else {
            // No usable foreground window (e.g. desktop focused): use the monitor under the cursor.
            let mut pt = POINT { x: 0, y: 0 };
            GetCursorPos(&mut pt);
            MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
        };
        if monitor.is_null() {
            return None;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        let r = info.rcWork;
        Some((r.left, r.top, r.right, r.bottom))
    }
}

#[cfg(not(windows))]
fn active_work_area(_own: &WebviewWindow) -> Option<Rect> {
    None
}

fn fallback_work_area(win: &WebviewWindow) -> Option<Rect> {
    let m = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())?;
    let (p, s) = (m.position(), m.size());
    Some((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32))
}

/// Scale factor of the monitor containing the centre of `area`.
fn scale_for(win: &WebviewWindow, area: Rect) -> f64 {
    let (cx, cy) = ((area.0 + area.2) / 2, (area.1 + area.3) / 2);
    win.available_monitors()
        .ok()
        .and_then(|ms| {
            ms.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                cx >= p.x && cx < p.x + s.width as i32 && cy >= p.y && cy < p.y + s.height as i32
            })
        })
        .map(|m| m.scale_factor())
        .unwrap_or_else(|| win.scale_factor().unwrap_or(1.0))
}

pub fn position_top_right(win: &WebviewWindow) {
    let Some(area) = active_work_area(win).or_else(|| fallback_work_area(win)) else {
        return;
    };

    // Keep whatever logical size the user last resized to, re-scaled for the target monitor's DPI.
    let current_scale = win.scale_factor().unwrap_or(1.0);
    // inner_size, not outer_size: set_size() sets the inner size, so mixing them grows the window on every show.
    let (lw, lh) = win
        .inner_size()
        .map(|s| (s.width as f64 / current_scale, s.height as f64 / current_scale))
        .unwrap_or((420.0, 520.0));

    let scale = scale_for(win, area);
    let margin = (MARGIN * scale).round() as i32;
    let avail_w = (area.2 - area.0 - 2 * margin).max(200);
    let avail_h = (area.3 - area.1 - 2 * margin).max(200);
    let w = ((lw * scale).round() as i32).min(avail_w);
    let h = ((lh * scale).round() as i32).min(avail_h);
    let x = area.2 - margin - w;
    let y = area.1 + margin;

    // Move first so a DPI change between monitors is applied before sizing, then settle.
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}
