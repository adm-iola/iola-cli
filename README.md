# iola-cli

CLI для работы с открытыми данными городского округа "Город Йошкар-Ола".

Проект использует публичные endpoints:

- `https://apiiola.yasg.ru/api/v1`
- `https://apiiola.yasg.ru/mcp`

## Установка

```bash
npx -y @iola_adm/iola-cli help
```

После публикации npm-пакета можно будет установить глобально:

```bash
npm install -g @iola_adm/iola-cli
iola help
```

## Команды

```bash
iola layers
iola schools --limit 10
iola kindergartens --search "29"
iola search "лицей"
iola mcp-info
iola setup codex
```

## Назначение

Первый релиз CLI дает прямой терминальный доступ к открытым данным и командам
подключения MCP/skill. Дальше планируется добавить режим AI-запросов через
ключ пользователя для OpenAI/OpenRouter и интерактивный агентный режим.

## Переменные окружения

```bash
IOLA_API_BASE_URL=https://apiiola.yasg.ru/api/v1
IOLA_MCP_BASE_URL=https://apiiola.yasg.ru
```

