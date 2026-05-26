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

Нужен Node.js `18` или новее. Если Node.js не установлен:

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
iola update
iola version --check
iola data schools --limit 10
iola data kindergartens --search "29"
iola data schools --format csv
iola ai doctor
iola ai setup ollama
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
/layers
/data schools --limit 10
/schools --limit 10
/schools get --inn 1215067180
/kindergartens --search 29
/search лицей --limit 3
/mcp-info
/ai doctor
/context школа 29
/use ollama
/use openai
/key status
/key set openai
/model
/provider
/config
/history
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

## Переменные окружения

```bash
IOLA_API_BASE_URL=https://apiiola.yasg.ru/api/v1
IOLA_MCP_BASE_URL=https://apiiola.yasg.ru
```
