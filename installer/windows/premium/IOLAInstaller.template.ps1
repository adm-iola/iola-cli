$ErrorActionPreference = "Stop"

$AppVersion = "__APP_VERSION__"
$PayloadBase64 = "__PAYLOAD_BASE64__"
$BackgroundBase64 = "__BACKGROUND_BASE64__"
$IconBase64 = "__ICON_BASE64__"
$LogoBase64 = "__LOGO_BASE64__"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$TempRoot = Join-Path $env:TEMP ("iola-premium-installer-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
$PayloadPath = Join-Path $TempRoot "iola-cli.tgz"
$BackgroundPath = Join-Path $TempRoot "readme-header.png"
$IconPath = Join-Path $TempRoot "iola.ico"
$LogoPath = Join-Path $TempRoot "iola-logo.png"
[IO.File]::WriteAllBytes($PayloadPath, [Convert]::FromBase64String($PayloadBase64))
[IO.File]::WriteAllBytes($BackgroundPath, [Convert]::FromBase64String($BackgroundBase64))
[IO.File]::WriteAllBytes($IconPath, [Convert]::FromBase64String($IconBase64))
[IO.File]::WriteAllBytes($LogoPath, [Convert]::FromBase64String($LogoBase64))

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="IOLA CLI Setup" Width="1040" Height="660" WindowStartupLocation="CenterScreen"
        ResizeMode="NoResize" Background="#07111F" FontFamily="Segoe UI">
  <Window.Resources>
    <Style x:Key="PrimaryButton" TargetType="Button">
      <Setter Property="Foreground" Value="#07111F"/>
      <Setter Property="Background" Value="#F4C542"/>
      <Setter Property="BorderBrush" Value="#F4C542"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Padding" Value="18,11"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="{TemplateBinding Background}" CornerRadius="10" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="GhostButton" TargetType="Button" BasedOn="{StaticResource PrimaryButton}">
      <Setter Property="Foreground" Value="#E7EEF8"/>
      <Setter Property="Background" Value="#253246"/>
      <Setter Property="BorderBrush" Value="#314158"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Background" Value="#101B2D"/>
      <Setter Property="Foreground" Value="#F8FAFC"/>
      <Setter Property="BorderBrush" Value="#314158"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="12,8"/>
      <Setter Property="FontSize" Value="14"/>
    </Style>
    <Style TargetType="CheckBox">
      <Setter Property="Foreground" Value="#D7E0EC"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Margin" Value="0,8,0,0"/>
    </Style>
  </Window.Resources>
  <Grid>
    <Grid.Background>
      <ImageBrush ImageSource="__BACKGROUND_PATH__" Stretch="UniformToFill"/>
    </Grid.Background>
    <Rectangle Fill="#07111F" Opacity="0.72"/>
    <Rectangle>
      <Rectangle.Fill>
        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
          <GradientStop Color="#07111F" Offset="0"/>
          <GradientStop Color="#0B1220" Offset="0.45"/>
          <GradientStop Color="#0F8B8D" Offset="1"/>
        </LinearGradientBrush>
      </Rectangle.Fill>
      <Rectangle.Opacity>0.82</Rectangle.Opacity>
    </Rectangle>

    <Grid Margin="48">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="380"/>
        <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>

      <StackPanel Grid.Column="0" VerticalAlignment="Stretch">
        <Image Name="LogoImage" Source="__LOGO_PATH__" Width="88" Height="88" HorizontalAlignment="Left" Margin="0,8,0,24"/>
        <TextBlock Text="IOLA CLI" Foreground="White" FontSize="46" FontWeight="Bold"/>
        <TextBlock Text="Городской AI-агент" Foreground="#D7E0EC" FontSize="20" Margin="0,8,0,0"/>
        <TextBlock Text="Современная установка для Windows: отдельные профили, свои ярлыки, локальные настройки и быстрый запуск мастера." 
                   TextWrapping="Wrap" Foreground="#B9C5D6" FontSize="15" LineHeight="23" Margin="0,28,46,0"/>
        <Border Background="#1A2436" CornerRadius="14" Padding="18" Margin="0,36,46,0" Opacity="0.96">
          <StackPanel>
            <TextBlock Text="Что будет установлено" Foreground="White" FontWeight="SemiBold" FontSize="15"/>
            <TextBlock Text="• IOLA CLI {0}&#x0a;• локальный профиль IOLA_HOME&#x0a;• ярлык с вашей иконкой&#x0a;• мастер настройки после установки" 
                       Foreground="#D7E0EC" FontSize="13" LineHeight="20" Margin="0,10,0,0"/>
          </StackPanel>
        </Border>
      </StackPanel>

      <Border Grid.Column="1" Background="#ECF2F9" CornerRadius="22" Padding="30" VerticalAlignment="Center">
        <StackPanel>
          <TextBlock Text="Настройка установки" Foreground="#0B1220" FontSize="27" FontWeight="Bold"/>
          <TextBlock Text="Выберите папку, имя ярлыка и профиль. Правый клик по полю папки открывает команды создания папки." 
                     Foreground="#475569" FontSize="14" TextWrapping="Wrap" Margin="0,8,0,24"/>

          <TextBlock Text="Папка установки" Foreground="#0B1220" FontWeight="SemiBold"/>
          <Grid Margin="0,8,0,16">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="10"/>
              <ColumnDefinition Width="104"/>
              <ColumnDefinition Width="10"/>
              <ColumnDefinition Width="104"/>
            </Grid.ColumnDefinitions>
            <TextBox Name="InstallDirBox" Grid.Column="0"/>
            <Button Name="BrowseButton" Grid.Column="2" Content="Обзор" Style="{StaticResource GhostButton}"/>
            <Button Name="CreateDirButton" Grid.Column="4" Content="Создать" Style="{StaticResource GhostButton}"/>
          </Grid>

          <TextBlock Text="Имя ярлыка" Foreground="#0B1220" FontWeight="SemiBold"/>
          <TextBox Name="ShortcutNameBox" Margin="0,8,0,16"/>

          <TextBlock Text="Имя профиля" Foreground="#0B1220" FontWeight="SemiBold"/>
          <TextBox Name="ProfileNameBox" Margin="0,8,0,12"/>

          <CheckBox Name="DesktopShortcutBox" Content="Создать ярлык на рабочем столе" IsChecked="True"/>
          <CheckBox Name="LaunchMasterBox" Content="Запустить мастер настройки после установки"/>

          <ProgressBar Name="InstallProgress" Height="10" Minimum="0" Maximum="100" Value="0" Margin="0,24,0,0" Foreground="#0F8B8D" Background="#CFD8E3"/>
          <TextBlock Name="StatusText" Text="Готов к установке" Foreground="#334155" FontSize="13" Margin="0,10,0,0"/>
          <Border Background="#0B1220" CornerRadius="12" Padding="14" Margin="0,14,0,20" Height="106">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
              <TextBlock Name="LogText" Text="Проверим Node.js, установим CLI и создадим ярлыки." Foreground="#CFE0F2" FontFamily="Consolas" FontSize="12" TextWrapping="Wrap"/>
            </ScrollViewer>
          </Border>

          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
            <Button Name="CancelButton" Content="Закрыть" Width="120" Style="{StaticResource GhostButton}" Margin="0,0,12,0"/>
            <Button Name="InstallButton" Content="Установить IOLA" Width="170" Style="{StaticResource PrimaryButton}"/>
          </StackPanel>
        </StackPanel>
      </Border>
    </Grid>
  </Grid>
</Window>
"@

$xaml = $xaml.Replace("__BACKGROUND_PATH__", $BackgroundPath.Replace("\", "/"))
$xaml = $xaml.Replace("__LOGO_PATH__", $LogoPath.Replace("\", "/"))
$xaml = $xaml.Replace("IOLA CLI {0}", "IOLA CLI $AppVersion")
$reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$window = [Windows.Markup.XamlReader]::Load($reader)
try {
  $window.Icon = [Windows.Media.Imaging.BitmapFrame]::Create([Uri]$LogoPath)
} catch {
  # The installer must still open if a Windows image codec rejects the icon.
}

$InstallDirBox = $window.FindName("InstallDirBox")
$ShortcutNameBox = $window.FindName("ShortcutNameBox")
$ProfileNameBox = $window.FindName("ProfileNameBox")
$DesktopShortcutBox = $window.FindName("DesktopShortcutBox")
$LaunchMasterBox = $window.FindName("LaunchMasterBox")
$InstallButton = $window.FindName("InstallButton")
$CancelButton = $window.FindName("CancelButton")
$BrowseButton = $window.FindName("BrowseButton")
$CreateDirButton = $window.FindName("CreateDirButton")
$InstallProgress = $window.FindName("InstallProgress")
$StatusText = $window.FindName("StatusText")
$LogText = $window.FindName("LogText")

$InstallDirBox.Text = Join-Path $env:LOCALAPPDATA "Programs\IOLA CLI"
$ShortcutNameBox.Text = "IOLA CLI"
$ProfileNameBox.Text = "default"

function Add-Log([string]$Text) {
  $LogText.Text = (($LogText.Text + "`n" + $Text).Trim() -split "`n" | Select-Object -Last 18) -join "`n"
}

function Sanitize-Name([string]$Value, [string]$Fallback, [switch]$Profile) {
  $name = $Value.Trim()
  if (-not $name) { $name = $Fallback }
  $invalid = [IO.Path]::GetInvalidFileNameChars()
  foreach ($char in $invalid) { $name = $name.Replace([string]$char, "-") }
  if ($Profile) { $name = $name.Replace(" ", "-") }
  return $name
}

function New-TargetDirectory {
  $target = $InstallDirBox.Text.Trim()
  if (-not $target) { return }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Add-Log "Папка готова: $target"
}

$ctx = New-Object System.Windows.Controls.ContextMenu
$miCreate = New-Object System.Windows.Controls.MenuItem
$miCreate.Header = "Создать указанную папку"
$miCreate.Add_Click({ New-TargetDirectory })
$miOpen = New-Object System.Windows.Controls.MenuItem
$miOpen.Header = "Открыть родительскую папку"
$miOpen.Add_Click({
  $target = $InstallDirBox.Text.Trim()
  if (-not $target) { return }
  $parent = Split-Path -Parent $target
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Start-Process explorer.exe $parent
})
$ctx.Items.Add($miCreate) | Out-Null
$ctx.Items.Add($miOpen) | Out-Null
$InstallDirBox.ContextMenu = $ctx

$BrowseButton.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Выберите папку установки IOLA CLI"
  $dialog.ShowNewFolderButton = $true
  $dialog.SelectedPath = $InstallDirBox.Text
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $InstallDirBox.Text = $dialog.SelectedPath
  }
})
$CreateDirButton.Add_Click({ New-TargetDirectory })
$CancelButton.Add_Click({ $window.Close() })

$script:InstallJob = $null
$script:LogFile = $null
$script:ProgressFile = $null

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(350)
$timer.Add_Tick({
  if ($script:LogFile -and (Test-Path $script:LogFile)) {
    $LogText.Text = (Get-Content -Path $script:LogFile -Tail 18 -ErrorAction SilentlyContinue) -join "`n"
  }
  if ($script:ProgressFile -and (Test-Path $script:ProgressFile)) {
    $line = Get-Content -Path $script:ProgressFile -Tail 1 -ErrorAction SilentlyContinue
    if ($line) {
      $parts = $line -split "\|", 2
      $InstallProgress.Value = [double]$parts[0]
      if ($parts.Count -gt 1) { $StatusText.Text = $parts[1] }
    }
  }
  if ($script:InstallJob -and $script:InstallJob.State -in @("Completed", "Failed", "Stopped")) {
    Receive-Job $script:InstallJob -ErrorAction SilentlyContinue | Out-Null
    if ($script:InstallJob.State -eq "Completed") {
      $InstallProgress.Value = 100
      $StatusText.Text = "Установка завершена"
      Add-Log "Готово. Можно закрыть окно."
    } else {
      $StatusText.Text = "Установка завершилась с ошибкой"
      Add-Log "Ошибка установки. Подробности выше."
    }
    Remove-Job $script:InstallJob -Force -ErrorAction SilentlyContinue
    $script:InstallJob = $null
    $InstallButton.IsEnabled = $true
    $InstallButton.Content = "Установить IOLA"
    $timer.Stop()
  }
})

$InstallButton.Add_Click({
  $installDir = $InstallDirBox.Text.Trim()
  if (-not $installDir) {
    [System.Windows.MessageBox]::Show("Укажите папку установки.", "IOLA CLI Setup") | Out-Null
    return
  }
  $shortcutName = Sanitize-Name $ShortcutNameBox.Text "IOLA CLI"
  $profileName = Sanitize-Name $ProfileNameBox.Text "default" -Profile
  $profileDir = Join-Path $env:APPDATA ("IOLA\profiles\" + $profileName)
  $desktopShortcut = [bool]$DesktopShortcutBox.IsChecked
  $launchMaster = [bool]$LaunchMasterBox.IsChecked
  $script:LogFile = Join-Path $TempRoot "install.log"
  $script:ProgressFile = Join-Path $TempRoot "progress.txt"
  Set-Content -Path $script:LogFile -Value "Старт установки IOLA CLI $AppVersion" -Encoding UTF8
  Set-Content -Path $script:ProgressFile -Value "3|Подготовка" -Encoding UTF8
  $InstallButton.IsEnabled = $false
  $InstallButton.Content = "Устанавливаем..."
  $timer.Start()

  $script:InstallJob = Start-Job -ArgumentList $installDir,$profileDir,$shortcutName,$desktopShortcut,$launchMaster,$PayloadPath,$IconPath,$script:LogFile,$script:ProgressFile -ScriptBlock {
    param($InstallDir,$ProfileDir,$ShortcutName,$DesktopShortcut,$LaunchMaster,$PayloadPath,$IconPath,$LogFile,$ProgressFile)
    function Log([string]$m) { Add-Content -Path $LogFile -Value ("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $m) -Encoding UTF8 }
    function Step([int]$p,[string]$m) { Set-Content -Path $ProgressFile -Value "$p|$m" -Encoding UTF8; Log $m }
    function NodeOk {
      try {
        $raw = (& node --version 2>$null)
        if (-not $raw) { return $false }
        return ([version]$raw.TrimStart("v")) -ge [version]"22.5.0"
      } catch { return $false }
    }
    function MakeShortcut([string]$Path,[string]$Target,[string]$Icon) {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($Path)
      $shortcut.TargetPath = "$env:ComSpec"
      $shortcut.Arguments = "/k `"$Target`""
      $shortcut.WorkingDirectory = Split-Path -Parent $Target
      $shortcut.IconLocation = $Icon
      $shortcut.Save()
    }

    Step 8 "Создаем папки"
    New-Item -ItemType Directory -Force -Path $InstallDir,$ProfileDir | Out-Null
    $runtimeDir = Join-Path $InstallDir "runtime"
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

    Step 18 "Проверяем Node.js"
    if (-not (NodeOk)) {
      $winget = Get-Command winget -ErrorAction SilentlyContinue
      if (-not $winget) { throw "Node.js 22.5+ не найден, winget недоступен." }
      Step 26 "Устанавливаем Node.js через winget"
      & winget install --id OpenJS.NodeJS --source winget --accept-package-agreements --accept-source-agreements --silent | Add-Content -Path $LogFile -Encoding UTF8
      $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
      if (-not (NodeOk)) { throw "Node.js не найден после установки." }
    }

    Step 42 "Устанавливаем IOLA CLI"
    $env:IOLA_HOME = $ProfileDir
    & npm install --prefix $runtimeDir $PayloadPath --omit=dev --no-audit --fund=false | Add-Content -Path $LogFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой." }

    Step 68 "Создаем launcher"
    $cliEntry = Join-Path $runtimeDir "node_modules\@iola_adm\iola-cli\bin\iola.js"
    $launcher = Join-Path $InstallDir "IOLA.cmd"
    Set-Content -Path $launcher -Encoding ASCII -Value @"
@echo off
setlocal
set "IOLA_HOME=$ProfileDir"
set "IOLA_INSTALL_DIR=$InstallDir"
node "$cliEntry" %*
endlocal
"@
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "assets") | Out-Null
    Copy-Item -LiteralPath $IconPath -Destination (Join-Path $InstallDir "assets\iola.ico") -Force

    Step 82 "Создаем ярлыки"
    $startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\IOLA CLI"
    New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
    MakeShortcut (Join-Path $startMenuDir "$ShortcutName.lnk") $launcher (Join-Path $InstallDir "assets\iola.ico")
    if ($DesktopShortcut) {
      MakeShortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "$ShortcutName.lnk") $launcher (Join-Path $InstallDir "assets\iola.ico")
    }

    Step 94 "Финальная настройка"
    if ($LaunchMaster) {
      Start-Process "$env:ComSpec" -ArgumentList "/k `"$launcher`" master"
    }
    Step 100 "Готово"
  }
})

$window.Add_Closed({
  if ($script:InstallJob) {
    Stop-Job $script:InstallJob -Force -ErrorAction SilentlyContinue
    Remove-Job $script:InstallJob -Force -ErrorAction SilentlyContinue
  }
  try { Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}
})

$window.ShowDialog() | Out-Null
