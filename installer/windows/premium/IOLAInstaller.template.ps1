$ErrorActionPreference = "Stop"

$AppVersion = "__APP_VERSION__"
$PayloadBase64 = "__PAYLOAD_BASE64__"
$BackgroundBase64 = "__BACKGROUND_BASE64__"
$IconBase64 = "__ICON_BASE64__"
$LogoBase64 = "__LOGO_BASE64__"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

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
        Title="IOLA CLI Setup" Width="1180" Height="760" MinWidth="1040" MinHeight="680"
        WindowStartupLocation="CenterScreen" ResizeMode="CanResizeWithGrip"
        Background="#07111F" FontFamily="Segoe UI">
  <Window.Resources>
    <DropShadowEffect x:Key="SoftShadow" Color="#000000" Direction="270" ShadowDepth="18" BlurRadius="42" Opacity="0.34"/>

    <Style x:Key="GlassButton" TargetType="Button">
      <Setter Property="Foreground" Value="#F8FAFC"/>
      <Setter Property="Background" Value="#2AFFFFFF"/>
      <Setter Property="BorderBrush" Value="#55FFFFFF"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="16,10"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    BorderThickness="{TemplateBinding BorderThickness}"
                    CornerRadius="14"
                    Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="PrimaryButton" TargetType="Button" BasedOn="{StaticResource GlassButton}">
      <Setter Property="Foreground" Value="#07111F"/>
      <Setter Property="Background" Value="#F4C542"/>
      <Setter Property="BorderBrush" Value="#FFF1A8"/>
    </Style>
    <Style x:Key="DangerButton" TargetType="Button" BasedOn="{StaticResource GlassButton}">
      <Setter Property="Background" Value="#22FFFFFF"/>
      <Setter Property="BorderBrush" Value="#44FFFFFF"/>
    </Style>
    <Style x:Key="GlassTextBox" TargetType="TextBox">
      <Setter Property="Background" Value="#2A08111F"/>
      <Setter Property="Foreground" Value="#F8FAFC"/>
      <Setter Property="BorderBrush" Value="#55FFFFFF"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="14,10"/>
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="CaretBrush" Value="#F4C542"/>
    </Style>
    <Style TargetType="CheckBox">
      <Setter Property="Foreground" Value="#F8FAFC"/>
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="Margin" Value="0,10,0,0"/>
    </Style>
    <Style TargetType="ListBox">
      <Setter Property="Background" Value="#2208111F"/>
      <Setter Property="Foreground" Value="#F8FAFC"/>
      <Setter Property="BorderBrush" Value="#44FFFFFF"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="6"/>
    </Style>
    <Style TargetType="ComboBox">
      <Setter Property="Background" Value="#2208111F"/>
      <Setter Property="Foreground" Value="#07111F"/>
      <Setter Property="BorderBrush" Value="#44FFFFFF"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="8"/>
    </Style>
  </Window.Resources>

  <Grid>
    <Grid.Background>
      <ImageBrush ImageSource="__BACKGROUND_PATH__" Stretch="UniformToFill"/>
    </Grid.Background>
    <Rectangle Fill="#07111F" Opacity="0.42"/>
    <Rectangle>
      <Rectangle.Fill>
        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
          <GradientStop Color="#CC07111F" Offset="0"/>
          <GradientStop Color="#770F8B8D" Offset="0.58"/>
          <GradientStop Color="#AA07111F" Offset="1"/>
        </LinearGradientBrush>
      </Rectangle.Fill>
    </Rectangle>

    <Grid Margin="38">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="390"/>
        <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>

      <Border Grid.Column="0" CornerRadius="30" Padding="32" Margin="0,0,26,0"
              Background="#26FFFFFF" BorderBrush="#55FFFFFF" BorderThickness="1"
              Effect="{StaticResource SoftShadow}">
        <Grid>
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
          </Grid.RowDefinitions>
          <StackPanel>
            <Image Source="__LOGO_PATH__" Width="92" Height="92" HorizontalAlignment="Left" Margin="0,0,0,26"/>
            <TextBlock Text="IOLA CLI" Foreground="White" FontSize="52" FontWeight="Bold"/>
            <TextBlock Text="Городской AI-агент" Foreground="#EAF2FF" FontSize="21" Margin="0,8,0,0"/>
            <TextBlock Text="Установка с отдельным профилем, своим ярлыком и запуском мастера настройки после установки."
                       TextWrapping="Wrap" Foreground="#D8E4F2" FontSize="15" LineHeight="23" Margin="0,34,12,0"/>
          </StackPanel>
          <Border Grid.Row="2" Background="#22000000" BorderBrush="#44FFFFFF" BorderThickness="1" CornerRadius="22" Padding="20">
            <StackPanel>
              <TextBlock Text="Версия" Foreground="#BFD0E6" FontSize="12"/>
              <TextBlock Text="IOLA CLI {0}" Foreground="White" FontSize="20" FontWeight="SemiBold" Margin="0,4,0,12"/>
              <TextBlock Text="Папка выбирается внутри установщика. Правый клик в списке папок создает новую папку в текущем каталоге."
                         TextWrapping="Wrap" Foreground="#D8E4F2" FontSize="13" LineHeight="19"/>
            </StackPanel>
          </Border>
        </Grid>
      </Border>

      <Border Grid.Column="1" CornerRadius="30" Padding="30"
              Background="#33FFFFFF" BorderBrush="#66FFFFFF" BorderThickness="1"
              Effect="{StaticResource SoftShadow}">
        <Grid>
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
          </Grid.RowDefinitions>

          <StackPanel Grid.Row="0">
            <TextBlock Text="Настройка установки" Foreground="White" FontSize="30" FontWeight="Bold"/>
            <TextBlock Text="Выберите папку, имя ярлыка и профиль. Все действия остаются в этом окне."
                       Foreground="#D8E4F2" FontSize="14" Margin="0,8,0,22"/>
          </StackPanel>

          <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto">
            <StackPanel Margin="0,0,8,0">
              <TextBlock Text="Папка установки" Foreground="#F8FAFC" FontWeight="SemiBold"/>
              <Grid Margin="0,8,0,14">
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="*"/>
                  <ColumnDefinition Width="12"/>
                  <ColumnDefinition Width="150"/>
                </Grid.ColumnDefinitions>
                <TextBox Name="InstallDirBox" Grid.Column="0" Style="{StaticResource GlassTextBox}"/>
                <Button Name="BrowseButton" Grid.Column="2" Content="Выбрать" Style="{StaticResource GlassButton}"/>
              </Grid>

              <Border Name="FolderPickerPanel" Visibility="Collapsed" Background="#2A07111F"
                      BorderBrush="#66FFFFFF" BorderThickness="1" CornerRadius="22" Padding="18" Margin="0,0,0,18">
                <Grid>
                  <Grid.RowDefinitions>
                    <RowDefinition Height="Auto"/>
                    <RowDefinition Height="Auto"/>
                    <RowDefinition Height="220"/>
                    <RowDefinition Height="Auto"/>
                  </Grid.RowDefinitions>
                  <Grid Grid.Row="0">
                    <Grid.ColumnDefinitions>
                      <ColumnDefinition Width="120"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="*"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="110"/>
                    </Grid.ColumnDefinitions>
                    <ComboBox Name="DriveBox" Grid.Column="0"/>
                    <TextBox Name="CurrentPathBox" Grid.Column="2" Style="{StaticResource GlassTextBox}"/>
                    <Button Name="GoPathButton" Grid.Column="4" Content="Перейти" Style="{StaticResource GlassButton}"/>
                  </Grid>
                  <Grid Grid.Row="1" Margin="0,12,0,10">
                    <Grid.ColumnDefinitions>
                      <ColumnDefinition Width="Auto"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="*"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="110"/>
                    </Grid.ColumnDefinitions>
                    <Button Name="UpFolderButton" Grid.Column="0" Content="Вверх" Style="{StaticResource GlassButton}" Width="94"/>
                    <TextBox Name="NewFolderNameBox" Grid.Column="2" Style="{StaticResource GlassTextBox}" ToolTip="Имя новой папки"/>
                    <Button Name="NewFolderButton" Grid.Column="4" Content="Новая папка" Style="{StaticResource GlassButton}"/>
                  </Grid>
                  <ListBox Name="FolderList" Grid.Row="2" FontSize="14">
                    <ListBox.ContextMenu>
                      <ContextMenu>
                        <MenuItem Header="Создать папку здесь"/>
                        <MenuItem Header="Выбрать эту папку"/>
                      </ContextMenu>
                    </ListBox.ContextMenu>
                  </ListBox>
                  <Grid Grid.Row="3" Margin="0,12,0,0">
                    <Grid.ColumnDefinitions>
                      <ColumnDefinition Width="*"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="118"/>
                      <ColumnDefinition Width="12"/>
                      <ColumnDefinition Width="118"/>
                    </Grid.ColumnDefinitions>
                    <TextBlock Grid.Column="0" Text="Двойной клик входит в папку. Правый клик создает папку в текущем каталоге."
                               Foreground="#D8E4F2" FontSize="12" VerticalAlignment="Center"/>
                    <Button Name="UseFolderButton" Grid.Column="2" Content="Выбрать" Style="{StaticResource PrimaryButton}"/>
                    <Button Name="ClosePickerButton" Grid.Column="4" Content="Скрыть" Style="{StaticResource DangerButton}"/>
                  </Grid>
                </Grid>
              </Border>

              <TextBlock Text="Имя ярлыка" Foreground="#F8FAFC" FontWeight="SemiBold"/>
              <TextBox Name="ShortcutNameBox" Style="{StaticResource GlassTextBox}" Margin="0,8,0,14"/>

              <TextBlock Text="Имя профиля" Foreground="#F8FAFC" FontWeight="SemiBold"/>
              <TextBox Name="ProfileNameBox" Style="{StaticResource GlassTextBox}" Margin="0,8,0,10"/>

              <CheckBox Name="DesktopShortcutBox" Content="Создать ярлык на рабочем столе" IsChecked="True"/>
              <CheckBox Name="LaunchMasterBox" Content="Запустить мастер настройки после установки"/>

              <ProgressBar Name="InstallProgress" Height="10" Minimum="0" Maximum="100" Value="0" Margin="0,22,0,0"
                           Foreground="#F4C542" Background="#33000000"/>
              <TextBlock Name="StatusText" Text="Готов к установке" Foreground="#F8FAFC" FontSize="13" Margin="0,10,0,0"/>
              <Border Background="#28000000" BorderBrush="#44FFFFFF" BorderThickness="1" CornerRadius="18" Padding="14" Margin="0,12,0,12" Height="112">
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                  <TextBlock Name="LogText" Text="Проверим Node.js, установим CLI и создадим ярлыки."
                             Foreground="#EAF2FF" FontFamily="Consolas" FontSize="12" TextWrapping="Wrap"/>
                </ScrollViewer>
              </Border>
            </StackPanel>
          </ScrollViewer>

          <Border Grid.Row="2" Background="#22000000" BorderBrush="#44FFFFFF" BorderThickness="1" CornerRadius="20" Padding="14" Margin="0,18,0,0">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="126"/>
                <ColumnDefinition Width="12"/>
                <ColumnDefinition Width="178"/>
              </Grid.ColumnDefinitions>
              <TextBlock Text="Готово к установке" Foreground="#D8E4F2" VerticalAlignment="Center" FontSize="13"/>
              <Button Name="CancelButton" Grid.Column="1" Content="Закрыть" Style="{StaticResource DangerButton}"/>
              <Button Name="InstallButton" Grid.Column="3" Content="Установить IOLA" Style="{StaticResource PrimaryButton}"/>
            </Grid>
          </Border>
        </Grid>
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
}

