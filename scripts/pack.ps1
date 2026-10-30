$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$outputPath = Join-Path $projectRoot 'WakuDownload-extension.zip'
Compress-Archive -Path (Join-Path $extensionPath '*') -DestinationPath $outputPath -Force
Write-Output "Created $outputPath"
