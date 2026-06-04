param(
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

& (Join-Path $RootDir "installer\windows\scripts\generate-assets.ps1") -RootDir $RootDir

$packageJson = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "package.json") | ConvertFrom-Json
$version = [string]$packageJson.version

$payloadDir = Join-Path $RootDir "installer\windows\payload"
$buildDir = Join-Path $RootDir "installer\windows\premium\build"
$distDir = Join-Path $RootDir "installer\windows\dist"
New-Item -ItemType Directory -Force -Path $payloadDir,$buildDir,$distDir | Out-Null
Get-ChildItem -Path $payloadDir -Filter "*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force

$packOutput = & npm pack --pack-destination $payloadDir --silent
if ($LASTEXITCODE -ne 0) { throw "npm pack failed." }
$packedFile = $packOutput | Select-Object -Last 1
if (-not $packedFile) {
  $packedFile = Get-ChildItem -Path $payloadDir -Filter "*.tgz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty Name
}
$packedPath = if ([IO.Path]::IsPathRooted($packedFile)) { $packedFile } else { Join-Path $payloadDir $packedFile }
$payloadPath = Join-Path $payloadDir "iola-cli.tgz"
Move-Item -LiteralPath $packedPath -Destination $payloadPath -Force

$templatePath = Join-Path $RootDir "installer\windows\premium\IOLAInstaller.template.ps1"
$generatedPath = Join-Path $buildDir "IOLAInstaller.generated.ps1"
$template = Get-Content -Raw -Encoding UTF8 $templatePath
$template = $template.Replace("__APP_VERSION__", $version)
$template = $template.Replace("__PAYLOAD_BASE64__", [Convert]::ToBase64String([IO.File]::ReadAllBytes($payloadPath)))
$template = $template.Replace("__BACKGROUND_BASE64__", [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $RootDir "docs\assets\readme-header.png"))))
$template = $template.Replace("__ICON_BASE64__", [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $RootDir "installer\windows\assets\iola.ico"))))
Set-Content -Path $generatedPath -Value $template -Encoding UTF8

if (-not (Get-Module -ListAvailable ps2exe)) {
  Install-Module ps2exe -Scope CurrentUser -Force -AllowClobber
}
Import-Module ps2exe

$outFile = Join-Path $distDir "IOLA-CLI-Premium-Setup-$version.exe"
Invoke-ps2exe `
  -inputFile $generatedPath `
  -outputFile $outFile `
  -iconFile (Join-Path $RootDir "installer\windows\assets\iola.ico") `
  -title "IOLA CLI Setup" `
  -description "Premium Windows installer for IOLA CLI" `
  -company "Yoshkar-Ola Administration" `
  -product "IOLA CLI" `
  -version $version `
  -noConsole `
  -noOutput `
  -requireAdmin:$false

Write-Host "Premium installer built: $outFile"
