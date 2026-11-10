# Builds dist\BuscadorEquipos.zip: app + node.exe, runs on any Windows PC with no install.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'dist\BuscadorEquipos'
Remove-Item (Join-Path $root 'dist') -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root 'server.js'), (Join-Path $root 'db.js'), (Join-Path $root '.env'), (Join-Path $root 'Iniciar.bat'), (Join-Path $root 'package.json') $out
Copy-Item (Join-Path $root 'public'), (Join-Path $root 'node_modules') $out -Recurse
Copy-Item (Get-Command node).Source $out
Compress-Archive (Join-Path $out '*') (Join-Path $root 'dist\BuscadorEquipos.zip')
Write-Host "Listo: dist\BuscadorEquipos.zip"
