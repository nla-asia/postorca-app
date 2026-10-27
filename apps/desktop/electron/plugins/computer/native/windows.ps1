$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class PbaWindow {
  public string id, title, path, name;
  public int pid;
  public PbaBounds bounds;
}
public class PbaBounds { public int x, y, width, height; }
public static class PbaWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc callback, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint objectId, ref Guid iid, out IntPtr result);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static PbaWindow Get(IntPtr h) {
    if (!IsWindowVisible(h)) throw new Exception("Window is no longer visible.");
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    RECT r; if (!GetWindowRect(h, out r)) throw new Exception("Window bounds unavailable.");
    var title = new StringBuilder(2048); GetWindowText(h, title, title.Capacity);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string path = "", name = "";
    try { var p = System.Diagnostics.Process.GetProcessById((int)pid); name = p.ProcessName; path = p.MainModule.FileName; } catch {}
    return new PbaWindow { id=h.ToInt64().ToString(), title=title.ToString(), pid=(int)pid, path=path, name=name,
      bounds=new PbaBounds { x=r.Left, y=r.Top, width=r.Right-r.Left, height=r.Bottom-r.Top } };
  }
  public static PbaWindow[] List() {
    var list = new List<PbaWindow>();
    EnumWindows((h,p) => { try { var w=Get(h); if (w.title.Length>0 && w.bounds.width>0 && w.bounds.height>0) list.Add(w); } catch {} return true; }, IntPtr.Zero);
    return list.ToArray();
  }
  public static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    SetForegroundWindow(h);
    if (GetForegroundWindow() == h) return;
    uint ignored;
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    uint current = GetCurrentThreadId();
    bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
    try { BringWindowToTop(h); SetForegroundWindow(h); }
    finally { if (attached) AttachThreadInput(current, foreground, false); }
  }
  public static object FocusDiagnostics(IntPtr h) {
    return new { enabled=IsWindowEnabled(h), foreground=GetForegroundWindow().ToInt64().ToString(), popup=GetLastActivePopup(h).ToInt64().ToString() };
  }
  public static void WarmAccessibility(IntPtr h) {
    // Chromium can create its renderer tree lazily on an MSAA client request.
    // Ask through the standard accessibility API; do not change screen-reader settings.
    var handles = new List<IntPtr> { h };
    EnumChildWindows(h, (child,p) => { if (handles.Count < 8) handles.Add(child); return handles.Count < 8; }, IntPtr.Zero);
    var iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
    foreach (var handle in handles) {
      var name = new StringBuilder(256); GetClassName(handle, name, name.Capacity);
      if (!name.ToString().StartsWith("Chrome_", StringComparison.Ordinal)) continue;
      IntPtr accessible = IntPtr.Zero;
      try { AccessibleObjectFromWindow(handle, unchecked((uint)-4), ref iid, out accessible); }
      finally { if (accessible != IntPtr.Zero) Marshal.Release(accessible); }
    }
  }
}
'@
  if ($request.action -eq 'list') {
    $windows = @([PbaWindows]::List())
    $apps = @($windows | Group-Object pid | ForEach-Object {
      $first = $_.Group[0]
      @{ id="process:$($first.pid)"; name=$first.name; path=$first.path; windows=@($_.Group) }
    })
    if (-not $request.running_only) {
      # Get-StartApps supplies registered launch IDs without inspecting arbitrary executables.
      $apps += @(Get-StartApps | ForEach-Object { @{ id="start:$($_.AppID)"; name=$_.Name; windows=@() } })
    }
    $result = @{ apps=$apps }
  } elseif ($request.action -eq 'open') {
    if ($request.app.id -match '^process:(\d+)$') {
      $target = @([PbaWindows]::List() | Where-Object { $_.pid -eq [int]$Matches[1] }) | Select-Object -First 1
      if (-not $target) { throw 'The selected app no longer has a visible window.' }
      [PbaWindows]::Focus([IntPtr]::new([long]$target.id))
    } elseif ($request.app.id.StartsWith('start:')) {
      $launchId = $request.app.id.Substring(6)
      $entry = @(Get-StartApps | Where-Object AppID -eq $launchId)
      if ($entry.Count -ne 1) { throw 'App launch ID is no longer available; list apps again.' }
      Start-Process -FilePath 'explorer.exe' -ArgumentList @("shell:AppsFolder\$launchId") -WindowStyle Hidden | Out-Null
    } else { throw 'Unknown app ID.' }
    $result = @{ requested=$true }
  } else {
    if ($request.window -notmatch '^\d+$') { throw 'Invalid window ID.' }
    $handle = [IntPtr]::new([long]$request.window)
    $window = [PbaWindows]::Get($handle)
    if ($request.expected_pid -and $window.pid -ne $request.expected_pid) { throw 'Window belongs to another process; list apps again.' }
    if ($request.action -eq 'focus') {
      [PbaWindows]::Focus($handle)
      Start-Sleep -Milliseconds 120
      $window = [PbaWindows]::Get($handle)
      $focused = [PbaWindows]::GetForegroundWindow() -eq $handle
      $result = @{ window=$window; foreground=$focused; focus_details=[PbaWindows]::FocusDiagnostics($handle) }
    } elseif ($request.action -eq 'window') {
      $result = @{ window=$window; foreground=([PbaWindows]::GetForegroundWindow() -eq $handle) }
    } elseif ($request.action -eq 'accessibility') {
      [PbaWindows]::WarmAccessibility($handle)
      Start-Sleep -Milliseconds 150
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $queue = [System.Collections.Generic.Queue[object]]::new()
      $queue.Enqueue(@{ element=$root; depth=0 })
      $nodes = [System.Collections.Generic.List[object]]::new()
      $watch = [System.Diagnostics.Stopwatch]::StartNew()
      $characters = 0
      $cutOff = $false
      while ($queue.Count -gt 0 -and $nodes.Count -lt 400 -and $characters -lt 24000 -and $watch.ElapsedMilliseconds -lt 4000) {
        $entry = $queue.Dequeue(); $element = $entry.element
        try {
          $current = $element.Current
          if (-not $current.IsPassword) {
            $text = $current.Name
            $textTruncated = $false
            $pattern = $null
            $valueText = ''
            $visibleText = ''
            if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
              $valueText = $pattern.DocumentRange.GetText(2001)
              try { $visibleText = (@($pattern.GetVisibleRanges()) | Select-Object -First 8 | ForEach-Object { $_.GetText(2000) }) -join "`n"; if ($visibleText.Length -gt 2000) { $visibleText=$visibleText.Substring(0,2000) } } catch { }
            } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
              $valueText = $pattern.Current.Value
            }
            if ($valueText -and $valueText.Trim() -ne $text.Trim()) { $text += "`n" + $valueText }
            if ($text.Length -gt 2000) { $text = $text.Substring(0,2000); $textTruncated=$true; $cutOff=$true }
            $characters += $text.Length
            $rect = $current.BoundingRectangle
            # Hidden UIA elements can have Rect.Empty (Infinity/-Infinity), which
            # Windows PowerShell serializes as invalid JSON numeric literals.
            $nodeBounds = $null
            $invalid = @(@($rect.X,$rect.Y,$rect.Width,$rect.Height) | Where-Object { [double]::IsNaN($_) -or [double]::IsInfinity($_) })
            if ($invalid.Count -eq 0) { $nodeBounds=@{x=$rect.X;y=$rect.Y;width=$rect.Width;height=$rect.Height} }
            $nodes.Add(@{ role=$current.ControlType.ProgrammaticName; text=$text; visible_text=$visibleText; text_truncated=$textTruncated; depth=$entry.depth; bounds=$nodeBounds })
          }
          if ($entry.depth -lt 30) {
            $child = $walker.GetFirstChild($element)
            while ($child -and $queue.Count -lt 500) {
              $queue.Enqueue(@{element=$child;depth=$entry.depth+1}); $child=$walker.GetNextSibling($child)
            }
            if ($child) { $cutOff=$true }
          } elseif ($walker.GetFirstChild($element)) {
            $cutOff=$true
          }
        } catch { }
      }
      $result = @{ nodes=@($nodes.ToArray()); truncated=($queue.Count -gt 0 -or $cutOff); bounds_space='desktop'; source='Windows UI Automation' }
    } else { throw 'Unsupported native action.' }
  }
  $result | ConvertTo-Json -Depth 20 -Compress
} catch {
  @{ error=$_.Exception.Message } | ConvertTo-Json -Compress
}
