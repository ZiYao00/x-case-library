$ErrorActionPreference = "Stop"

if ($env:XACTIONS_ALLOW_ACCOUNT_SESSION -ne "1") {
    throw "Account-session fallback is locked. Guest-only collection is the default. Set XACTIONS_ALLOW_ACCOUNT_SESSION=1 only after explicit approval."
}

Write-Host "XActions 4.0.1 - local session connect (explicit fallback only)"
Write-Host "A separate Chrome window will open. Log in to X normally."
Write-Host "The official XActions connect flow stores auth_token + ct0 only under ~/.xactions/."

npx.cmd -y xactions@4.0.1 connect -t 5

if ($LASTEXITCODE -ne 0) {
    throw "XActions connect failed. Do not retry automatically; inspect the failure first."
}

Write-Host "Connect finished. Do not print or copy cookies into this project."
