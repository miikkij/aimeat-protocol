<#
.SYNOPSIS
  Stand up the open System One decision models on this machine, one at a time or all three.

.DESCRIPTION
  Laya, von and jeff all serve POST /v1/systemone, all default to port 8000, and all want their own
  Python environment. This script gives each one a port, a virtual environment and a weights cache
  under .runtime\ beside itself, and starts and stops them without touching anything global.

  Nothing here is installed system-wide and nothing is written outside this folder. .runtime\ is
  gitignored. For the same models in Docker instead, see docker\ and README.md.

  It installs what the Docker images carry: every package at the version in that model's lock
  (docker\<model>\requirements-cu128.txt), jeff's source at the images' commit, and the weights at
  the images' commit. Each model gets a random key at install, kept in .runtime\<model>\api-key,
  and answers only a call that carries it.

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
# KeyVar: the variable each server reads its key from (laya 0.3.11 laya/serve.py, von-sdk 1.1.1
# von/server.py, jeff src/jeff/server/config.py). Repo and Revision: the weights, at the commit the
# Docker images download (docker\<model>\Dockerfile).
$Providers = @{
  laya = @{ Port = 8801; Model = 'multilingual';       KeyVar = 'LAYA_API_KEY'
            Repo = 'convaiinnovations/laya';          Revision = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851' }
  von  = @{ Port = 8802; Model = 'von-1.1.0';          KeyVar = 'VON_API_KEY'
            Repo = 'wfzyx/von';                       Revision = 'd8bb5e0745d8ee1fb65d536d6d4892d54d5a93fd' }
  jeff = @{ Port = 8803; Model = 'gliformer-large-v1'; KeyVar = 'JEFF_API_KEYS'
            Repo = 'knowledgator/gliformer-large-v1'; Revision = 'd0a4e53d09cebe6bc963dd9be319d4279084bb2d' }
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
  Invoke-Native "[$name] pip upgrade" { & (Venv-Python $name) -m pip install --quiet pip==26.2.1 }
}

# The model's Docker lock with the versions only, as pip constraints: pip then installs the same
# version of every package the Linux image carries. torch among them is the CUDA build the lock
# names (torch==2.11.0+cu128), which pip finds on PyTorch's index; PyPI's torch for Windows is
# CPU-only. The hashes stay out: pip reads one hash in a constraints file as hash checking for
# every package, and Windows needs one the Linux lock never names (colorama, for click and tqdm).
function New-Constraints([string]$name) {
  $lock = Join-Path $PSScriptRoot "docker\$name\requirements-cu128.txt"
  $out = Join-Path $Root "$name\constraints.txt"
  Get-Content $lock | Where-Object { $_ -match '^[A-Za-z0-9][A-Za-z0-9._-]*==\S+' } |
    ForEach-Object { ($_ -split '\s+')[0] } | Set-Content -Path $out -Encoding ascii
  return $out
}

# The weights at the commit the images download. laya and von ask the cache for the default branch
# by name and run with the hub off (Start-Provider), so that name is pointed at the pinned commit:
# a download by commit writes no branch name. jeff reads its weights from a folder of their own.
function Save-Weights([string]$name) {
  $p = $Providers[$name]
  $env:HF_HOME = Join-Path $Root "$name\hf"
  if ($name -eq 'jeff') {
    Write-Host "[jeff] downloading GLiFormer at commit $($p.Revision.Substring(0, 12)) (about 1.5 GB)"
    # huggingface_hub 1.x has no `commands.huggingface_cli` module (and no [cli] extra), so the
    # download goes through the library call rather than the old CLI module (2026-09-23).
    $models = Join-Path $Root 'jeff\models\gliformer-large-v1'
    $dl = "from huggingface_hub import snapshot_download; rev = '$($p.Revision)'; snapshot_download('$($p.Repo)', revision=rev, local_dir=r'$models')"
  } else {
    Write-Host "[$name] downloading the weights at commit $($p.Revision.Substring(0, 12))"
    $dl = "import pathlib; from huggingface_hub import snapshot_download; rev = '$($p.Revision)'; p = pathlib.Path(snapshot_download('$($p.Repo)', revision=rev)); (p.parents[1] / 'refs').mkdir(exist_ok=True); (p.parents[1] / 'refs' / 'main').write_text(rev)"
  }
  Invoke-Native "[$name] weights" { & (Venv-Python $name) -c $dl }
}

# A random key per model, made once and kept beside its weights. The server gets it at start, smoke
# sends it, and the node sends it too (README.md, Connecting a node).
function Key-File([string]$name) { Join-Path $Root "$name\api-key" }

function New-Key([string]$name) {
  $file = Key-File $name
  if (Test-Path $file) { return }
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  Set-Content -Path $file -Value (-join ($bytes | ForEach-Object { $_.ToString('x2') })) -NoNewline -Encoding ascii
}

function Get-Key([string]$name) {
  $file = Key-File $name
  if (-not (Test-Path $file)) { throw "[$name] has no key yet. Run: .\systemone.ps1 install $name" }
  return (Get-Content $file -Raw).Trim()
}

# ── install ───────────────────────────────────────────────────────────────────────────────────

function Install-Provider([string]$name) {
  New-Dirs $name
  New-Venv $name
  $py = Venv-Python $name
  $c = New-Constraints $name
  switch ($name) {
    'laya' {
      Write-Host '[laya] installing laya[serve] 0.3.11'
      Invoke-Native '[laya] pip' { & $py -m pip install --constraint $c --extra-index-url https://download.pytorch.org/whl/cu128 'laya[serve]==0.3.11' }
    }
    'von' {
      # von-sdk 1.1.1 carries the server (`von serve`), as in the image.
      Write-Host '[von] installing von-sdk 1.1.1'
      Invoke-Native '[von] pip' { & $py -m pip install --constraint $c --extra-index-url https://download.pytorch.org/whl/cu128 'von-sdk==1.1.1' }
    }
    'jeff' {
      $src = Join-Path $Root 'jeff\src'
      if (-not (Test-Path $src)) {
        Write-Host '[jeff] cloning the repository'
        Invoke-Native '[jeff] clone' { git clone --quiet https://github.com/logan-markewich/jeff $src }
      }
      # The commit the image builds from (docker\jeff\Dockerfile), fetched by name in case an older
      # shallow clone lacks it. jeff runs from this source, as in the image, so pip installs its
      # dependencies (its pyproject.toml at this commit) and not jeff itself.
      Invoke-Native '[jeff] fetch' { git -C $src fetch --quiet origin 34b32f99a727c47b679adde33f4702a001e02979 }
      Invoke-Native '[jeff] checkout' { git -C $src checkout --quiet 34b32f99a727c47b679adde33f4702a001e02979 }
      Write-Host '[jeff] installing its dependencies'
      Invoke-Native '[jeff] pip' { & $py -m pip install --constraint $c --extra-index-url https://download.pytorch.org/whl/cu128 'gliformer==0.1.2' 'fastapi==0.141.1' 'uvicorn[standard]==0.53.0' 'pydantic==2.13.5' 'httpx==0.28.1' 'huggingface-hub==1.32.0' 'modal==1.5.5' }
    }
  }
  Save-Weights $name
  New-Key $name
  Write-Host "[$name] installed. Its key is in $(Key-File $name); the node sends the same value (README.md, Connecting a node)."
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
    # The weights were fetched at a fixed commit at install. The hub stays off, as in the images,
    # so a start never fetches newer ones.
    HF_HUB_OFFLINE = '1'
    # 127.0.0.1 on purpose: these answer the node on this machine and nothing else.
    LAYA_HOST = '127.0.0.1'; LAYA_PORT = "$port"; LAYA_DEVICE = 'cuda'; LAYA_PRELOAD = '1'
    JEFF_HOST = '127.0.0.1'; JEFF_PORT = "$port"
    JEFF_MODEL = (Join-Path $Root 'jeff\models\gliformer-large-v1')
  }
  $envs[$Providers[$name].KeyVar] = Get-Key $name

  $exe, $exeArgs = switch ($name) {
    'laya' { (Join-Path $bin 'laya-serve.exe'), @() }
    'von'  { (Join-Path $bin 'von.exe'), @('serve', '--host', '127.0.0.1', '--port', "$port") }
    # jeff runs from its source, as in the image: python -m jeff.server.main.
    'jeff' { $py, @('-m', 'jeff.server.main') }
  }
  if (-not (Test-Path $exe)) { throw "[$name] has no server command at $exe. Re-run: .\systemone.ps1 install $name" }
  if ($name -eq 'jeff') {
    $envs['PYTHONPATH'] = Join-Path $Root 'jeff\src\src'
    if (-not (Test-Path (Join-Path $envs['PYTHONPATH'] 'jeff\server\main.py'))) { throw "[jeff] has no source at $($envs['PYTHONPATH']). Re-run: .\systemone.ps1 install jeff" }
  }

  # The variables reach the server's process only. The old values come back once it has started,
  # so the shell that ran this keeps neither the key nor the offline switch.
  $saved = @{}
  foreach ($k in $envs.Keys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
    [Environment]::SetEnvironmentVariable($k, $envs[$k], 'Process')
  }
  $log = Log-File $name
  Write-Host "[$name] starting on 127.0.0.1:$port (log: $log)"
  try {
    $p = Start-Process -FilePath $exe -ArgumentList $exeArgs -RedirectStandardOutput $log `
          -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
  }
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
  $headers = @{ 'Content-Type' = 'application/json'; 'Authorization' = "Bearer $(Get-Key $name)" }
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