$InstallDirBox = $window.FindName("InstallDirBox")
$ShortcutNameBox = $window.FindName("ShortcutNameBox")
$ProfileNameBox = $window.FindName("ProfileNameBox")
$DesktopShortcutBox = $window.FindName("DesktopShortcutBox")
$LaunchMasterBox = $window.FindName("LaunchMasterBox")
$InstallButton = $window.FindName("InstallButton")
$CancelButton = $window.FindName("CancelButton")
$BrowseButton = $window.FindName("BrowseButton")
$InstallProgress = $window.FindName("InstallProgress")
$StatusText = $window.FindName("StatusText")
$LogText = $window.FindName("LogText")
$FolderPickerPanel = $window.FindName("FolderPickerPanel")
$DriveBox = $window.FindName("DriveBox")
$CurrentPathBox = $window.FindName("CurrentPathBox")
$GoPathButton = $window.FindName("GoPathButton")
$UpFolderButton = $window.FindName("UpFolderButton")
$NewFolderNameBox = $window.FindName("NewFolderNameBox")
$NewFolderButton = $window.FindName("NewFolderButton")
$FolderList = $window.FindName("FolderList")
$UseFolderButton = $window.FindName("UseFolderButton")
$ClosePickerButton = $window.FindName("ClosePickerButton")
$ContextNewFolder = $FolderList.ContextMenu.Items[0]
$ContextUseFolder = $FolderList.ContextMenu.Items[1]

