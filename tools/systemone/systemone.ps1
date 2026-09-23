<#
.SYNOPSIS
  Stand up the open System One decision models on this machine, one at a time or all three.

.DESCRIPTION
  Laya, von and jeff all serve POST /v1/systemone, all default to port 8000, and all want their own
  Python environment. This script gives each one a port, a virtual environment and a weights cache
  under .runtime\ beside itself, and starts and stops them without touching anything global.

  Nothing here is installed system-wide and nothing is written outside this folder. .runtime\ is
  gitignored. For the same models in Docker instead, see docker\ and README.md.

.EXAMPLE
  .\systemone.ps1 install all
  .\systemone.ps1 up laya
  .\systemone.ps1 smoke laya
  .\systemone.ps1 status
  .\systemone.ps1 down all

.NOTES
  Windows, Python 3.12 (py launcher) and, for the GPU, an NVIDIA card. README.md beside this file.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('install', 'up', 'down', 'status', 'smoke', 'logs')]
  [string]$Command,

  [Parameter(Position = 1)]
  [ValidateSet('laya', 'von', 'jeff', 'all')]
  [string]$Provider = 'all',

  # The python to build each virtual environment with. 3.12 is what jeff requires and what the
  # other two are happy on.
  [string]$Python = 'py -3.12'
)

$ErrorActionPreference = 'Stop'
$Root = Join-Path $PSScriptRoot '.runtime'
$Providers = @{
  laya = @{ Port = 8801; Model = 'multilingual'; Auth = ''      }
  von  = @{ Port = 8802; Model = 'von-1.1.0';    Auth = ''      }
  jeff = @{ Port = 8803; Model = 'gliformer-large-v1'; Auth = 'devkey' }
}

function Resolve-Targets([string]$name) {
  if ($name -eq 'all') { return @('laya', 'von', 'jeff') }
  return @($name)
}

function New-Dirs([string]$name) {
  foreach ($d in @("$Root\$name", "$Root\$name\hf", "$Root\logs", "$Root\pids")) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
}

function Venv-Python([string]$name) { Join-Path $Root "$name\venv\Scripts\python.exe" }

