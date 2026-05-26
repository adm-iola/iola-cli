# iola-cli

`iola-cli` - терминальный инструмент и AI-агент для работы с открытыми данными городского округа "Город Йошкар-Ола".

Основные сценарии:

- поиск школ и детских садов;
- просмотр карточек организаций;
- локальная синхронизация данных в SQLite;
- проверка качества данных;
- выгрузка CSV/JSON;
- работа с локальной моделью Ollama;
- работа с OpenAI, OpenRouter и Codex CLI;
- подключение публичного MCP-сервера.

Быстрый старт:

```bash
npm install -g @iola_adm/iola-cli
iola init
iola search "Петрова"
iola ask "найди школу 29"
```

Подробные страницы:

- [Installation](Installation)
- [First-run](First-run)
- [AI-profiles](AI-profiles)
- [Local-tool-agent](Local-tool-agent)
- [Commands](Commands)
- [Troubleshooting](Troubleshooting)