$script:CurrentFolder = Join-Path $env:LOCALAPPDATA "Programs"
$InstallDirBox.Text = Join-Path $env:LOCALAPPDATA "Programs\IOLA CLI"
$ShortcutNameBox.Text = "IOLA CLI"
$ProfileNameBox.Text = "default"
$NewFolderNameBox.Text = "IOLA CLI"

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

function Normalize-FolderPath([string]$Path) {
  if (-not $Path) { return $script:CurrentFolder }
  try {
    return [IO.Path]::GetFullPath($Path)
  } catch {
    return $script:CurrentFolder
  }
}

function Refresh-Drives {
  $DriveBox.Items.Clear()
  Get-PSDrive -PSProvider FileSystem | Sort-Object Name | ForEach-Object {
    $DriveBox.Items.Add($_.Root) | Out-Null
  }
}

function Refresh-Folders([string]$Path) {
  $path = Normalize-FolderPath $Path
  if (-not (Test-Path -LiteralPath $path -PathType Container)) {
    $parent = Split-Path -Parent $path
    if ($parent -and (Test-Path -LiteralPath $parent -PathType Container)) {
      $path = $parent
    } else {
      $path = Join-Path $env:LOCALAPPDATA "Programs"
    }
  }
  $script:CurrentFolder = $path
  $CurrentPathBox.Text = $path
  $InstallDirBox.Text = $path
  $driveRoot = [IO.Path]::GetPathRoot($path)
  $DriveBox.SelectedItem = $driveRoot
  $FolderList.Items.Clear()
  try {
    Get-ChildItem -LiteralPath $path -Directory -Force -ErrorAction Stop |
      Sort-Object Name |
      ForEach-Object { $FolderList.Items.Add($_.Name) | Out-Null }
  } catch {
    Add-Log "Нет доступа к папке: $path"
  }
}

