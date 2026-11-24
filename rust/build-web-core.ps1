# Builds one ported crate for the browser and drops the artifact where the app imports it.
#
# `rust-anything build` emits Node-target glue (it reads the .wasm with require('fs')), which a
# WebView cannot use. The app needs `--target web`, generated here from the same Rust source.
#
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate paths-rs
param(
  [Parameter(Mandatory = $true)][string]$Crate,
  [string]$OutDir
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repo 'src\rust-core\pkg' }

$manifest = Get-Content (Join-Path $repo "rust\$Crate\Cargo.toml") -Raw
$name = [regex]::Match($manifest, '^name = "([^"]+)"', 'Multiline').Groups[1].Value
$snake = $name -replace '-', '_'

# mingw ld cannot handle this repo's non-ASCII path, so the target dir lives on an ASCII path.
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'rustb'
cargo build --manifest-path (Join-Path $repo "rust\$Crate\Cargo.toml") --target wasm32-unknown-unknown --release
if ($LASTEXITCODE -ne 0) { throw "cargo build failed for $Crate" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
wasm-bindgen (Join-Path $env:CARGO_TARGET_DIR "wasm32-unknown-unknown\release\$snake.wasm") --target web --out-dir $OutDir
if ($LASTEXITCODE -ne 0) { throw "wasm-bindgen failed for $Crate" }

Get-ChildItem $OutDir | Where-Object { $_.Name -like "$snake*" } | ForEach-Object { "  {0} {1}" -f $_.Name, $_.Length }
