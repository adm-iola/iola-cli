# iola-cli

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@iola_adm/iola-cli@latest/docs/assets/readme-header.png" alt="CLI-проект Йошкар-Олы" width="100%">
</p>

<p align="center">
  <a href="https://github.com/adm-iola/iola-cli/wiki">Документация</a>
  ·
  <a href="https://github.com/adm-iola/iola-cli/wiki/Установка">Установка</a>
  ·
  <a href="https://github.com/adm-iola/iola-cli/wiki/Первый-запуск">Первый запуск</a>
  ·
  <a href="https://github.com/adm-iola/iola-cli/wiki/AI-профили">AI-профили</a>
  ·
  <a href="https://github.com/adm-iola/iola-cli/wiki/Команды">Команды</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@iola_adm/iola-cli">
    <img alt="npm version" src="https://img.shields.io/npm/v/@iola_adm/iola-cli?label=npm&cacheSeconds=60">
  </a>
  <a href="https://github.com/adm-iola/iola-cli/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/adm-iola/iola-cli/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://github.com/adm-iola/iola-cli/actions/workflows/npm-publish.yml">
    <img alt="npm publish" src="https://github.com/adm-iola/iola-cli/actions/workflows/npm-publish.yml/badge.svg?event=release">
  </a>
  <a href="https://github.com/adm-iola/iola-cli/blob/main/LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg">
  </a>
  <img alt="Node.js 22.5+" src="https://img.shields.io/badge/node-22.5%2B-339933">
</p>

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
```

Локальная модель IOLA через Ollama/GGUF:

```bash
iola ai setup iola --yes
iola ask "дай телефон школы № 2"
```

CLI использует модель `iola-router:qwen3-1.7b-v4-q8` из GGUF-репозитория `LMSerg/iola-router-qwen3-1.7b-v4-gguf`. При установке CLI проверяет наличие модели и не скачивает ее повторно, если локальная модель уже установлена. При запуске локального AI CLI проверяет свежесть модели и обновляет ее при необходимости. Принудительная переустановка доступна командой `iola ai setup iola --yes --force`.

Выбор модели:

```bash
/model
```

В интерактивном CLI команда `/model` переключает локальные модели, российские AI-провайдеры YandexGPT/GigaChat, API-профили OpenAI/OpenRouter и Codex CLI. Российские провайдеры вызываются напрямую, без gateway/proxy. Для OpenRouter выбор устроен так: сначала выбирается разработчик моделей, затем CLI показывает до 30 самых свежих моделей для текстовой работы с датой релиза и размером контекста. В списке моделей `0` возвращает к выбору разработчика.

В локальном выборе доступны:

- штатная модель IOLA `iola-router:qwen3-1.7b-v4-q8`;
- установленные и рекомендуемые модели Ollama;
- ручной ввод имени любой Ollama-модели, например `qwen3:4b` или `llama3.2:3b`.

Если выбранная Ollama-модель еще не скачана, CLI предложит выполнить `ollama pull`.

Российские AI:

- Yandex AI Studio / YandexGPT: документация `https://yandex.cloud/ru/docs/foundation-models/`, аутентификация `https://yandex.cloud/ru/docs/ai-studio/api-ref/authentication`, тарифы `https://yandex.cloud/ru/docs/foundation-models/pricing`;
- GigaChat: документация `https://developers.sber.ru/docs/ru/gigachat/overview`, получение токена `https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token`, тарифы `https://developers.sber.ru/docs/ru/gigachat/tariffs`.

```bash
iola ai key set yandexgpt
iola ai setup yandexgpt --model yandexgpt-lite/latest

iola ai key set gigachat
iola ai setup gigachat --model GigaChat-2
```

У GigaChat для физических лиц есть Freemium-лимит на токены; для больших объемов используются платные пакеты. У YandexGPT тарификация идет через Yandex Cloud по токенам и квотам аккаунта, актуальные бесплатные гранты или лимиты нужно проверять в консоли Yandex Cloud.

Зарубежные API-ключи:

- OpenAI Platform: регистрация `https://platform.openai.com/`, ключи `https://platform.openai.com/api-keys`;
- OpenRouter: регистрация `https://openrouter.ai/`, ключи `https://openrouter.ai/settings/keys`.

