#define AppVersion GetEnv("IOLA_INSTALLER_VERSION")
#if AppVersion == ""
  #define AppVersion "0.2.62"
#endif

[Setup]
AppId={{7F4D4AB5-335E-46B2-9A62-2E019D00F6F5}
AppName=IOLA CLI
AppVersion={#AppVersion}
AppPublisher=Yoshkar-Ola Administration
AppPublisherURL=https://github.com/adm-iola/iola-cli
AppSupportURL=https://github.com/adm-iola/iola-cli/issues
AppUpdatesURL=https://github.com/adm-iola/iola-cli/releases
DefaultDirName={localappdata}\Programs\IOLA CLI
DefaultGroupName=IOLA CLI
DisableProgramGroupPage=no
OutputDir=dist
OutputBaseFilename=IOLA-CLI-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=assets\iola.ico
WizardImageFile=assets\wizard-large.bmp
WizardSmallImageFile=assets\wizard-small.bmp
UninstallDisplayIcon={app}\assets\iola.ico
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UsePreviousAppDir=yes
CloseApplications=no

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"; Flags: checkedonce

[Files]
Source: "assets\iola.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "assets\iola-256.png"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "scripts\install-iola.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "payload\iola-cli.tgz"; DestDir: "{app}\payload"; Flags: ignoreversion

[Icons]
Name: "{group}\{code:GetShortcutName}"; Filename: "{cmd}"; Parameters: "/k ""{app}\IOLA.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\iola.ico"
Name: "{userdesktop}\{code:GetShortcutName}"; Filename: "{cmd}"; Parameters: "/k ""{app}\IOLA.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\iola.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-iola.ps1"" -InstallDir ""{app}"" -ProfileDir ""{code:GetProfilePath}"" -PackageArchive ""{app}\payload\iola-cli.tgz"" -PackageVersion ""{#AppVersion}"""; StatusMsg: "Устанавливаем IOLA CLI и готовим локальный профиль..."; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/k ""{app}\IOLA.cmd"" master"; Description: "Запустить мастер настройки IOLA CLI"; Flags: postinstall unchecked nowait

[Code]
var
  ProfilePage: TInputQueryWizardPage;

function SanitizeFileName(Value: String): String;
var
  I: Integer;
  C: String;
begin
  Result := Trim(Value);
  if Result = '' then
    Result := 'IOLA CLI';
  for I := 1 to Length(Result) do
  begin
    C := Copy(Result, I, 1);
    if Pos(C, '\/:*?"<>|') > 0 then
      Result[I] := '-';
  end;
end;

function SanitizeProfileName(Value: String): String;
var
  I: Integer;
  C: String;
begin
  Result := Trim(Value);
  if Result = '' then
    Result := 'default';
  for I := 1 to Length(Result) do
  begin
    C := Copy(Result, I, 1);
    if Pos(C, '\/:*?"<>| .') > 0 then
      Result[I] := '-';
  end;
end;

procedure InitializeWizard;
begin
  ProfilePage := CreateInputQueryPage(
    wpSelectDir,
    'Профиль и ярлык',
    'Настройте, как IOLA CLI будет называться в Windows.',
    'Можно создать несколько независимых ярлыков: например, IOLA Дом, IOLA Работа или IOLA Тест. Каждый профиль хранит свои настройки и ключи отдельно.'
  );
  ProfilePage.Add('Имя ярлыка:', False);
  ProfilePage.Add('Имя профиля:', False);
  ProfilePage.Values[0] := 'IOLA CLI';
  ProfilePage.Values[1] := 'default';
end;

function GetShortcutName(Param: String): String;
begin
  Result := SanitizeFileName(ProfilePage.Values[0]);
end;

function GetProfilePath(Param: String): String;
begin
  Result := ExpandConstant('{userappdata}\IOLA\profiles\') + SanitizeProfileName(ProfilePage.Values[1]);
end;
