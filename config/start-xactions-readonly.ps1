$ErrorActionPreference = "Stop"

if ($env:XACTIONS_ALLOW_ACCOUNT_SESSION -ne "1") {
    throw "Account-session MCP is locked. Use Guest-only config/run-author-case.ps1 by default."
}

$cookiePath = Join-Path $HOME ".xactions\cookies.json"
if (-not (Test-Path $cookiePath)) {
    throw "Missing XActions session: $cookiePath. Run connect-xactions.ps1 first."
}

$cookies = Get-Content $cookiePath -Raw -Encoding utf8 | ConvertFrom-Json
$auth = $cookies | Where-Object { $_.name -eq "auth_token" } | Select-Object -First 1
$csrf = $cookies | Where-Object { $_.name -eq "ct0" } | Select-Object -First 1

if (-not $auth.value -or -not $csrf.value) {
    throw "XActions cookies.json does not contain both auth_token and ct0."
}

$env:XACTIONS_SESSION_COOKIE = $auth.value
$env:XACTIONS_CSRF_TOKEN = $csrf.value
$env:XACTIONS_MCP_TOOLS = "x_get_thread,x_download_media,x_ask"

Write-Host "Starting XActions MCP in strict read-only case-collection mode."
Write-Host "Allowed: x_get_thread, x_download_media, x_ask"
Write-Host "Blocked by omission: replies-all, search, bookmarks, write, DM, automation, monitoring."

npx.cmd -y -p xactions@4.0.1 xactions-mcp --tools "x_get_thread,x_download_media,x_ask"
