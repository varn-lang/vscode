<#
.SYNOPSIS
    Empaqueta y reinstala la extensión Varn Language Support.

.DESCRIPTION
    Dos problemas de entorno que este script evita:

    1. El bundle se compila con rollup (`pnpm build`: rollup + `vsce
       package --no-dependencies`). El entry `dist/extension.js` ya lleva
       empaquetado `vscode-languageclient`, así el .vsix no necesita
       `node_modules` y se evita el `npm list` de vsce, que truena con
       el layout de pnpm.

    2. VS Code bloquea el folder de una extensión ACTIVA: `code
       --install-extension` truena con EPERM tras ~1000 reintentos si la
       extensión está corriendo en cualquier ventana abierta. Antes de
       intentar instalar, este script comprueba si hay procesos `Code.exe`
       vivos y para con un mensaje claro en vez de dejar que el usuario lea
       una pared de reintentos.

    Verifica al final que el hash de `src/manager.js` instalado coincida con
    el del repo — la única forma confiable de saber que la instalación
    realmente tomó, en vez de confiar en el exit code de `code` (que puede
    reportar éxito con un fallo real en el log, como pasó en esta sesión).

.EXAMPLE
    .\scripts\reinstall.ps1
#>

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$openCode = Get-Process -Name "Code" -ErrorAction SilentlyContinue
if ($openCode) {
    Write-Host "VS Code está abierto ($($openCode.Count) proceso(s) Code.exe)." -ForegroundColor Yellow
    Write-Host "Cierra TODAS las ventanas antes de reinstalar — un folder de extensión activo no se puede reemplazar." -ForegroundColor Yellow
    exit 1
}

Write-Host "Empaquetando (pnpm build: rollup + vsce)..." -ForegroundColor Cyan
& pnpm build
if ($LASTEXITCODE -ne 0) {
    throw "pnpm build falló (exit $LASTEXITCODE)"
}

$vsixName = (Get-Content package.json | ConvertFrom-Json).name
$version = (Get-Content package.json | ConvertFrom-Json).version
$vsixPath = Join-Path $repoRoot "$vsixName-$version.vsix"

if (-not (Test-Path $vsixPath)) {
    throw "No se encontró el .vsix esperado: $vsixPath"
}

Write-Host "Instalando $vsixPath..." -ForegroundColor Cyan
& code --install-extension $vsixPath --force
if ($LASTEXITCODE -ne 0) {
    throw "code --install-extension falló (exit $LASTEXITCODE)"
}

$installedDir = Join-Path $env:USERPROFILE ".vscode\extensions\varn.$vsixName-$version"
$installedFile = Join-Path $installedDir "src\manager.js"
$sourceFile = Join-Path $repoRoot "src\manager.js"

if ((Test-Path $installedFile) -and (Test-Path $sourceFile)) {
    $installedHash = (Get-FileHash $installedFile -Algorithm SHA256).Hash
    $sourceHash = (Get-FileHash $sourceFile -Algorithm SHA256).Hash
    if ($installedHash -eq $sourceHash) {
        Write-Host "Verificado: instalado coincide con el repo (sha256 $($sourceHash.Substring(0,12))...)." -ForegroundColor Green
    } else {
        Write-Host "ADVERTENCIA: el hash instalado NO coincide con el repo. La instalación pudo fallar en silencio." -ForegroundColor Red
        Write-Host "  instalado: $installedHash" -ForegroundColor Red
        Write-Host "  repo:      $sourceHash" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "No se pudo verificar por hash (rutas no encontradas) — revisa manualmente." -ForegroundColor Yellow
}