Ключи сохраняются локально командой `iola ai key set openai` или `iola ai key set openrouter`. Важно: оплата российскими банковскими картами для OpenAI Platform и OpenRouter может быть невозможна. Перед настройкой платных API проверьте доступный способ оплаты в личном кабинете сервиса.

Ollama остается опциональным runtime:

```bash
iola ai setup ollama
```

Обновление:

```bash
npm install -g @iola_adm/iola-cli@latest
iola version --check
```

## Документация

- [Установка](https://github.com/adm-iola/iola-cli/wiki/Установка)
- [Первый запуск](https://github.com/adm-iola/iola-cli/wiki/Первый-запуск)
- [Мастер настройки](https://github.com/adm-iola/iola-cli/wiki/Мастер-настройки)
- [AI-профили](https://github.com/adm-iola/iola-cli/wiki/AI-профили)
- [Локальный инструментальный агент](https://github.com/adm-iola/iola-cli/wiki/Локальный-инструментальный-агент)
- [Skills и toolsets](https://github.com/adm-iola/iola-cli/wiki/Skills-и-toolsets)
- [Локальные файлы](https://github.com/adm-iola/iola-cli/wiki/Локальные-файлы)
- [Рабочая среда агента](https://github.com/adm-iola/iola-cli/wiki/Рабочая-среда-агента)
- [Платформа агента](https://github.com/adm-iola/iola-cli/wiki/Платформа-агента)
- [Браузерный агент](https://github.com/adm-iola/iola-cli/wiki/Браузерный-агент)
- [Расширения и локальные данные](https://github.com/adm-iola/iola-cli/wiki/Расширения-и-локальные-данные)
- [Архивы и мастер настройки](https://github.com/adm-iola/iola-cli/wiki/Архивы-и-мастер-настройки)
- [Daemon, RPC и cron](https://github.com/adm-iola/iola-cli/wiki/Daemon-RPC-и-cron)
- [Контекст и память](https://github.com/adm-iola/iola-cli/wiki/Контекст-и-память)
- [Команды](https://github.com/adm-iola/iola-cli/wiki/Команды)
- [Решение проблем](https://github.com/adm-iola/iola-cli/wiki/Решение-проблем)

## Возможности

- интеграция с публичным MCP-сервером Йошкар-Олы;
- поиск и выгрузка открытых данных;
- локальная SQLite-БД, история, сессии и FTS-поиск;
- AI-профили для IOLA local, Ollama, YandexGPT, GigaChat, OpenAI, OpenRouter и Codex CLI;
- локальный tool-agent для модели IOLA с tools `search_data`, `search_entities`, `resolve_entity_field`, `get_card`, `export_report`, `file_read`, `browser_open`;
- ленивые skills, toolsets, permissions, memory, hooks и готовые agents;
- subagents, skill bundles, layered settings, usage/budget accounting и trajectory export;
- локальный MCP-сервер по stdio/http для подключения iola-cli к другим AI-клиентам;
- ответы по открытым данным берутся из публичного MCP `https://apiiola.yasg.ru/mcp`;
- локальная БД и прямой API используются как резерв, если публичный MCP временно недоступен;
- дополнительные stdio MCP-серверы можно добавить в `~/.iola/config.json` в раздел `mcp.servers`;
- браузерный runtime через Playwright: чтение страниц, скриншоты, PDF, клики, ввод и eval;
- управляемые локальные файловые операции с режимами `locked`, `read-only`, `workspace-write`, `full-access`;
- планы выполнения, traces, tasks, artifacts, snapshots и policy-профили;
- экспорт отчетов в Excel/Word-совместимые файлы;
- staged changes, импорт локальных CSV/JSON, индекс локальных документов, report packs, plugins и локальный MCP endpoint;
- чтение и индексирование `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.md`, `.txt`, `.csv`, `.json`, `.html`;
- работа с архивами через 7-Zip: `.zip`, `.7z`, `.rar`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz` и другие;
- расширенный `iola onboard` с установкой 7-Zip, браузерного runtime, IOLA local, Ollama, Codex CLI и настройкой выбранных компонентов;
- cron-задачи, локальный daemon, web dashboard и RPC для автоматизаций;
- контекстные файлы `IOLA.md` и `.iola/context.md`;
