![CLI-проект Йошкар-Олы](https://cdn.jsdelivr.net/npm/@iola_adm/iola-cli@latest/docs/assets/readme-header.png)

# iola-cli

CLI для работы с открытыми данными городского округа "Город Йошкар-Ола".

Проект использует публичные endpoints:

- `https://apiiola.yasg.ru/api/v1`
- `https://apiiola.yasg.ru/mcp`

## Необходимые компоненты

Проверьте Node.js и npm:

```bash
node --version
npm --version
```

Нужен Node.js `22.5.0` или новее. Это нужно для встроенной SQLite-БД
`node:sqlite`, которую CLI будет использовать для локальной истории, кеша и
сессий без дополнительных нативных зависимостей.

Если Node.js не установлен или версия ниже `22.5.0`:

```bash
# Windows
winget install OpenJS.NodeJS.LTS

# macOS
brew install node

# Linux, вариант через NodeSource
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Для локального AI-режима нужен Ollama. Проверка:

```bash
ollama --version
```

Установка Ollama:

```bash
# Windows
winget install Ollama.Ollama

# macOS
brew install --cask ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

Диагностика ПК и подбор локальной модели:

```bash
npx -y @iola_adm/iola-cli init
npx -y @iola_adm/iola-cli init --upgrade-node
npx -y @iola_adm/iola-cli ai doctor
npx -y @iola_adm/iola-cli ai setup ollama
```

## Установка и запуск

```bash
npx -y @iola_adm/iola-cli help
npx -y @iola_adm/iola-cli init --yes
```

Глобальная установка:

```bash
npm install -g @iola_adm/iola-cli
iola help
iola init
```

## Команды

```bash
iola banner
iola agent
iola chat
iola init
iola doctor
iola db status
iola db init
iola history --limit 20
iola history clear
iola sessions --limit 20
iola resume 1 "продолжи"
iola fork 1 "новый вопрос"
iola features list
iola features enable api-cache
iola permissions list
iola permissions deny export_data
iola permissions allow export_data
iola memory add "Отвечай кратко и указывай источник данных"
iola memory show
iola hooks events
iola hooks add AfterSync "iola quality"
iola agents list
iola agents run quality-checker "проверь школы"
iola mcp status
iola mcp list
iola mcp install codex
iola cache status
iola cache warm
iola cache clear
iola sync
iola sync status
iola diff schools
iola search "Петрова" --local
iola search "Петрова" --local --fts
iola card "школа 29"
iola quality
iola quality missing-phones
iola data schools --where address=Петрова --save schools-petrova
iola views
iola view schools-petrova --format csv --output schools-petrova.csv
iola views delete schools-petrova
iola report missing-phones
iola privacy
iola backup create
iola alias add petrova "data schools --where address=Петрова --columns name,address,phone"
iola run "выгрузи школы на Петрова в csv"
iola config get
iola config set api.baseUrl https://apiiola.yasg.ru/api/v1
iola config reset
iola update
iola version --check
iola ask "Найди школу 29"
iola ask "Найди школу 29" --profile codex --events --output answer.txt
iola ask "Найди школу 29" --schema json --no-history
iola ask "Найди школу 29" --bare --quiet
iola ask "выгрузи школы на Петрова в csv" --profile local --tools --reasoning verify
iola data schools --format csv --output schools.csv
iola data schools --limit 10
iola data kindergartens --search "29"
iola data schools --where address=Петрова --columns name,address,phone
iola data schools --format csv
iola ai doctor
iola ai setup ollama
iola ai setup codex --model gpt-5.5
iola ai profiles
iola ai profile add router-qwen --provider openrouter --model qwen/qwen3-32b
iola ai profile use router-qwen
iola ai models openrouter --search qwen
iola ai models codex
iola ai ask "Какие школы есть на улице Петрова?"
iola ai context "школа 29"
iola ai key set openai
iola ai key status
iola ai setup openai --model gpt-4.1-mini
iola ai setup openrouter --model openai/gpt-4.1-mini
iola health
iola layers
iola schools --limit 10
iola schools --format csv
iola schools get --inn 1215067180
iola kindergartens --search "29"
iola kindergartens get --inn 1215077421 --json
iola search "лицей"
iola mcp-info
iola setup codex
```

По умолчанию команды выводят компактную таблицу. Для полного ответа API
используйте `--json` или `--format json`. Для выгрузки используйте
`--format csv`.

## Интерактивный режим

```bash
iola agent
```

Внутри agent доступны slash-команды:

```text
/help
/health
/doctor
/db status
/sessions
/resume 1
/features list
/permissions
/tools
/memory show
/hooks list
/agents list
/mcp status
/config get
/layers
/data schools --limit 10
/schools --limit 10
/schools get --inn 1215067180
/kindergartens --search 29
/search лицей --limit 3
/mcp-info
/ai doctor
/context школа 29
/profiles
/profile use local
/models openrouter --search qwen
/use ollama
/use openai
/key status
/key set openai
/model
/provider
/config
/history
/history --limit 20
/clear
/update
/init
/exit
```

Обычный текст без `/` в `iola agent` отправляется в настроенный AI-провайдер.
`iola chat` запускает тот же интерактивный режим.

## AI-запросы

Локальная модель через Ollama:

```bash
iola ai setup ollama
iola ai ask "Какие школы есть на улице Петрова?"
iola ask "Какие школы есть на улице Петрова?"
```

OpenAI:

```bash
iola ai key set openai
iola ai setup openai --model gpt-4.1-mini
iola ai ask "Найди школу 29"
```

OpenRouter:

```bash
iola ai key set openrouter
iola ai setup openrouter --model openai/gpt-4.1-mini
iola ai ask "Покажи контакты лицея"
```

Codex CLI:

```bash
codex login
iola ai setup codex --model gpt-5.5
iola setup codex
iola ask "Назови ИНН школы 29"
```

AI-профили позволяют держать локальную модель, OpenAI, OpenRouter и Codex
одновременно:

```bash
iola ai profiles
iola ai profile add local-small --provider ollama --model llama3.2:1b
iola ai profile add gpt --provider openai --model gpt-4.1-mini
iola ai profile add router-qwen --provider openrouter --model qwen/qwen3-32b
iola ai profile add codex-read --provider codex --model gpt-5.5 --sandbox read-only
iola ai profile use router-qwen
```

Списки моделей:

```bash
iola ai models ollama
iola ai models openai
iola ai models openrouter --search qwen
iola ai models codex
```

Для OpenAI список моделей требует сохраненный ключ. OpenRouter берется из
публичного API OpenRouter. Ollama читает локальные модели через `api/tags`, а
если Ollama не запущен, показывает рекомендуемые локальные модели.

Проверить, какие данные попадут в AI-контекст:

```bash
iola ai context "школа 29"
iola ai context "1215067180" --json
iola ai context "улица Петрова"
```

Поиск контекста учитывает номера учреждений, ИНН и улицы.

AI-ответ строится по контексту из публичного API. Ассистент получает краткий
список источников контекста и должен указывать слой, название и ИНН, если
отвечает по конкретным организациям.

Ключи OpenAI/OpenRouter сохраняются локально на компьютере пользователя:

```text
%USERPROFILE%\.iola\secrets.json
```

Управление ключами:

```bash
iola ai key set openai
iola ai key set openrouter
iola ai key status
iola ai key delete openai
```

Если одновременно задана переменная окружения (`OPENAI_API_KEY` или
`OPENROUTER_API_KEY`) и сохранен локальный ключ, CLI использует переменную
окружения как более приоритетную.

Если данных в контексте недостаточно, ассистент должен сообщить об этом, а не
выдумывать сведения.

## Назначение

CLI дает прямой терминальный доступ к открытым данным городского округа,
командам подключения MCP/skill, AI-запросам через Ollama/OpenAI/OpenRouter,
интерактивному агентному режиму, экспорту данных и проверке обновлений.

## Локальная SQLite-БД

CLI использует встроенный `node:sqlite` и хранит локальную БД в профиле
пользователя:

```text
%USERPROFILE%\.iola\iola.db
```

БД создается автоматически при установке npm-пакета и при `iola init`.
В ней хранятся история AI-запросов, контекст ответа, ошибки выполнения,
служебная таблица версии схемы, а также подготовлены таблицы для кеша API и
сохраненных выборок.

Команды:

```bash
iola db status
iola db init
iola db reset
iola history --limit 20
iola history --json
iola history clear
iola sessions --limit 20
iola sessions clear
iola resume 1 "продолжи"
iola fork 1 "новая ветка разговора"
```

Ключи OpenAI/OpenRouter в SQLite не сохраняются. Они остаются в локальном
`secrets.json` или в переменных окружения.

## Feature flags, MCP и машинный вывод

Экспериментальные и системные возможности можно включать отдельно:

```bash
iola features list
iola features enable api-cache
iola features disable sqlite-history
```

MCP-интеграции:

```bash
iola mcp status
iola mcp list
iola mcp install codex
iola mcp remove codex
```

Для автоматизации доступны события, JSON-ответ и запись результата в файл:

```bash
iola ask "Найди школу 29" --events
iola ask "Найди школу 29" --schema json
iola ask "Найди школу 29" --output answer.txt
```

## Кеш, локальный поиск и выборки

API-ответы можно кешировать локально:

```bash
iola cache status
iola cache warm
iola cache clear
iola data schools --cache
```

Локальная синхронизация сохраняет открытые слои в SQLite и позволяет искать без
повторного обращения к API:

```bash
iola sync
iola sync status
iola diff
iola search "Петрова" --local
iola search "школа Петрова" --local --fts
iola data schools --local --search "лицей"
```

Сохраненные выборки:

```bash
iola data schools --where address=Петрова --columns name,address,phone --save schools-petrova
iola views
iola view schools-petrova
iola view schools-petrova --format csv --output schools-petrova.csv
iola views delete schools-petrova
```

Отчеты, backup и алиасы:

```bash
iola report schools-summary
iola report education-contacts
iola report missing-phones
iola report licenses
iola privacy
iola backup create
iola alias add petrova "data schools --where address=Петрова --columns name,address,phone"
iola petrova
iola run "выгрузи школы на Петрова в csv"
```

## Локальный tool-agent для слабых моделей

Для локального профиля Ollama доступен режим `--tools`. Он сделан специально
для маленьких моделей, которые хуже отвечают свободным текстом, но могут быть
полезны как планировщик действий.

В этом режиме CLI не доверяет модели напрямую. Модель предлагает JSON-план,
CLI валидирует список разрешенных tools и сам выполняет действия через
проверенные локальные функции:

- `search_local`
- `get_card`
- `export_data`
- `run_report`
- `save_view`

Пример:

```bash
iola ask "выгрузи школы на Петрова в csv" --profile local --tools
iola ask "найди детсады без телефона" --profile local --tools --reasoning verify
```

Режимы:

```bash
--reasoning fast    # один план
--reasoning verify  # план с валидацией результата
--reasoning vote    # несколько вариантов, выбирается валидный
```

OpenAI, OpenRouter и Codex работают как раньше. `--tools` применяется только
к локальному Ollama-профилю, чтобы не менять поведение внешних провайдеров.

Карточки, качество данных и изменения:

```bash
iola card schools 1215067180
iola card "школа 29"
iola quality
iola quality schools
iola quality missing-phones
iola quality invalid-emails
iola quality duplicate-inn
iola sync status
iola diff
iola diff schools
```

## Permissions, memory, hooks и agents

Permissions ограничивают, что может делать локальный tool-agent:

```bash
iola permissions list
iola permissions deny export_data
iola permissions allow export_data
```

Memory хранит пользовательские предпочтения в локальной SQLite-БД и добавляет их
в AI-контекст, кроме режима `--bare`:

```bash
iola memory add "Если найден конкретный объект, показывай ИНН"
iola memory show
iola memory export
```

Hooks запускают локальные команды на события CLI:

```bash
iola hooks events
iola hooks add AfterSync "iola quality"
iola hooks list
```

Поддерживаемые события: `SessionStart`, `BeforeTool`, `AfterTool`,
`AfterSync`, `BeforeExport`, `SessionEnd`.

Agents - готовые режимы работы поверх AI-профилей и локальных инструментов:

```bash
iola agents list
iola agents run quality-checker "проверь школы"
iola agents run exporter "выгрузи школы на Петрова в csv"
```

Для скриптов доступны минимальные режимы:

```bash
iola ask "Найди школу 29" --bare
iola ask "Найди школу 29" --quiet
iola ask "Найди школу 29" --schema json --fail-on-empty
iola --debug --debug-file iola-debug.log doctor
```

## Wiki

Подробные пользовательские инструкции ведутся в GitHub Wiki. Исходники страниц
лежат в папке `wiki/`, чтобы их можно было редактировать и коммитить как обычные
Markdown-файлы.

Рекомендуемая структура: `Home`, `Installation`, `First-run`, `AI-profiles`,
`Local-tool-agent`, `Commands`, `Troubleshooting`.

## Переменные окружения

```bash
IOLA_API_BASE_URL=https://apiiola.yasg.ru/api/v1
IOLA_MCP_BASE_URL=https://apiiola.yasg.ru
```

Переменные окружения имеют приоритет над локальной конфигурацией. Локальные
endpoints можно настроить так:

```bash
iola config set api.baseUrl https://apiiola.yasg.ru/api/v1
iola config set api.mcpBaseUrl https://apiiola.yasg.ru
iola config get
```
