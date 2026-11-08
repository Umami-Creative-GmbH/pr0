param(
    [Parameter(Mandatory = $true)][int]$NativeProcessId,
    [int]$Seconds = 600
)
$ErrorActionPreference = 'Stop'
if ($Seconds -lt 600) { throw 'Settled residency requires at least ten minutes' }
$logicalProcessors = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$samples = [System.Collections.Generic.List[object]]::new()
$cpuByProcess = @{}
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$initialCpu = $null
$rootCreation = $null
$knownOwners = @{}
do {
    $processes = @(Get-CimInstance Win32_Process)
    $root = $processes | Where-Object ProcessId -EQ $NativeProcessId
    if (-not $root) { throw 'Native process exited during the residency interval' }
    if ($null -eq $rootCreation) { $rootCreation = $root.CreationDate }
    if ($root.CreationDate -ne $rootCreation) { throw 'Native process identity changed' }
    $owners = [System.Collections.Generic.HashSet[int]]::new()
    [void]$owners.Add($NativeProcessId)
    foreach ($entry in $processes) {
        if ($knownOwners.ContainsKey([int]$entry.ProcessId) -and $knownOwners[[int]$entry.ProcessId] -eq $entry.CreationDate) {
            [void]$owners.Add([int]$entry.ProcessId)
        }
    }
    do {
        $added = $false
        foreach ($entry in $processes) {
            if ($owners.Contains([int]$entry.ParentProcessId) -and $entry.CreationDate -ge $rootCreation) {
                if ($owners.Add([int]$entry.ProcessId)) { $added = $true }
            }
        }
    } while ($added)
    $privateBytes = 0L
    $attributed = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $processes) {
        if (-not $owners.Contains([int]$entry.ProcessId)) { continue }
        $key = '{0}:{1}' -f $entry.ProcessId,$entry.CreationDate.ToFileTimeUtc()
        $knownOwners[[int]$entry.ProcessId] = $entry.CreationDate
        $cpuByProcess[$key] = ([double]$entry.KernelModeTime + [double]$entry.UserModeTime) / 10000000
        $privateBytes += [long]$entry.PrivatePageCount
        $attributed.Add([ordered]@{ id = $entry.ProcessId; name = $entry.Name; privateBytes = [long]$entry.PrivatePageCount })
    }
    $cpuSeconds = ($cpuByProcess.Values | Measure-Object -Sum).Sum
    if ($null -eq $initialCpu) { $initialCpu = $cpuSeconds; $initialMs = $clock.Elapsed.TotalMilliseconds }
    $samples.Add([ordered]@{ elapsedMs = $clock.Elapsed.TotalMilliseconds; privateBytes = $privateBytes; cpuSeconds = $cpuSeconds; processes = @($attributed.ToArray()) })
    if ($clock.Elapsed.TotalMilliseconds - $initialMs -ge $Seconds * 1000) { break }
    Start-Sleep -Milliseconds 1000
} while ($true)
$elapsedMs = $samples[$samples.Count - 1].elapsedMs - $initialMs
$meanCpuPercent = 100 * ($cpuSeconds - $initialCpu) / ($elapsedMs / 1000) / $logicalProcessors
$peakPrivateBytes = ($samples | ForEach-Object { $_.privateBytes } | Measure-Object -Maximum).Maximum
[ordered]@{
    intervalMs = $elapsedMs
    logicalProcessors = $logicalProcessors
    peakSampledPrivateBytes = $peakPrivateBytes
    meanCpuPercentOfMachine = $meanCpuPercent
    memoryTargetBytes = 314572800
    cpuTargetPercent = 1
    samples = @($samples.ToArray())
} | ConvertTo-Json -Depth 8 -Compress
