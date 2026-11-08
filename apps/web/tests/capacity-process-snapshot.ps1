param([int]$NativeProcessId)
$ErrorActionPreference = 'Stop'
$entries = @(Get-CimInstance Win32_Process)
$root = $entries | Where-Object ProcessId -EQ $NativeProcessId
if (-not $root) { throw 'Native process exited before sampling' }
$owners = [System.Collections.Generic.HashSet[int]]::new()
[void]$owners.Add($NativeProcessId)
do {
  $added = $false
  foreach ($entry in $entries) {
    if ($owners.Contains([int]$entry.ParentProcessId) -and $entry.CreationDate -ge $root.CreationDate) {
      if ($owners.Add([int]$entry.ProcessId)) { $added = $true }
    }
  }
} while ($added)
@($entries | Where-Object { $owners.Contains([int]$_.ProcessId) } | ForEach-Object {
  [ordered]@{id=$_.ProcessId; parent=$_.ParentProcessId; name=$_.Name; privateBytes=[long]$_.PrivatePageCount; role=$(if ($_.CommandLine -match '--type=([^ ]+)') { $Matches[1] } elseif ($_.Name -eq 'msedgewebview2.exe') { 'browser' } else { 'native' })}
}) | ConvertTo-Json -Depth 3 -Compress