# A native command's failure does not stop a PowerShell script, so every one goes through this.
function Invoke-Native([string]$what, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function New-Venv([string]$name) {
  $venv = Join-Path $Root "$name\venv"
  if (Test-Path (Venv-Python $name)) { return }
  Write-Host "[$name] creating a virtual environment"
  # Split into an ARRAY: '$exe, $exeArgs = ...' leaves a single argument a string, and splatting a
  # string drops it, so 'py -3.12' ran the default Python's interactive shell instead (2026-09-23).
  $parts = @($Python.Split(' '))
  $exe = $parts[0]
  $exeArgs = @($parts | Select-Object -Skip 1)
  Invoke-Native "[$name] venv" { & $exe @exeArgs -m venv $venv }
  Invoke-Native "[$name] pip upgrade" { & (Venv-Python $name) -m pip install --upgrade pip --quiet }
}

# PyPI's torch wheel for Windows is CPU-only. Install the CUDA build first, so the package's own
# torch requirement is already met and pip leaves it alone.
function Install-CudaTorch([string]$name) {
  $py = Venv-Python $name
  $has = & $py -c "import torch,sys; sys.stdout.write('1' if torch.cuda.is_available() else '0')" 2>$null
  if ($has -eq '1') { return }
  Write-Host "[$name] installing the CUDA build of torch"
  Invoke-Native "[$name] torch" { & $py -m pip install torch --index-url https://download.pytorch.org/whl/cu128 }
}

# ── install ───────────────────────────────────────────────────────────────────────────────────

function Install-Provider([string]$name) {
  New-Dirs $name
  New-Venv $name
  Install-CudaTorch $name
  $py = Venv-Python $name
  switch ($name) {
    'laya' {
      Write-Host '[laya] installing laya[serve]'
      Invoke-Native '[laya] pip' { & $py -m pip install --upgrade 'laya[serve]' }
    }
    'von' {
      Write-Host '[von] installing von-sdk'
      Invoke-Native '[von] pip' { & $py -m pip install --upgrade von-sdk }
      if (-not (Test-Path (Join-Path $Root 'von\venv\Scripts\von.exe'))) {
        # The PyPI package may be the client only. The repository carries the server.
        Write-Host '[von] no `von` command from the package; installing from the repository instead'
        Invoke-Native '[von] pip (repository)' { & $py -m pip install --upgrade 'git+https://github.com/wfzyx/von.git' }
      }
    }
    'jeff' {
      $src = Join-Path $Root 'jeff\src'
      if (-not (Test-Path $src)) {
        Write-Host '[jeff] cloning the repository'
        Invoke-Native '[jeff] clone' { git clone --depth 1 https://github.com/logan-markewich/jeff $src }
      }
      Write-Host '[jeff] installing it and its dependencies'
      Invoke-Native '[jeff] pip' { & $py -m pip install --upgrade $src }
      $models = Join-Path $Root 'jeff\models\gliformer-large-v1'
      if (-not (Test-Path (Join-Path $models 'config.json'))) {
        Write-Host '[jeff] downloading GLiFormer (about 1.5 GB)'
        $env:HF_HOME = Join-Path $Root 'jeff\hf'
        # huggingface_hub 1.x has no `commands.huggingface_cli` module (and no [cli] extra), so the
        # download goes through the library call rather than the old CLI module (2026-09-23).
        $dl = "from huggingface_hub import snapshot_download; snapshot_download('knowledgator/gliformer-large-v1', local_dir=r'$models')"
        Invoke-Native '[jeff] weights' { & $py -c $dl }
      }
    }
  }
  Write-Host "[$name] installed"
}

# ── up / down / status ────────────────────────────────────────────────────────────────────────

function Pid-File([string]$name) { Join-Path $Root "pids\$name.pid" }
function Log-File([string]$name) { Join-Path $Root "logs\$name.log" }

function Get-Running([string]$name) {
  $f = Pid-File $name
  if (-not (Test-Path $f)) { return $null }
  $processId = (Get-Content $f -Raw).Trim()
  $p = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $p) { Remove-Item $f -Force; return $null }
  return $p
}

function Start-Provider([string]$name) {
  if (Get-Running $name) { Write-Host "[$name] already up on port $($Providers[$name].Port)"; return }
  New-Dirs $name
  $py = Venv-Python $name
  if (-not (Test-Path $py)) { throw "[$name] is not installed yet. Run: .\systemone.ps1 install $name" }
  $port = $Providers[$name].Port
  $bin = Join-Path $Root "$name\venv\Scripts"
  $envs = @{
    HF_HOME = Join-Path $Root "$name\hf"
    # 127.0.0.1 on purpose: these answer the node on this machine and nothing else.
    LAYA_HOST = '127.0.0.1'; LAYA_PORT = "$port"; LAYA_DEVICE = 'cuda'; LAYA_PRELOAD = '1'
    JEFF_HOST = '127.0.0.1'; JEFF_PORT = "$port"; JEFF_API_KEYS = 'devkey'
    JEFF_MODEL = (Join-Path $Root 'jeff\models\gliformer-large-v1')
  }
  foreach ($k in $envs.Keys) { Set-Item -Path "env:$k" -Value $envs[$k] }

  $exe, $exeArgs = switch ($name) {
    'laya' { (Join-Path $bin 'laya-serve.exe'), @() }
    'von'  { (Join-Path $bin 'von.exe'), @('serve', '--host', '127.0.0.1', '--port', "$port") }
    'jeff' { (Join-Path $bin 'jeff.exe'), @() }
  }
  if (-not (Test-Path $exe)) { throw "[$name] has no server command at $exe. Re-run: .\systemone.ps1 install $name" }

  $log = Log-File $name
  Write-Host "[$name] starting on 127.0.0.1:$port (log: $log)"
  $p = Start-Process -FilePath $exe -ArgumentList $exeArgs -RedirectStandardOutput $log `
        -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
  $p.Id | Out-File -FilePath (Pid-File $name) -Encoding ascii
  Write-Host "[$name] pid $($p.Id). First start loads the weights, so give it a moment, then: .\systemone.ps1 smoke $name"
}

function Stop-Provider([string]$name) {
  $p = Get-Running $name
  if ($null -eq $p) { Write-Host "[$name] is not up"; return }
  Write-Host "[$name] stopping pid $($p.Id)"
  Stop-Process -Id $p.Id -Force
  Remove-Item (Pid-File $name) -Force -ErrorAction SilentlyContinue
}

function Show-Status() {
  foreach ($name in @('laya', 'von', 'jeff')) {
    $p = Get-Running $name
    $port = $Providers[$name].Port
    $installed = Test-Path (Venv-Python $name)
    $state = if ($p) { "up, pid $($p.Id)" } elseif ($installed) { 'installed, down' } else { 'not installed' }
    $health = ''
    if ($p) {
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/v1/models" -TimeoutSec 2 -UseBasicParsing
        $health = " · answers on $port ($($r.StatusCode))"
      } catch { $health = " · port $port not answering yet" }
    }
    Write-Host ("{0,-6} {1}{2}" -f $name, $state, $health)
  }
}

# ── smoke ─────────────────────────────────────────────────────────────────────────────────────

function Invoke-Smoke([string]$name) {
  $port = $Providers[$name].Port
  $body = @{
    model = $Providers[$name].Model
    state = @{ body = 'We were billed twice for March and would like a refund today.' }
    questions = @{
      dept = @{ type = 'choice'; instructions = 'Which team should handle this?'
                criteria = @{ billing = 'invoices, payments, refunds'; tech = 'bugs and outages'; other = 'anything else' } }
      refund = @{ type = 'noul'; instructions = 'The customer asks for money back.' }
      urgency = @{ type = 'score'; instructions = 'How urgent is this?'; criteria = @('not urgent', 'soon', 'today') }
    }
  } | ConvertTo-Json -Depth 8
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($Providers[$name].Auth) { $headers['Authorization'] = "Bearer $($Providers[$name].Auth)" }
  Write-Host "[$name] one call to http://127.0.0.1:$port/v1/systemone"
  $t0 = Get-Date
  try {
    $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/v1/systemone" -Headers $headers -Body $body -TimeoutSec 120
    $ms = [int]((Get-Date) - $t0).TotalMilliseconds
    Write-Host "[$name] answered in ${ms} ms"
    $r | ConvertTo-Json -Depth 8
  } catch {
    Write-Host "[$name] the call failed: $($_.Exception.Message)"
    Write-Host "[$name] last lines of the log:"
    if (Test-Path (Log-File $name)) { Get-Content (Log-File $name) -Tail 20 }
  }
}

# ── dispatch ──────────────────────────────────────────────────────────────────────────────────

if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }

switch ($Command) {
  'install' { foreach ($n in Resolve-Targets $Provider) { Install-Provider $n } }
  'up'      { foreach ($n in Resolve-Targets $Provider) { Start-Provider $n } }
  'down'    { foreach ($n in Resolve-Targets $Provider) { Stop-Provider $n } }
  'smoke'   { foreach ($n in Resolve-Targets $Provider) { Invoke-Smoke $n } }
  'logs'    { foreach ($n in Resolve-Targets $Provider) { Write-Host "--- $n"; if (Test-Path (Log-File $n)) { Get-Content (Log-File $n) -Tail 40 } } }
  'status'  { Show-Status }
}
