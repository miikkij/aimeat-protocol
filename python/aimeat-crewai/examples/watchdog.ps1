# Watchdog supervisor for crew_daemon.py (Windows / PowerShell).
#
# Same semantics as watchdog.sh: restart on crash with crash-loop protection.
# If the daemon dies faster than MIN_UPTIME_SECS too many times in a row, the
# watchdog gives up rather than thrashing.
#
# Tunables (via env):
#   $env:AIMEAT_AGENT_NAME   default: demo-crew
#   $env:CREW_SCRIPT         default: crew_daemon.py (next to this file)
#   $env:MIN_UPTIME_SECS     default: 30
#   $env:MAX_FAST_CRASHES    default: 5
#   $env:PYTHON              default: python

$AgentName       = if ($env:AIMEAT_AGENT_NAME) { $env:AIMEAT_AGENT_NAME } else { 'demo-crew' }
$CrewScript      = if ($env:CREW_SCRIPT)       { $env:CREW_SCRIPT }       else { Join-Path $PSScriptRoot 'crew_daemon.py' }
$MinUptimeSecs   = if ($env:MIN_UPTIME_SECS)   { [int]$env:MIN_UPTIME_SECS }   else { 30 }
$MaxFastCrashes  = if ($env:MAX_FAST_CRASHES)  { [int]$env:MAX_FAST_CRASHES }  else { 5 }
$Python          = if ($env:PYTHON)            { $env:PYTHON }            else { 'python' }

$fastCrashes = 0
$totalRuns = 0

while ($true) {
    $totalRuns++
    Write-Host "[watchdog] starting daemon (run #$totalRuns, agent=$AgentName)"
    $startTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    $env:AIMEAT_AGENT_NAME = $AgentName
    $proc = Start-Process -FilePath $Python -ArgumentList $CrewScript -NoNewWindow -PassThru -Wait
    $exitCode = $proc.ExitCode

    $endTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $uptime = $endTs - $startTs

    Write-Host "[watchdog] daemon exited code=$exitCode after ${uptime}s"

    if ($exitCode -eq 0) {
        Write-Host "[watchdog] daemon exited cleanly, stopping watchdog"
        exit 0
    }

    if ($uptime -lt $MinUptimeSecs) {
        $fastCrashes++
        Write-Host "[watchdog] fast crash ($fastCrashes/$MaxFastCrashes)"
        if ($fastCrashes -ge $MaxFastCrashes) {
            Write-Host "[watchdog] too many fast crashes -- giving up (check the daemon's logs)"
            exit 1
        }
    } else {
        $fastCrashes = 0
    }

    $delay = [Math]::Min([Math]::Pow(2, $fastCrashes), 30)
    Write-Host "[watchdog] restarting in ${delay}s"
    Start-Sleep -Seconds $delay
}
