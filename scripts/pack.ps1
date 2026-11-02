$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$manifest = Get-Content -LiteralPath (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$distPath = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $distPath -Force | Out-Null
$outputPath = Join-Path $distPath "WakuDownload-v$($manifest.version).zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$stream = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -LiteralPath $extensionPath -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]_metadata[\\/]' }
        foreach ($file in $files) {
            $name = $file.FullName.Substring($extensionPath.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        foreach ($name in @('LICENSE', 'CREDITS.md')) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $name), $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Write-Output "Created $outputPath"
