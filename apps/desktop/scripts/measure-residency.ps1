param(
    [Parameter(Mandatory)][int]$RootProcessId,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][ValidateSet('quiet-login', 'after-interaction')][string]$Phase,
    [Parameter(Mandatory)][string]$BuildDescription,
    [Parameter(Mandatory)][string]$WorkloadDescription,
    [switch]$NormalSyncEnabled,
    [ValidateRange(1, 3600)][int]$DurationSeconds = 600
)

$ErrorActionPreference = 'Stop'
$taskClock = [Diagnostics.Stopwatch]::StartNew()
$taskStarted = [DateTime]::UtcNow
$taskRoot = Get-Process -Id $RootProcessId
$taskRootStart = $taskRoot.StartTime.ToUniversalTime()
$taskExe = $taskRoot.Path
$taskStream = [IO.File]::OpenRead($taskExe)
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskExecutableHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
finally { $taskStream.Dispose(); $taskHasher.Dispose() }
$taskMachine = Get-CimInstance Win32_ComputerSystem
$taskWindows = Get-CimInstance Win32_OperatingSystem
$taskProcessors = @(Get-CimInstance Win32_Processor)
$taskDisks = @(Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, Size)
$taskLogicalCount = [int]$taskMachine.NumberOfLogicalProcessors
$taskKnown = @{}
$taskSamples = [Collections.Generic.List[object]]::new()
$taskComplete = $true

function Read-ProcessTree {
    $taskAll = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, ExecutablePath)
    $taskIds = [Collections.Generic.HashSet[int]]::new()
    [void]$taskIds.Add($RootProcessId)
    do {
        $taskAdded = $false
        foreach ($taskEntry in $taskAll) {
            if ($taskIds.Contains([int]$taskEntry.ParentProcessId) -and
                $taskEntry.CreationDate.ToUniversalTime() -ge $taskRootStart -and
                $taskIds.Add([int]$taskEntry.ProcessId)) {
                $taskAdded = $true
            }
        }
    } while ($taskAdded)
    @($taskAll | Where-Object { $taskIds.Contains([int]$_.ProcessId) })
}

$taskBaseline = $null
$taskCpuSeconds = 0.0
do {
    $taskCurrentRoot = Get-Process -Id $RootProcessId
    if ($taskCurrentRoot.StartTime.ToUniversalTime() -ne $taskRootStart) {
        throw 'The root process exited or its PID was reused; restart the measurement.'
    }
    $taskTree = @(Read-ProcessTree)
    $taskPrivateBytes = 0L
    $taskProcessSamples = [Collections.Generic.List[object]]::new()
    foreach ($taskEntry in $taskTree) {
        try {
            $taskProcess = Get-Process -Id $taskEntry.ProcessId
            $taskKey = "$($taskEntry.ProcessId):$($taskEntry.CreationDate.ToUniversalTime().Ticks)"
            $taskCpu = $taskProcess.TotalProcessorTime.TotalSeconds
            $taskPrivate = $taskProcess.PrivateMemorySize64
            if (-not $taskKnown.ContainsKey($taskKey)) {
                $taskVersion = if ($taskEntry.ExecutablePath) { [Diagnostics.FileVersionInfo]::GetVersionInfo($taskEntry.ExecutablePath).FileVersion } else { $null }
                $taskKnown[$taskKey] = [ordered]@{
                    pid = [int]$taskEntry.ProcessId; parentPid = [int]$taskEntry.ParentProcessId
                    name = $taskEntry.Name; path = $taskEntry.ExecutablePath; fileVersion = $taskVersion
                    startedUtc = $taskEntry.CreationDate.ToUniversalTime().ToString('o')
                    firstCpuSeconds = $taskCpu; lastCpuSeconds = $taskCpu
                }
                if ($null -ne $taskBaseline) { $taskComplete = $false }
            }
            $taskKnown[$taskKey].lastCpuSeconds = $taskCpu
            $taskPrivateBytes += $taskPrivate
            $taskProcessSamples.Add(@{ pid = [int]$taskEntry.ProcessId; privateBytes = $taskPrivate; cpuSeconds = $taskCpu })
        } catch {
            $taskComplete = $false
        }
    }
    if ($null -eq $taskBaseline) {
        $taskBaseline = $taskClock.Elapsed.TotalSeconds
    }
    if ($taskTree.Count -ne $taskKnown.Count) { $taskComplete = $false }
    $taskElapsed = $taskClock.Elapsed.TotalSeconds - $taskBaseline
    $taskSamples.Add(@{ elapsedSeconds = $taskElapsed; privateBytes = $taskPrivateBytes; processes = @($taskProcessSamples.ToArray()) })
    if ($taskElapsed -ge $DurationSeconds) { break }
    Start-Sleep -Milliseconds 1000
} while ($true)

foreach ($taskProcess in $taskKnown.Values) {
    $taskCpuSeconds += $taskProcess.lastCpuSeconds - $taskProcess.firstCpuSeconds
}
$taskPeakMiB = ($taskSamples | ForEach-Object { $_.privateBytes } | Measure-Object -Maximum).Maximum / 1MB
$taskCpuPercent = 100 * $taskCpuSeconds / $taskElapsed / $taskLogicalCount
$taskSignature = 'Unavailable (verify separately)'
try { $taskSignature = [string](Get-AuthenticodeSignature -LiteralPath $taskExe).Status } catch {
    # Restricted/embedded PowerShell installations may not load the security
    # module. Preserve the measurements without claiming a verified signature.
}
$taskResult = [ordered]@{
    startedUtc = $taskStarted.ToString('o'); phase = $Phase
    build = $BuildDescription; executable = $taskExe
    executableSha256 = $taskExecutableHash
    signature = $taskSignature
    workload = $WorkloadDescription; normalSyncEnabled = [bool]$NormalSyncEnabled
    windows = @{ caption = $taskWindows.Caption; version = $taskWindows.Version; build = $taskWindows.BuildNumber }
    hardware = @{ model = $taskMachine.Model; ramBytes = [long]$taskMachine.TotalPhysicalMemory; logicalProcessors = $taskLogicalCount; processors = @($taskProcessors | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors); disks = $taskDisks }
    attribution = 'Root PID and recursively observed descendants, qualified by process creation time; includes all attributable WebView2 processes. Sampler process is excluded.'
    method = 'Approximately one-second samples of PrivateMemorySize64 (private committed bytes) and TotalProcessorTime, divided by wall time and total logical CPU count. Process turnover invalidates settled accounting.'
    intervalSeconds = $taskElapsed; processAccountingComplete = $taskComplete
    peakPrivateMiB = $taskPeakMiB; meanMachineCpuPercent = $taskCpuPercent
    targets = @{ peakPrivateMiB = 300; meanMachineCpuPercentExclusive = 1; intervalSeconds = 600 }
    resourceTargetsMet = ($taskComplete -and $taskElapsed -ge 600 -and $NormalSyncEnabled -and $taskPeakMiB -le 300 -and $taskCpuPercent -lt 1)
    releaseCertification = $false
    note = 'Verify the signed installed build, accepted hardware and maximum-library workload separately. Short smoke runs or incomplete process accounting cannot establish the release targets.'
    processes = @($taskKnown.Values); samples = @($taskSamples.ToArray())
}
$taskResolvedOutput = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskResolvedOutput)) | Out-Null
$taskResult | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $taskResolvedOutput -Encoding UTF8
Write-Output "Saved $taskResolvedOutput"
