# Skills и toolsets

`iola-cli` использует skills как подключаемые инструкции для работы с данными городского округа "Город Йошкар-Ола".

```bash
iola skills list
iola skills show open-data
iola skills enable reports
iola skills disable local-model
iola skills paths
```

Папки skills:

- встроенные skills внутри npm-пакета;
- пользовательские skills в `~/.iola/skills`;
- проектные skills в `.iola/skills`.

Toolsets управляют группами разрешений:

```bash
iola tools toolsets
iola tools enable reports
iola tools disable sync
iola tools profile safe
iola tools profile full
```

Режим `safe` подходит для чтения и анализа без записи файлов и без запуска sync.
Режим `full` предназначен для доверенного локального пользователя.

