# Replays every crate's recorded corpus against the **browser** artifact that would actually ship
# into the Android WebView (`wasm-bindgen --target web`), not just the Node glue that
# `rust-anything diff` uses.
#
# The two targets are not drop-in equivalent: a `serde_json::Value` return comes back as raw JSON
# text from the web glue. rust/web-parity.mjs reads the conversion metadata out of the crate's
# generated Node glue and applies the same decode the adapter must apply.
#
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File rust/web-parity.ps1
#
# `Continue`, not `Stop`: cargo and wasm-bindgen write progress to stderr, and under `Stop`
# Windows PowerShell turns that into a terminating NativeCommandError. Exit codes are checked
# explicitly instead.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
# mingw ld cannot handle this repo's non-ASCII path, so the target dir lives on an ASCII path.
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'rustb'

$exit = 0
foreach ($dir in Get-ChildItem (Join-Path $repo 'rust') -Directory) {
  if (-not (Test-Path (Join-Path $dir.FullName 'rust-anything.json'))) { continue }

  $manifest = Get-Content (Join-Path $dir.FullName 'Cargo.toml') -Raw
  $crate = [regex]::Match($manifest, '^name = "([^"]+)"', 'Multiline').Groups[1].Value
  $snake = $crate -replace '-', '_'

  cargo build --manifest-path (Join-Path $dir.FullName 'Cargo.toml') --target wasm32-unknown-unknown --release 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { "{0,-17} BUILD FAILED" -f $dir.Name; $exit = 1; continue }

  $raw = Join-Path $env:CARGO_TARGET_DIR "wasm32-unknown-unknown\release\$snake.wasm"
  $web = Join-Path $env:TEMP "web-$($dir.Name)"
  if (Test-Path $web) { Remove-Item $web -Recurse -Force }
  wasm-bindgen $raw --target web --out-dir $web 2>&1 | Out-Null

  $result = node (Join-Path $repo 'rust\web-parity.mjs') `
    (Join-Path $web "$snake.js") (Join-Path $web "${snake}_bg.wasm") `
    (Join-Path $dir.FullName 'cases.jsonl') (Join-Path $dir.FullName 'index.cjs') 2>&1
  if ($LASTEXITCODE -ne 0) { $exit = 1 }
  # Keep the readable line: node prints a stack header first and the real message second.
  # Do NOT strip on '/' here — that silently ate the numerator of "911/1092".
  $shown = ($result | Where-Object { $_ -match 'match on the --target web|Error|error|Err' } |
    Select-Object -First 1)
  if (-not $shown) { $shown = ($result | Select-Object -Last 1) }
  "{0,-17} {1}" -f $dir.Name, ($shown.Trim())
}

exit $exit
