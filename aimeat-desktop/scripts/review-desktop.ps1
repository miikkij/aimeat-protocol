param([ValidateRange(40251, 65535)][int]$Port = 40497)

$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reviewRoot = Join-Path $desktopRoot 'src-tauri/target/desktop-review'
$binaryPath = Join-Path $desktopRoot 'src-tauri/target/debug/aimeat-desktop.exe'
if (-not (Test-Path -LiteralPath $binaryPath)) { throw 'Build the review app before running this script.' }
$reviewData = Join-Path $reviewRoot 'data'
$reviewProfile = Join-Path $reviewRoot 'profile'
$reviewRoaming = Join-Path $reviewProfile 'AppData/Roaming'
$reviewLocal = Join-Path $reviewProfile 'AppData/Local'
foreach ($folder in @($reviewData, $reviewProfile, $reviewRoaming, $reviewLocal,
  (Join-Path $reviewProfile '.claude'), (Join-Path $reviewProfile '.cursor'),
  (Join-Path $reviewProfile '.codex'), (Join-Path $reviewRoaming 'Code/User'))) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
}
$envPath = Join-Path $reviewData '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  # Desktop generates the private keys when it first reads this isolated configuration.
  [IO.File]::WriteAllText($envPath, "AIMEAT_STORAGE=sqlite`nAIMEAT_SQLITE_PATH=./data/aimeat.db`nAIMEAT_PORT=$Port`nAIMEAT_BIND_HOST=127.0.0.1`nAIMEAT_NODE_ID=desktop-review`nAIMEAT_FEDERATION_ROLE=standalone`n")
}

$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $binaryPath
$start.WorkingDirectory = $desktopRoot
$start.UseShellExecute = $false
$start.EnvironmentVariables.Clear()
foreach ($name in @('SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATH', 'TEMP', 'TMP', 'LANG')) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ($value) { $start.EnvironmentVariables[$name] = $value }
}
$start.EnvironmentVariables['USERPROFILE'] = $reviewProfile
$start.EnvironmentVariables['APPDATA'] = $reviewRoaming
$start.EnvironmentVariables['LOCALAPPDATA'] = $reviewLocal
$start.EnvironmentVariables['CLAUDE_CONFIG_DIR'] = $reviewProfile
$start.EnvironmentVariables['CODEX_HOME'] = Join-Path $reviewProfile '.codex'
$start.EnvironmentVariables['AIMEAT_DESKTOP_DATA_DIR'] = $reviewData
Write-Host "Desktop review: $reviewRoot"
Write-Host 'The local node and AI tool settings use this separate review folder.'
$process = [Diagnostics.Process]::Start($start)
$process.WaitForExit()
exit $process.ExitCode
