param(
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "generate-assets.ps1") -RootDir $RootDir

$packageJsonPath = Join-Path $RootDir "package.json"
if (Test-Path $packageJsonPath) {
  $packageJson = Get-Content -Raw -Encoding UTF8 $packageJsonPath | ConvertFrom-Json
  $env:IOLA_INSTALLER_VERSION = [string]$packageJson.version
}

$payloadDir = Join-Path $RootDir "installer\windows\payload"
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
Get-ChildItem -Path $payloadDir -Filter "*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force
$packOutput = & npm pack --pack-destination $payloadDir --silent
if ($LASTEXITCODE -ne 0) {
  throw "npm pack failed."
}
$packedFile = $packOutput | Select-Object -Last 1
if (-not $packedFile) {
  $packedFile = Get-ChildItem -Path $payloadDir -Filter "*.tgz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty Name
}
$packedPath = if ([System.IO.Path]::IsPathRooted($packedFile)) { $packedFile } else { Join-Path $payloadDir $packedFile }
Move-Item -LiteralPath $packedPath -Destination (Join-Path $payloadDir "iola-cli.tgz") -Force

$isccCommand = Get-Command iscc -ErrorAction SilentlyContinue
$isccPath = if ($isccCommand) { $isccCommand.Source } else { $null }
if (-not $isccPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
  )
  $isccPath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $isccPath) {
  throw "Inno Setup Compiler was not found. Install Inno Setup 6: https://jrsoftware.org/isdl.php"
}

$iss = Join-Path $RootDir "installer\windows\iola-cli.iss"
& $isccPath $iss
if ($LASTEXITCODE -ne 0) {
  throw "Сборка установщика завершилась с ошибкой."
}
