# 真机验证外壳：探活 → 拉起应用 → 转发 CDP → 跑给定脚本
# 用法： powershell -File rust\phone-verify.ps1 -NodeScript <绝对路径>
# 设备反复 offline 是 USB 连接的常态，这里每一步都带重试。
param(
    [Parameter(Mandatory = $true)][string]$NodeScript,
    [string]$Serial = '24f539ff',
    [int]$Port = 9222
)

$adb = 'D:\Android\sdk\platform-tools\adb.exe'
$ErrorActionPreference = 'Continue'

function Wait-Device {
    for ($i = 0; $i -lt 8; $i++) {
        $state = ((& $adb -s $Serial get-state 2>&1) -join '').Trim()
        if ($state -eq 'device') { return $true }
        & $adb reconnect offline 2>&1 | Out-Null
        Start-Sleep -Seconds 2
    }
    return $false
}

if (-not (Wait-Device)) { Write-Output 'DEVICE UNREACHABLE'; exit 2 }

# 应用必须在前台，否则 WebView 的 devtools socket 不响应 /json
& $adb -s $Serial shell am start -n com.deep.sleep/.MainActivity 2>&1 | Out-Null

function Get-Socket {
    $line = (& $adb -s $Serial shell "cat /proc/net/unix 2>/dev/null | grep webview_devtools_remote" 2>&1 |
        Select-String -Pattern 'webview_devtools_remote_\d+' | Select-Object -Last 1).Line
    if ($line -match '(webview_devtools_remote_\d+)') { return $matches[1] }
    return $null
}

$socket = $null
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 2
    $socket = Get-Socket
    if ($socket) { break }
}
if (-not $socket) { Write-Output 'NO WEBVIEW SOCKET'; exit 3 }
Write-Output "socket = $socket"

$ok = $false
for ($i = 0; $i -lt 6; $i++) {
    if (-not (Wait-Device)) { Start-Sleep -Seconds 2; continue }
    & $adb -s $Serial forward --remove-all 2>&1 | Out-Null
    & $adb -s $Serial forward ("tcp:$Port") ("localabstract:$socket") 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    $code = (& curl.exe -s --max-time 6 -o NUL -w '%{http_code}' "http://127.0.0.1:$Port/json") 2>&1
    if ("$code" -eq '200') { $ok = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ok) { Write-Output "CDP UNREACHABLE (last code $code)"; exit 4 }

node $NodeScript
exit $LASTEXITCODE
