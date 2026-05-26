# Skills и toolsets

`iola-cli` использует skills как подключаемые инструкции для работы с данными городского округа "Город Йошкар-Ола".

Skills не подмешиваются в каждый запрос целиком. CLI выбирает их по смыслу:

- `open-data` - когда запрос про открытые данные, школы, детские сады, адреса, ИНН, слои;
- `reports` - когда нужен отчет, выгрузка, CSV/XLSX или проверка качества;
- `local-files` - когда пользователь просит работать с локальными файлами, папками, архивами или документами;
- `browser-agent` - когда запрос связан с сайтом, URL, страницей, скриншотом или браузером;
- `local-model` - инструкции для локальных компактных моделей и tool-планирования.

Обычный диалог вроде `привет` не получает инструкции про слои, отчеты, файлы и браузер.

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
