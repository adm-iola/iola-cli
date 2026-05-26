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
```

Глобальная установка:

```bash
npm install -g @iola_adm/iola-cli
iola help
```

## Команды

```bash
iola banner
iola agent
iola ai doctor
iola ai setup ollama
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

## Интерактивный режим

```bash
iola agent
```

Внутри agent доступны slash-команды:

```text
/help
/health
/layers
/schools --limit 10
/schools get --inn 1215067180
/kindergartens --search 29
/search лицей --limit 3
/mcp-info
/ai doctor
/exit
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
