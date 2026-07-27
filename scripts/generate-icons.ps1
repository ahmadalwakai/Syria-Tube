Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'

function New-Canvas([int]$size, [bool]$transparent = $false) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($transparent) {
    $graphics.Clear([System.Drawing.Color]::Transparent)
  } else {
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 8, 11, 16))
  }
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Png($canvas, [string]$path) {
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

function Fill-Background($graphics, [int]$size) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 6, 8, 12),
    [System.Drawing.Color]::FromArgb(255, 26, 31, 38),
    45
  )
  $graphics.FillRectangle($brush, $rect)
  $brush.Dispose()

  $redGlow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 210, 34, 47))
  $greenGlow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 0, 122, 61))
  $graphics.FillEllipse($redGlow, [int]($size * -0.18), [int]($size * -0.08), [int]($size * 0.78), [int]($size * 0.78))
  $graphics.FillEllipse($greenGlow, [int]($size * 0.52), [int]($size * 0.48), [int]($size * 0.68), [int]($size * 0.68))
  $redGlow.Dispose()
  $greenGlow.Dispose()
}

function Draw-RoundedRect($graphics, [System.Drawing.RectangleF]$rect, [float]$radius, [System.Drawing.Brush]$brush) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-IconMark($graphics, [int]$size, [bool]$monochrome = $false) {
  $scale = $size / 1024.0
  $white = if ($monochrome) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(255, 250, 247, 238) }
  $red = if ($monochrome) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(255, 214, 28, 42) }
  $green = if ($monochrome) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(255, 0, 136, 68) }
  $dark = [System.Drawing.Color]::FromArgb(160, 0, 0, 0)

  $shadowBrush = New-Object System.Drawing.SolidBrush $dark
  $panelBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(225, 15, 18, 24))
  $redBrush = New-Object System.Drawing.SolidBrush $red
  $whiteBrush = New-Object System.Drawing.SolidBrush $white

  Draw-RoundedRect $graphics ([System.Drawing.RectangleF]::new(172 * $scale, 214 * $scale, 680 * $scale, 596 * $scale)) (128 * $scale) $shadowBrush
  Draw-RoundedRect $graphics ([System.Drawing.RectangleF]::new(152 * $scale, 194 * $scale, 680 * $scale, 596 * $scale)) (128 * $scale) $panelBrush

  $ringPen = New-Object System.Drawing.Pen $red, (46 * $scale)
  $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawArc($ringPen, [System.Drawing.RectangleF]::new(216 * $scale, 258 * $scale, 552 * $scale, 424 * $scale), 205, 255)
  $ringPen.Dispose()

  $accentPen = New-Object System.Drawing.Pen $green, (20 * $scale)
  $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawArc($accentPen, [System.Drawing.RectangleF]::new(252 * $scale, 296 * $scale, 480 * $scale, 360 * $scale), 39, 46)
  $accentPen.Dispose()

  $playPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $playPath.AddPolygon(@(
    [System.Drawing.PointF]::new(438 * $scale, 362 * $scale),
    [System.Drawing.PointF]::new(438 * $scale, 662 * $scale),
    [System.Drawing.PointF]::new(678 * $scale, 512 * $scale)
  ))
  $graphics.FillPath($whiteBrush, $playPath)
  $playPath.Dispose()

  $fontFamily = New-Object System.Drawing.FontFamily 'Arial'
  $font = New-Object System.Drawing.Font $fontFamily, (154 * $scale), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString('ST', $font, $whiteBrush, [System.Drawing.RectangleF]::new(150 * $scale, 670 * $scale, 700 * $scale, 150 * $scale), $format)
  $font.Dispose()
  $format.Dispose()
  $fontFamily.Dispose()

  $sparkBrush = New-Object System.Drawing.SolidBrush $red
  $graphics.FillEllipse($sparkBrush, [int](704 * $scale), [int](270 * $scale), [int](70 * $scale), [int](70 * $scale))
  $sparkBrush.Dispose()

  $shadowBrush.Dispose()
  $panelBrush.Dispose()
  $redBrush.Dispose()
  $whiteBrush.Dispose()
}

function Write-AppIcon([string]$path, [int]$size) {
  $canvas = New-Canvas $size $false
  Fill-Background $canvas.Graphics $size
  Draw-IconMark $canvas.Graphics $size $false
  Save-Png $canvas $path
}

function Write-ForegroundIcon([string]$path, [int]$size) {
  $canvas = New-Canvas $size $true
  Draw-IconMark $canvas.Graphics $size $false
  Save-Png $canvas $path
}

function Write-BackgroundIcon([string]$path, [int]$size) {
  $canvas = New-Canvas $size $false
  Fill-Background $canvas.Graphics $size
  Save-Png $canvas $path
}

function Write-MonochromeIcon([string]$path, [int]$size) {
  $canvas = New-Canvas $size $true
  Draw-IconMark $canvas.Graphics $size $true
  Save-Png $canvas $path
}

Write-AppIcon (Join-Path $assets 'icon.png') 1024
Write-AppIcon (Join-Path $assets 'splash-icon.png') 1024
Write-AppIcon (Join-Path $assets 'favicon.png') 48
Write-ForegroundIcon (Join-Path $assets 'android-icon-foreground.png') 512
Write-BackgroundIcon (Join-Path $assets 'android-icon-background.png') 512
Write-MonochromeIcon (Join-Path $assets 'android-icon-monochrome.png') 432

Write-Host 'Generated Syria Tube icon assets.'
