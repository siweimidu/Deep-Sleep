# Runs every proof this repo makes about the Rust port, and fails if any of them fails.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File rust/verify-all.ps1
#
# Four independent layers:
#   1. gate      — per crate: fmt, clippy -D warnings, cargo test, build, api, behavior (Node glue)
#   2. web-parity — the same recorded corpus replayed against the --target web artifact that ships
#   3. adapter-check — the app's own adapter modules, end to end
#   4. bench     — the boundary-cost numbers behind the "wire only bytes-in" rule (reported, not gated)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$failed = @()

$crates = Get-ChildItem (Join-Path $repo 'rust') -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'rust-anything.json') } |
  Sort-Object Name

Write-Output "=== 1. gate: $($crates.Count) crates ==="
$gated = 0
foreach ($crate in $crates) {
  $output = rust-anything gate "rust/$($crate.Name)" 2>&1
  $behavior = ($output | Select-String -Pattern 'behavior' | Select-Object -First 1).Line
  if ($output | Select-String -Pattern 'Gate passed\.') { $gated += 1 }
  else { $failed += "gate $($crate.Name)" }
  '{0,-17} {1}' -f $crate.Name, (($behavior -replace '\s+', ' ').Trim())
}
Write-Output "  gated $gated/$($crates.Count)"

# 1b. Hand-written crates (no rust-anything.json): cargo test + value-for-value parity with TS.
# CARGO_TARGET_DIR must live on an ASCII path: this repo path has CJK characters and MinGW's
# ld fails to read its own .o files there.
Write-Output ''
Write-Output '=== 1b. hand-written crates ==='
$asciiTarget = Join-Path $env:TEMP 'dsh-cargo-target'
$env:CARGO_TARGET_DIR = $asciiTarget
$manual = @(
  @{ name = 'call-rs'; parity = 'scripts/test-call-core.mjs' }
)
foreach ($item in $manual) {
  Push-Location (Join-Path $repo "rust/$($item.name)")
  $test = & cargo test --quiet 2>&1
  $testOk = ($LASTEXITCODE -eq 0)
  Pop-Location
  if (-not $testOk) { $failed += "test $($item.name)" }
  $parity = & node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs $item.parity 2>&1
  $parityOk = ($LASTEXITCODE -eq 0)
  if (-not $parityOk) { $failed += "parity $($item.name)" }
  $cases = ($test | Select-String -Pattern '(\d+) passed' | Select-Object -First 1).Matches.Groups[1].Value
  $pairs = ($parity | Select-String -Pattern 'PARITY (\d+) cases' | Select-Object -First 1).Matches.Groups[1].Value
  '{0,-17} cargo test {1} passed, TS parity {2} cases' -f $item.name, $cases, $pairs
}

Write-Output ''
Write-Output '=== 2. browser artifact parity ==='
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'rust/web-parity.ps1') 2>$null
if ($LASTEXITCODE -ne 0) { $failed += 'web-parity' }

Write-Output ''
Write-Output '=== 3. app adapters ==='
node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs (Join-Path $repo 'rust/adapter-check.mjs')
if ($LASTEXITCODE -ne 0) { $failed += 'adapter-check' }

Write-Output ''
Write-Output '=== 4. boundary cost (reported, not gated) ==='
node (Join-Path $repo 'rust/bench-boundary.mjs') 2>$null | Select-Object -First 3

Write-Output ''
if ($failed.Count -gt 0) {
  Write-Output "FAILED: $($failed -join ', ')"
  exit 1
}
Write-Output "ALL GREEN: $gated crates gated, browser artifact + adapters verified."
exit 0
