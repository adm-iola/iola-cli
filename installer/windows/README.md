# Windows installer

Исходники установщика Windows для `iola-cli`.

## Что делает установщик

- ставит `iola-cli` в выбранную папку;
- устанавливает CLI из npm-tarball, встроенного в `.exe`;
- проверяет Node.js `>=22.5.0`;
- если Node.js нет, пытается установить его через `winget`;
- создает отдельный профиль данных через `IOLA_HOME`;
- спрашивает имя ярлыка;
- создает ярлык в меню Пуск и, по выбору пользователя, на рабочем столе;
- предлагает запустить мастер настройки после установки.

## Сборка

Требуется Inno Setup 6.

```powershell
cd D:\new_adm_iola\iola-cli
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\windows\scripts\build-installer.ps1
```

Готовый файл появится в:

```text
installer\windows\dist\IOLA-CLI-Setup-<version>.exe
```

Сборка сначала выполняет `npm pack`, кладет пакет в `installer\windows\payload\iola-cli.tgz`, затем встраивает этот архив в установщик. Поэтому `.exe` ставит ту же версию CLI, из которой был собран.

## Профили

Установщик пишет данные профиля в:

```text
%APPDATA%\IOLA\profiles\<profile-name>
```

Ярлык запускает CLI с переменной `IOLA_HOME`, поэтому разные ярлыки могут использовать разные настройки, ключи, SQLite-БД и локальные данные.
