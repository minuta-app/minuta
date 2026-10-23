# Instala (o actualiza) Minuta en Windows con un solo comando (PowerShell):
#   irm https://raw.githubusercontent.com/minuta-app/minuta/main/instalar.ps1 | iex
# Baja la última versión publicada en GitHub, verifica su huella SHA-256 y la instala solo para tu usuario
# (sin permisos de administrador). Tus datos quedan en tu carpeta minuta y nunca se tocan.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'minuta-app/minuta'
function Falla($m) { Write-Host "x $m" -ForegroundColor Red; exit 1 }

if (-not [Environment]::Is64BitOperatingSystem) { Falla 'Minuta necesita Windows de 64 bits.' }
Write-Host 'Buscando la última versión de Minuta…'
try { $rel = Invoke-RestMethod -Headers @{ Accept = 'application/vnd.github+json' } "https://api.github.com/repos/$repo/releases/latest" } catch { Falla 'No pude consultar GitHub.' }
$tag = $rel.tag_name
if (-not $tag) { Falla 'No encontré una versión publicada.' }
$base = "https://github.com/$repo/releases/download/$tag"
$tmp = Join-Path $env:TEMP 'minuta-instalar'
New-Item -ItemType Directory -Force $tmp | Out-Null
$exe = Join-Path $tmp 'Minuta-Windows.exe'
Write-Host "Descargando Minuta $tag…"
try {
  Invoke-WebRequest "$base/Minuta-Windows.exe" -OutFile $exe -UseBasicParsing
  Invoke-WebRequest "$base/Minuta-Windows.exe.sha256" -OutFile "$exe.sha256" -UseBasicParsing
} catch { Falla 'Esta versión aún no tiene descarga para Windows.' }
$esperado = ((Get-Content "$exe.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
$real = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($real -ne $esperado) { Remove-Item $exe -Force; Falla 'La descarga no coincide con su huella. No instalé nada.' }
Write-Host 'v Descarga verificada' -ForegroundColor Green

# Instalador silencioso (por usuario); --force-run abre Minuta al terminar.
Start-Process -FilePath $exe -ArgumentList '/S', '--force-run' -Wait
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "v Minuta $tag instalada. Se abrió el asistente de bienvenida." -ForegroundColor Green
