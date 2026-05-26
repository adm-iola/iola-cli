![CLI-проект Йошкар-Олы](https://cdn.jsdelivr.net/npm/@iola_adm/iola-cli@latest/docs/assets/readme-header.png)

# iola-cli

CLI и AI-агент городского округа "Город Йошкар-Ола".

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
iola
```

Без глобальной установки:

```bash
npx -y @iola_adm/iola-cli
```

При первом запуске `iola` открывает мастер настройки, затем запускает интерактивный агент. Короткая справка: `iola help`, полный список команд: `iola commands`.

Повторный запуск мастера:

```bash
iola master
```

Мастер обновляет только выбранные разделы и не сбрасывает остальные настройки.

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
iola policy use analyst
iola tasks list
iola artifacts list
iola trace last
iola changes list
iola archive doctor
iola index status
iola reports list
iola plugins list
iola context init
iola cron list
iola daemon status
iola rpc call status
iola settings list
iola mcp serve --stdio
iola usage summary
iola budget status
iola subagents list
iola trajectory last
iola review config
iola browser status
iola gosuslugi status
iola gosuslugi connect
iola gosuslugi whoami
iola gosuslugi debt
iola gosuslugi notifications --unread
iola gosuslugi keepalive
iola gosuslugi install-keepalive
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
- [Рабочая среда агента](https://github.com/adm-iola/iola-cli/wiki/Рабочая-среда-агента)
- [Платформа агента](https://github.com/adm-iola/iola-cli/wiki/Платформа-агента)
- [Браузерный агент](https://github.com/adm-iola/iola-cli/wiki/Браузерный-агент)
- [Подключение Госуслуг](https://github.com/adm-iola/iola-cli/wiki/Подключение-Госуслуг)
- [Расширения и локальные данные](https://github.com/adm-iola/iola-cli/wiki/Расширения-и-локальные-данные)
- [Архивы и мастер настройки](https://github.com/adm-iola/iola-cli/wiki/Архивы-и-мастер-настройки)
- [Daemon, RPC и cron](https://github.com/adm-iola/iola-cli/wiki/Daemon-RPC-и-cron)
- [Контекст и память](https://github.com/adm-iola/iola-cli/wiki/Контекст-и-память)
- [Команды](https://github.com/adm-iola/iola-cli/wiki/Команды)
- [Решение проблем](https://github.com/adm-iola/iola-cli/wiki/Решение-проблем)

## Возможности

- поиск и выгрузка открытых данных;
- локальная SQLite-БД, история, сессии и FTS-поиск;
- AI-профили для Ollama, OpenAI, OpenRouter и Codex CLI;
- локальный tool-agent для слабых моделей с минимальными tools `search_data`, `get_card`, `export_report`, `file_read`, `browser_open`;
- ленивые skills, toolsets, permissions, memory, hooks и готовые agents;
- subagents, skill bundles, layered settings, usage/budget accounting и trajectory export;
- полноценный локальный MCP server по stdio/http: tools, resources и prompts;
- MCP-мост для локальной модели: встроенный `iola-local` доступен как `mcp:iola-local:TOOL`;
- дополнительные stdio MCP-серверы можно добавить в `~/.iola/config.json` в раздел `mcp.servers`;
- браузерный runtime через Playwright: чтение страниц, скриншоты, PDF, клики, ввод и eval;
- личное локальное подключение Госуслуг через отдельный браузерный профиль на ПК пользователя;
- read-only tools Госуслуг для агента: ФИО, дата рождения, задолженности и уведомления;
- keepalive-проверка сессии Госуслуг каждые 30 минут через Windows Task Scheduler без висящего окна терминала;
- управляемые локальные файловые операции с режимами `locked`, `read-only`, `workspace-write`, `full-access`;
- планы выполнения, traces, tasks, artifacts, snapshots и policy-профили;
- экспорт отчетов в Excel/Word-совместимые файлы;
- staged changes, импорт локальных CSV/JSON, индекс локальных документов, report packs, plugins и локальный MCP endpoint;
- чтение и индексирование `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.md`, `.txt`, `.csv`, `.json`, `.html`;
- работа с архивами через 7-Zip: `.zip`, `.7z`, `.rar`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz` и другие;
- расширенный `iola onboard` с установкой 7-Zip, браузерного runtime, Ollama, Codex CLI и настройкой выбранных компонентов;
- cron-задачи, локальный daemon, web dashboard и RPC для автоматизаций;
- контекстные файлы `IOLA.md` и `.iola/context.md`;
- интеграция с публичным MCP-сервером Йошкар-Олы.
