# Daemon, RPC и cron

Локальный daemon запускает HTTP/RPC endpoint на компьютере пользователя:

```bash
iola daemon status
iola daemon start
```

По умолчанию endpoint:

```text
http://127.0.0.1:18790
```

RPC-команды:

```bash
iola rpc call status
iola rpc call search --query Петрова --dataset schools
iola rpc call card --query "школа 29"
iola rpc call quality
```

Cron-задачи:

```bash
iola cron add "каждый день 09:00 -- quality"
iola cron list
iola cron run 1
iola cron tick
iola cron delete 1
```

`cron tick` проверяет задачи, которые пора выполнить. Его можно запускать вручную, через Windows Task Scheduler или другой планировщик.

Пример проверки сессии Госуслуг каждые 30 минут:

```bash
iola gosuslugi install-keepalive
iola cron tick
```
