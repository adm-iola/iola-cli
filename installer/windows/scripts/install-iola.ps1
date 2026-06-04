param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$ProfileDir,
  [string]$PackageArchive = "",
  [string]$PackageVersion = "latest"
)

$ErrorActionPreference = "Stop"

$RuntimeDir = Join-Path $InstallDir "runtime"
$LauncherPath = Join-Path $InstallDir "IOLA.cmd"
$ProfileEnvPath = Join-Path $InstallDir "profile.env"
$LogPath = Join-Path $InstallDir "install.log"

New-Item -ItemType Directory -Force -Path $InstallDir, $RuntimeDir, $ProfileDir | Out-Null

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Get-NodeVersion {
  try {
    $raw = (& node --version 2>$null)
    if (-not $raw) { return $null }
    return [version]($raw.TrimStart("v"))
  } catch {
    return $null
  }
}

function Test-NodeVersion {
  $version = Get-NodeVersion
  return $version -and $version -ge [version]"22.5.0"
}

function Install-NodeWithWinget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { return $false }
  Write-Log "Installing Node.js via winget"
  & winget install --id OpenJS.NodeJS --source winget --accept-package-agreements --accept-source-agreements --silent | Out-File -Append -Encoding UTF8 $LogPath
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  return (Test-NodeVersion)
}

Write-Log "IOLA installer started"
Write-Log "InstallDir=$InstallDir"
Write-Log "ProfileDir=$ProfileDir"

if (-not (Test-NodeVersion)) {
  if (-not (Install-NodeWithWinget)) {
    throw "Node.js 22.5.0 или новее не найден. Установите Node.js с https://nodejs.org/ и запустите установщик IOLA еще раз."
  }
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  throw "npm не найден после проверки Node.js."
}

$env:IOLA_HOME = $ProfileDir
$installTarget = if ($PackageArchive -and (Test-Path $PackageArchive)) {
  $PackageArchive
} else {
  "@iola_adm/iola-cli@$PackageVersion"
}
Write-Log "Installing $installTarget"
& npm install --prefix $RuntimeDir $installTarget --omit=dev --no-audit --fund=false | Out-File -Append -Encoding UTF8 $LogPath
if ($LASTEXITCODE -ne 0) {
  throw "npm install завершился с ошибкой. Подробности: $LogPath"
}

Set-Content -Path $ProfileEnvPath -Value @(
  "IOLA_HOME=$ProfileDir"
) -Encoding UTF8

$cliEntry = Join-Path $RuntimeDir "node_modules\@iola_adm\iola-cli\bin\iola.js"
$launcher = @"
@echo off
setlocal
set "IOLA_HOME=$ProfileDir"
set "IOLA_INSTALL_DIR=$InstallDir"
node "$cliEntry" %*
endlocal
"@
Set-Content -Path $LauncherPath -Value $launcher -Encoding ASCII

Write-Log "IOLA installer completed"
