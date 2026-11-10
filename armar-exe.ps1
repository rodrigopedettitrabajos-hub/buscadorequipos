# Builds dist\BuscadorEquipos.exe (a single file, no install needed).
# Publish it so the "Actualizar" button picks it up:  .\armar-exe.ps1 -Publicar
param([switch]$Publicar)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force build, dist | Out-Null
npx.cmd --yes esbuild@0.25.0 server.js --bundle --platform=node --outfile=build/app.js --log-level=warning
if ($LASTEXITCODE) { throw 'esbuild falló' }
node --build-sea sea-config.json
if ($LASTEXITCODE) { throw 'build-sea falló' }
Write-Host 'Listo: dist\BuscadorEquipos.exe'
if ($Publicar) {
  $tag = 'v' + (Get-Date -Format 'yyyy.MM.dd-HHmm')
  gh release create $tag dist\BuscadorEquipos.exe --title $tag --notes 'Nueva versión'
}
