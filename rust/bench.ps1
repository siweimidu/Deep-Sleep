# Runs one per-crate benchmark with everything it needs preloaded.
#
# Three things bit us, so they are baked in here instead of being re-derived per bench file:
#   --experimental-transform-types  Node's strip-only mode rejects the constructor parameter
#                                   property in src/services/chat/history/errors.ts, which the
#                                   history crates all reach transitively.
#   rust/record-shim.mjs            src/app/android.ts reads `window` and src/services/api/client.ts
#                                   reads the rspack-injected __API_ORIGIN__ at module scope.
#   rust/register-ts.mjs            resolves the app's `./x.js` specifiers to the `./x.ts` on disk.
#
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File rust/bench.ps1 -Name schema
param([Parameter(Mandatory = $true)][string]$Name)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$script = Join-Path $repo "rust\bench\$Name.mjs"
if (-not (Test-Path $script)) { throw "no such bench: rust\bench\$Name.mjs" }

node --experimental-transform-types `
  --import ./rust/record-shim.mjs `
  --import ./rust/register-ts.mjs `
  $script
exit $LASTEXITCODE
