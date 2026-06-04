param(
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $RootDir "installer\windows\assets"
$readmeHeader = Join-Path $RootDir "docs\assets\readme-header.png"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

function New-Canvas([int]$Width, [int]$Height) {
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return @($bmp, $g)
}

function New-LinearBrush($rect, [string]$from, [string]$to, [float]$angle = 45) {
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.ColorTranslator]::FromHtml($from)), ([System.Drawing.ColorTranslator]::FromHtml($to)), $angle
}

function Add-RoundedRectangle($path, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
}

function New-IolaPng([int]$size, [string]$path) {
  $canvas = New-Canvas $size $size
  $bmp = $canvas[0]
  $g = $canvas[1]
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $g.Clear([System.Drawing.Color]::Transparent)

  $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectangle $bgPath 8 8 ($size - 16) ($size - 16) ([Math]::Max(18, $size * 0.18))
  $bgBrush = New-LinearBrush $rect "#0B1220" "#0F8B8D" 35
  $g.FillPath($bgBrush, $bgPath)

  $glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
  $g.FillEllipse($glowBrush, [int]($size * 0.57), [int]($size * 0.08), [int]($size * 0.34), [int]($size * 0.34))

  $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 255, 255, 255)), ([Math]::Max(3, $size * 0.035))
  $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($ringPen, [int]($size * 0.20), [int]($size * 0.20), [int]($size * 0.60), [int]($size * 0.60), 210, 310)

  $accentPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#F4C542")), ([Math]::Max(3, $size * 0.035))
  $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($accentPen, [int]($size * 0.20), [int]($size * 0.20), [int]($size * 0.60), [int]($size * 0.60), 308, 84)

  $fontSize = [Math]::Max(22, $size * 0.34)
  $font = New-Object System.Drawing.Font "Segoe UI Variable Display", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $text = "I"
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.DrawString($text, $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $format)

  $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#F4C542"))
  $dot = [Math]::Max(8, $size * 0.11)
  $g.FillEllipse($dotBrush, [int](($size - $dot) / 2), [int]($size * 0.24), [int]$dot, [int]$dot)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Write-IcoFromPngs([string[]]$pngFiles, [string]$icoPath) {
  $images = foreach ($file in $pngFiles) { [System.IO.File]::ReadAllBytes($file) }
  $fs = [System.IO.File]::Create($icoPath)
  try {
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    for ($i = 0; $i -lt $images.Count; $i++) {
      $size = [int][System.IO.Path]::GetFileNameWithoutExtension($pngFiles[$i])
      $bw.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
      $bw.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
      $bw.Write([byte]0)
      $bw.Write([byte]0)
      $bw.Write([UInt16]1)
      $bw.Write([UInt16]32)
      $bw.Write([UInt32]$images[$i].Length)
      $bw.Write([UInt32]$offset)
      $offset += $images[$i].Length
    }
    foreach ($image in $images) {
      $bw.Write($image)
    }
  } finally {
    $fs.Dispose()
  }
}

function New-WizardLarge([string]$path) {
  $w = 164
  $h = 314
  $canvas = New-Canvas $w $h
  $bmp = $canvas[0]
  $g = $canvas[1]
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $g.FillRectangle((New-LinearBrush $rect "#07111F" "#0F8B8D" 35), $rect)

  if (Test-Path $readmeHeader) {
    $header = [System.Drawing.Image]::FromFile($readmeHeader)
    try {
      $cropW = [Math]::Min($header.Width, [int]($header.Height * $w / $h))
      $crop = New-Object System.Drawing.Rectangle ([int](($header.Width - $cropW) / 2)), 0, $cropW, $header.Height
      $g.DrawImage($header, $rect, $crop, [System.Drawing.GraphicsUnit]::Pixel)
      $overlay = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(125, 7, 17, 31))
      $g.FillRectangle($overlay, $rect)
    } finally {
      $header.Dispose()
    }
  }

  $logoPng = Join-Path $assetsDir "iola-256.png"
  if (Test-Path $logoPng) {
    $logo = [System.Drawing.Image]::FromFile($logoPng)
    try {
      $g.DrawImage($logo, 38, 34, 88, 88)
    } finally {
      $logo.Dispose()
    }
  }

  $font = New-Object System.Drawing.Font "Segoe UI", 20, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $small = New-Object System.Drawing.Font "Segoe UI", 10, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 226, 232, 240))
  $g.DrawString("IOLA", $font, $white, 24, 154)
  $g.DrawString("городской`nAI-агент", $small, $muted, 26, 188)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $g.Dispose()
  $bmp.Dispose()
}

function New-WizardSmall([string]$path) {
  $canvas = New-Canvas 55 55
  $bmp = $canvas[0]
  $g = $canvas[1]
  $g.Clear([System.Drawing.Color]::White)
  $logoPng = Join-Path $assetsDir "iola-256.png"
  $logo = [System.Drawing.Image]::FromFile($logoPng)
  try {
    $g.DrawImage($logo, 4, 4, 47, 47)
  } finally {
    $logo.Dispose()
  }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $g.Dispose()
  $bmp.Dispose()
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngFiles = @()
foreach ($size in $sizes) {
  $file = Join-Path $assetsDir "$size.png"
  New-IolaPng $size $file
  $pngFiles += $file
}
Copy-Item (Join-Path $assetsDir "256.png") (Join-Path $assetsDir "iola-256.png") -Force
Write-IcoFromPngs $pngFiles (Join-Path $assetsDir "iola.ico")
New-WizardLarge (Join-Path $assetsDir "wizard-large.bmp")
New-WizardSmall (Join-Path $assetsDir "wizard-small.bmp")

foreach ($file in $pngFiles) {
  Remove-Item $file -Force
}

Write-Host "Installer assets generated: $assetsDir"
