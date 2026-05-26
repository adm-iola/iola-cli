![CLI-проект Йошкар-Олы](https://cdn.jsdelivr.net/npm/@iola_adm/iola-cli@latest/docs/assets/readme-header.png)

# iola-cli

CLI для работы с открытыми данными городского округа "Город Йошкар-Ола".

Проект использует публичные endpoints:

- `https://apiiola.yasg.ru/api/v1`
- `https://apiiola.yasg.ru/mcp`

## Установка и запуск

```bash
npx -y @iola_adm/iola-cli help
```

Глобальная установка:

```bash
npm install -g @iola_adm/iola-cli
iola help
```

## Команды

```bash
iola health
iola layers
iola schools --limit 10
iola schools get --inn 1215067180
iola kindergartens --search "29"
iola kindergartens get --inn 1215077421 --json
iola search "лицей"
iola mcp-info
iola setup codex
```

По умолчанию команды выводят компактную таблицу. Для полного ответа API
используйте `--json`.

## Назначение

Первый релиз CLI дает прямой терминальный доступ к открытым данным и командам
подключения MCP/skill. Дальше планируется добавить режим AI-запросов через
ключ пользователя для OpenAI/OpenRouter и интерактивный агентный режим.

## Переменные окружения

```bash
IOLA_API_BASE_URL=https://apiiola.yasg.ru/api/v1
IOLA_MCP_BASE_URL=https://apiiola.yasg.ru
```