function Join-CurrentFolder([string]$Child) {
  if (-not $Child) { return $script:CurrentFolder }
  return Join-Path $script:CurrentFolder $Child
}

function Enter-SelectedFolder {
  $selected = [string]$FolderList.SelectedItem
  if (-not $selected) { return }
  Refresh-Folders (Join-CurrentFolder $selected)
}

function New-ChildFolder {
  $name = Sanitize-Name $NewFolderNameBox.Text "Новая папка"
  $target = Join-Path $script:CurrentFolder $name
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Add-Log "Папка создана: $target"
  Refresh-Folders $target
  $NewFolderNameBox.Text = "Новая папка"
}

function Use-CurrentFolder {
  $InstallDirBox.Text = $script:CurrentFolder
  $FolderPickerPanel.Visibility = "Collapsed"
  Add-Log "Выбрана папка установки: $script:CurrentFolder"
}

Refresh-Drives
Refresh-Folders $InstallDirBox.Text

$BrowseButton.Add_Click({
  if ($FolderPickerPanel.Visibility -eq "Visible") {
    $FolderPickerPanel.Visibility = "Collapsed"
  } else {
    $FolderPickerPanel.Visibility = "Visible"
    Refresh-Folders $InstallDirBox.Text
  }
})
$DriveBox.Add_SelectionChanged({
  if ($DriveBox.SelectedItem) { Refresh-Folders ([string]$DriveBox.SelectedItem) }
})
$GoPathButton.Add_Click({ Refresh-Folders $CurrentPathBox.Text })
$UpFolderButton.Add_Click({
  $parent = Split-Path -Parent $script:CurrentFolder
  if ($parent) { Refresh-Folders $parent }
})
$NewFolderButton.Add_Click({ New-ChildFolder })
$UseFolderButton.Add_Click({ Use-CurrentFolder })
$ClosePickerButton.Add_Click({ $FolderPickerPanel.Visibility = "Collapsed" })
$ContextNewFolder.Add_Click({ New-ChildFolder })
$ContextUseFolder.Add_Click({ Use-CurrentFolder })
$FolderList.Add_MouseDoubleClick({ Enter-SelectedFolder })
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
