# E2E helper (Windows): closes the McBranchFace window like its X button, presses on its frame, or reports whether it
# is visible. The window is found by process id and title: the run's app has its own, beside any other McBranchFace.
# The main-window handle of the process is not reliable for a WebView2 app.
param(
  [ValidateSet("close", "minimize", "state", "press-frame")][string]$Do = "state",
  [Parameter(Mandatory = $true)][int]$Id,
  [Parameter(Mandatory = $true)][string]$Title
)
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WS {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static IntPtr Find(uint pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (p == pid && sb.ToString() == title) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
if (-not (Get-Process -Id $Id -ErrorAction SilentlyContinue)) { "process=none"; exit }
$h = [WS]::Find([uint32]$Id, $Title)
if ($h -eq [IntPtr]::Zero) { "window=none process=$Id"; exit }
switch ($Do) {
  "close" { [WS]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
  "minimize" { [WS]::ShowWindow($h, 6) | Out-Null }
  # WM_NCLBUTTONDOWN: what Windows sends the window for a press on its frame; the page itself never sees it.
  "press-frame" { [WS]::PostMessage($h, 0x00A1, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
}
"visible=$([WS]::IsWindowVisible($h)) minimized=$([WS]::IsIconic($h)) process=$Id"
