param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"

Write-Host "X case collection: Guest-only / original-author-only / no automatic retry"
Write-Host "This command does not load or use your X account cookies."

$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
    throw "Node.js executable not found at $node."
}

& $node "config/collect-author-case.mjs" $Url

if ($LASTEXITCODE -ne 0) {
    throw "Collection failed. Safety policy forbids automatic retry. Inspect notes/x/00-待整理/<tweet-id>/failure.json first."
}
