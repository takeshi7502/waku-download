$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$manifest = Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$distPath = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $distPath -Force | Out-Null
$outputPath = Join-Path $distPath "WakuDownload-v$($manifest.version).zip"
$packageFiles = @(Get-ChildItem -LiteralPath $extensionPath | Where-Object { $_.Name -ne '_metadata' })
$packageFiles += Get-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'), (Join-Path $projectRoot 'CREDITS.md')
$packageFiles | Compress-Archive -DestinationPath $outputPath -Force
Write-Output "Created $outputPath"
