# First run

Первый запуск:

```bash
iola init
```

Команда проверит:

- Node.js и npm;
- локальную SQLite-БД;
- доступность публичного API/MCP;
- Ollama и подходящую локальную модель;
- обновления npm-пакета.

Диагностика:

```bash
iola doctor
iola doctor --summary
iola ai doctor
iola db status
```

Синхронизация локальной базы:

```bash
iola sync
iola sync status
```

Проверка данных:

```bash
iola quality
iola diff
```
