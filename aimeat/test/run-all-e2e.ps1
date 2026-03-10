# Run all 9 E2E test suites with fresh server for each
# Usage: cd aimeat; .\test\run-all-e2e.ps1

$ErrorActionPreference = 'Continue'

$env:AIMEAT_PORT = "40251"
$env:AIMEAT_RL_GLOBAL = "10000"
$env:AIMEAT_RL_AUTH = "1000"
$env:AIMEAT_RL_WORK = "1000"
$env:AIMEAT_RL_MEMORY = "1000"
$env:AIMEAT_RL_BOARDS = "1000"

$tests = @(
    "test/api-full.ts",
    "test/e2e-micro-memory.ts",
    "test/e2e-concurrency.ts",
    "test/e2e-disputes.ts",
    "test/e2e-federation.ts",
    "test/e2e-hooks.ts",
    "test/e2e-mcp.ts",
    "test/e2e-storage-visibility.ts",
    "test/e2e-board-ttl.ts"
)

$results = @()

foreach ($t in $tests) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($t)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  $name" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # Kill any existing server on the port
    $proc = Get-NetTCPConnection -LocalPort 40251 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
    Start-Sleep -Seconds 1

    # Start fresh server
    $serverJob = Start-Job -ScriptBlock {
        Set-Location "e:\dev\GitHub\JM001\aimeat"
        $env:AIMEAT_PORT = "40251"
        $env:AIMEAT_RL_GLOBAL = "10000"
        $env:AIMEAT_RL_AUTH = "1000"
        $env:AIMEAT_RL_WORK = "1000"
        $env:AIMEAT_RL_MEMORY = "1000"
        $env:AIMEAT_RL_BOARDS = "1000"
        npx tsx src/index.ts 2>&1
    }

    # Wait for server to be ready
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:40251/v1/spec" -TimeoutSec 2 -ErrorAction Stop
            $ready = $true
            break
        } catch {}
    }

    if (-not $ready) {
        Write-Host "  SKIPPED - server failed to start" -ForegroundColor Red
        $results += [PSCustomObject]@{ Name = $name; Passed = "?"; Failed = "?"; Total = "?"; Time = "N/A" }
        Stop-Job $serverJob -ErrorAction SilentlyContinue
        Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
        continue
    }

    # Run test
    $start = Get-Date
    $output = npx tsx $t 2>&1 | Out-String
    $end = Get-Date
    $elapsed = [math]::Round(($end - $start).TotalSeconds, 2)

    # Parse results line — handles all output formats:
    #   "=== Results: X passed, Y failed out of Z ===" 
    #   "Dispute E2E: X passed, Y failed out of Z"
    #   "Hook Execution E2E: X passed, Y failed (Z total)"
    $resultLine = $output -split "`n" | Where-Object { $_ -match '\d+ passed.*\d+ failed' } | Select-Object -Last 1
    if ($resultLine -match '(\d+) passed.*?(\d+) failed.*?(?:out of |.*\()(\d+)') {
        $p = $Matches[1]; $f = $Matches[2]; $total = $Matches[3]
    } else {
        $p = "?"; $f = "?"; $total = "?"
    }

    $status = if ($f -eq "0") { "GREEN" } else { "RED" }
    $color = if ($f -eq "0") { "Green" } else { "Red" }
    Write-Host "  Result: $p/$total passed in ${elapsed}s" -ForegroundColor $color

    $results += [PSCustomObject]@{ Name = $name; Passed = $p; Failed = $f; Total = $total; Time = "${elapsed}s" }

    # Kill server
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
    $proc2 = Get-NetTCPConnection -LocalPort 40251 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($proc2) { $proc2 | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "  SUMMARY" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
$results | Format-Table -AutoSize
