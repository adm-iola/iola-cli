# Commands

Основные команды:

```bash
iola --help
iola init
iola doctor
iola update
iola version --check
```

Данные:

```bash
iola search "Петрова"
iola search "Петрова" --local --fts
iola schools --limit 10
iola kindergartens --search "29"
iola card "школа 29"
iola data schools --format csv --output schools.csv
```

Локальная БД:

```bash
iola db status
iola sync
iola sync status
iola diff
iola quality
```

AI:

```bash
iola ask "найди школу 29"
iola ask "найди школу 29" --schema json
iola ask "найди школу 29" --bare --quiet
iola agents list
iola agents run quality-checker "проверь школы"
```

Интерактивный режим:

```bash
iola agent
```

Внутри agent:

```text
/help
/tools
/memory show
/permissions
/quality
/sync
/exit
```
