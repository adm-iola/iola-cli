![CLI-проект Йошкар-Олы](https://cdn.jsdelivr.net/npm/@iola_adm/iola-cli@latest/docs/assets/readme-header.png)

# iola-cli

CLI и AI-агент для работы с открытыми данными городского округа "Город Йошкар-Ола".

Подробная документация: [GitHub Wiki](https://github.com/adm-iola/iola-cli/wiki).

Публичные endpoints:

- `https://apiiola.yasg.ru/api/v1`
- `https://apiiola.yasg.ru/mcp`

## Быстрый старт

Проверьте Node.js:

```bash
node --version
npm --version
```

Нужен Node.js `22.5.0` или новее.

Установка и первый запуск:

```bash
npm install -g @iola_adm/iola-cli
iola init
iola --help
```

Без глобальной установки:

```bash
npx -y @iola_adm/iola-cli init
```

Основные команды:

```bash
iola search "Петрова"
iola card "школа 29"
iola ask "найди школу 29"
iola sync
iola quality
iola agent
```

Рабочий агент:

```bash
iola skills list
iola tools toolsets
iola files mode read-only
iola files tree .
iola context init
iola cron list
iola daemon status
iola rpc call status
```

Локальная модель через Ollama:

```bash
iola ai setup ollama
iola ask "выгрузи школы на Петрова в csv" --profile local --tools
```

Обновление:

```bash
npm install -g @iola_adm/iola-cli@latest
iola version --check
```

## Документация

- [Установка](https://github.com/adm-iola/iola-cli/wiki/Установка)
- [Первый запуск](https://github.com/adm-iola/iola-cli/wiki/Первый-запуск)
- [AI-профили](https://github.com/adm-iola/iola-cli/wiki/AI-профили)
- [Локальный инструментальный агент](https://github.com/adm-iola/iola-cli/wiki/Локальный-инструментальный-агент)
- [Skills и toolsets](https://github.com/adm-iola/iola-cli/wiki/Skills-и-toolsets)
- [Локальные файлы](https://github.com/adm-iola/iola-cli/wiki/Локальные-файлы)
- [Daemon, RPC и cron](https://github.com/adm-iola/iola-cli/wiki/Daemon-RPC-и-cron)
- [Контекст и память](https://github.com/adm-iola/iola-cli/wiki/Контекст-и-память)
- [Команды](https://github.com/adm-iola/iola-cli/wiki/Команды)
- [Решение проблем](https://github.com/adm-iola/iola-cli/wiki/Решение-проблем)

## Возможности

- поиск и выгрузка открытых данных;
- локальная SQLite-БД, история, сессии и FTS-поиск;
- AI-профили для Ollama, OpenAI, OpenRouter и Codex CLI;
- локальный tool-agent для слабых моделей;
- skills, toolsets, permissions, memory, hooks и готовые agents;
- управляемые локальные файловые операции с режимами `locked`, `read-only`, `workspace-write`, `full-access`;
- cron-задачи, локальный daemon и RPC для автоматизаций;
- контекстные файлы `IOLA.md` и `.iola/context.md`;
- интеграция с публичным MCP-сервером Йошкар-Олы.
