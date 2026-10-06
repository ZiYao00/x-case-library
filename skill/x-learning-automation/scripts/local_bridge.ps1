$ErrorActionPreference = 'Stop'
$bridgeArgs = @($args)
$skillDir = Split-Path $PSScriptRoot -Parent
$skillItem = Get-Item -LiteralPath $skillDir
$skillSource = if ($skillItem.LinkType -and $skillItem.Target) { [string]$skillItem.Target } else { $skillDir }
$projectRoot = Split-Path (Split-Path $skillSource -Parent) -Parent
$runnerRelative = 'scripts\run-x-case.mjs'
if ($bridgeArgs.Count -gt 0 -and $bridgeArgs[0] -eq 'batch') {
    $runnerRelative = 'scripts\run-x-batch.mjs'
    $bridgeArgs = if ($bridgeArgs.Count -gt 1) { @($bridgeArgs[1..($bridgeArgs.Count - 1)]) } else { @() }
}
$runner = Join-Path $projectRoot $runnerRelative
foreach ($relative in @('AGENTS.md', 'package.json', 'docs\NOTE-SPEC.md', 'scripts\run-x-case.mjs', 'scripts\run-x-batch.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "Project marker missing: $relative" }
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js not found. Configure Node.js before using this Skill.' }
& $node $runner @bridgeArgs
exit $LASTEXITCODE
