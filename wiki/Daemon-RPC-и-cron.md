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

## Готовые cron-сценарии Яндекса

```bash
iola yandex mail-watch on --minutes 5
iola yandex daily-digest on --time 09:00
iola yandex calendar-reminders on --minutes 15
iola yandex contacts-maintenance on --days 7 --backup
iola yandex disk-maintenance on --days 7
```

- `mail-watch` проверяет новые письма.
- `daily-digest` собирает сводку по почте, календарю и контактам, сохраняет Markdown-документ на Яндекс Диск.
- `calendar-reminders` проверяет ближайшие события календаря.
- `contacts-maintenance` ищет неполные карточки и дубликаты, опционально делает backup.
- `disk-maintenance` проверяет место, документы и публичные ссылки в папке `/IOLA`, сохраняет отчет на Диск.

Чтобы расписания выполнялись автоматически, должен регулярно запускаться `iola cron tick`: вручную, через daemon или системный планировщик.
