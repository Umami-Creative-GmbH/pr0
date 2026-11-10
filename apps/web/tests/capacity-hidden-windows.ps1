param([int]$NativeProcessId)
$ErrorActionPreference = 'Stop'
# Inspect only this fixture's two application windows; a console can remain visible.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CapacityWindows {
  private delegate bool Visitor(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  public sealed class Surface { public string Title; public bool Visible; }
  public static Surface[] Read(int owner) {
    var surfaces = new List<Surface>();
    EnumWindows((window, parameter) => {
      uint process;
      GetWindowThreadProcessId(window, out process);
      if (process == owner) {
        var title = new StringBuilder(256);
        GetWindowText(window, title, title.Capacity);
        if (title.ToString().StartsWith("pr0", StringComparison.Ordinal)) {
          surfaces.Add(new Surface { Title = title.ToString(), Visible = IsWindowVisible(window) });
        }
      }
      return true;
    }, IntPtr.Zero);
    return surfaces.ToArray();
  }
}
'@
$surfaces = @([CapacityWindows]::Read($NativeProcessId))
if ($surfaces.Count -ne 2) { throw 'Expected both native application surfaces' }
if (@($surfaces | Where-Object Visible).Count -ne 0) { throw 'A native application surface remains visible' }
