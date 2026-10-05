param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"

Write-Host "X case collection: Guest-only / original-author-only / no automatic retry"
Write-Host "This command does not load or use your X account cookies."

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $node = $nodeCommand.Path
} else {
    $fallbackNode = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $fallbackNode)) {
        throw "Node.js executable not found. Install Node.js or make 'node' available on PATH."
    }
    $node = $fallbackNode
}

$collector = Join-Path $PSScriptRoot "collect-author-case.mjs"

& $node $collector $Url

if ($LASTEXITCODE -ne 0) {
    throw "Collection failed. Safety policy forbids automatic retry. Inspect notes/x/00-待整理/<tweet-id>/failure.json first."
}
