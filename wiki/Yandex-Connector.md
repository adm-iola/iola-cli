# Yandex Connector

`Yandex Connector` - единая точка подключения пользовательских сервисов Яндекса в `iola-cli`.

Цель: пользователь подключает сервисы Яндекса через обычный вход в браузере, а CLI хранит OAuth-токены локально. Какие функции CLI реально использует, пользователь выбирает отдельно через `/yandex`.

Секреты сохраняются только на компьютере пользователя в `~/.iola/secrets.json`. Они не отправляются на сервер IOLA и не попадают в `iola cloud backup`.

## Команды

```bash
iola yandex services
iola yandex setup
iola yandex menu
iola yandex status
iola yandex doctor
iola yandex enable disk mail calendar
iola yandex disable mail
iola yandex oauth-url disk --client-id CLIENT_ID
iola yandex token set
iola yandex token delete
```

## OAuth-приложения

Для пользователя это один `Yandex Connector`, но внутри CLI проходит две авторизации Яндекса:

- `IOLA CLI A` - Yandex ID, Яндекс Диск, Яндекс Почта, Яндекс Документы через Диск;
- `IOLA CLI B` - Яндекс Календарь, Яндекс Контакты, Телемост через календарное событие.

`client_id` этих приложений публичный и встроен в CLI. Пользователь не создает OAuth-приложения вручную: он только входит в свой Яндекс-аккаунт и разрешает доступ. Токены сохраняются локально на компьютере пользователя.

## Категории

Готово к первому контуру:

- `identity` - Yandex ID, профиль пользователя, логин и email;
- `mail` - Яндекс Почта, чтение и поиск писем, отправка только после явного подтверждения;
- `calendar` - Яндекс Календарь;
- `contacts` - Яндекс Контакты;
- `disk` - Яндекс Диск, папка `/IOLA`, файлы, папки, загрузка, скачивание и публичные ссылки;
- `docs` - Яндекс Документы / 360 через Диск;
- `telemost` - Яндекс Телемост через календарное событие.

Отдельный коннектор, не обычный OAuth бытового Яндекса:

- `cloud` - Yandex Cloud Connector: ключ геокодера, YandexGPT API key и folder ID;
- `maps` - Яндекс Геокодер: адреса, координаты, расстояния, ссылки на карту и deeplink маршрута.

Готово без оформления заказа:

- `taxi` - Яндекс Go / Такси: подготовить маршрут, геокодировать адреса, сформировать deeplink и открыть приложение. Заказ, цена и назначение машины ждут партнерский `clid/apikey` от Яндекса;

Backlog после первого контура:

- `market` - Яндекс Маркет: поиск и список покупок, без корзины и оплаты;
- `delivery` - Яндекс Доставка: подготовка заявки/ссылки, без оформления и оплаты.

## Как подключить

1. Запустите подключение. Оно не спрашивает список сервисов, а открывает браузер для входа в Яндекс:

```bash
iola yandex setup
```

2. Авторизуйтесь в Яндексе и разрешите доступ для `IOLA CLI A`. Запрашиваются права:
   - `login:info`;
   - `login:email`;
   - `cloud_api:disk.read`;
   - `cloud_api:disk.write`;
   - `cloud_api:disk.info`;
   - `mail:imap_full`;
   - `mail:smtp`.
3. Затем CLI откроет вторую авторизацию для `IOLA CLI B`. Запрашиваются права:
   - `calendar:all`;
   - `addressbook:all`.
4. После каждой успешной авторизации браузер вернется на локальную страницу `iola-cli`, а CLI сам сохранит OAuth-токен нужной группы.
   Если браузер не смог передать токен обратно в CLI автоматически, CLI попросит вставить `access_token` вручную. Вставлять нужно только значение параметра `access_token`, без всего URL.
5. Если автоматический браузерный flow недоступен, используйте fallback для разработки:

```bash
iola yandex setup --client-id CLIENT_ID --print-url
iola yandex token set
```

6. Выберите, какие функции CLI реально использует:

```bash
iola yandex menu
```

В интерактивном CLI это же меню открывается slash-командой:

```text
/yandex
```

Меню `/yandex` работает как мастер настройки: сервисы выбираются номерами через запятую, а не вводом технических названий.
В этом же меню есть отдельный пункт `Удалить подключение-коннектор`: он удаляет локальные токены и настройки Yandex Connector, чтобы можно было подключить другой Яндекс-аккаунт или отказаться от сервисов Яндекса.

В мастере настройки Yandex Connector считается готовым только после сохранения токенов обеих групп: `IOLA CLI A` и `IOLA CLI B`.

7. Проверьте:

```bash
iola yandex doctor
iola cloud doctor
```

Если включен `disk`, токен автоматически подключается и к старому облачному провайдеру `yandex-disk`, поэтому команды `iola cloud ...` продолжают работать.

Yandex Cloud Connector подключается отдельно:

```bash
iola yandex cloud setup
iola yandex cloud status
iola yandex cloud enable geocoder yandexgpt
iola yandex cloud disable yandexgpt
```

В `/yandex` для него есть отдельный пункт `Yandex Cloud Connector - геокодинг и YandexGPT`. Геокодер включается по умолчанию, потому что он нужен для geo-skills и deeplink Яндекс Go. YandexGPT можно включить там же или выбрать через `/model`.

Если пользователь выбирает YandexGPT в `/model`, а Cloud Connector еще не подключен, CLI объясняет, что нужен Yandex Cloud Connector, и предлагает открыть настройку.

## Что значит включить сервис

OAuth-права дают CLI разрешение обращаться к сервису Яндекса. Практическая работа идет через локальные tools:

- `yandex_identity_me` - проверить пользователя и email;
- `yandex_disk_info` - место на Яндекс Диске;
- `yandex_disk_ls` - список файлов и папок;
- `yandex_disk_mkdir` - создать папку;
- `yandex_disk_find` - найти файл или папку;
- `yandex_disk_stat` - метаданные файла или папки;
- `yandex_disk_exists` - проверка существования;
- `yandex_disk_read_text` - чтение небольшого текстового файла;
- `yandex_disk_save_text` - сохранить текстовый результат на Диск;
- `yandex_disk_upload` - загрузить локальный файл на Диск;
- `yandex_disk_download` - скачать файл с Диска;
- `yandex_disk_move` - переместить файл или папку;
- `yandex_disk_copy` - скопировать файл или папку;
- `yandex_disk_rename` - переименовать файл или папку;
- `yandex_disk_share` - создать публичную ссылку;
- `yandex_disk_share_qr` - создать публичную ссылку и QR-код, сохранить QR PNG на Диск;
- `yandex_disk_share_email` - создать ссылку, QR-код и отправить их по Яндекс Почте;
- `yandex_disk_unshare` - снять публичную ссылку;
- `yandex_disk_delete` - удалить файл или папку;
- `yandex_disk_trash_list` - показать корзину;
- `yandex_disk_restore` - восстановить из корзины;
- `yandex_disk_empty_trash` - очистить корзину;

QR-код:

В веб-интерфейсе Яндекс Диска QR-код доступен при работе с публичной ссылкой. В REST API отдельное поле готового QR-кода не документировано. Поэтому `iola-cli` берет публичную ссылку через API, локально создает PNG QR-кода, загружает этот PNG на Яндекс Диск рядом с исходным объектом и при необходимости публикует отдельную ссылку на QR.
- `yandex_mail_status` - проверить доступ к Почте;
- `yandex_mail_list` - показать последние письма;
- `yandex_mail_search` - найти письма;
- `yandex_mail_read` - прочитать письмо по UID;
- `yandex_mail_send` - отправить письмо;
- `yandex_calendar_status` - проверить доступ к Календарю;
- `yandex_calendar_calendars` - показать доступные календари;
- `yandex_calendar_list` - показать ближайшие события;
- `yandex_calendar_search` - найти событие;
- `yandex_calendar_get` - открыть карточку события;
- `yandex_calendar_create_event` - создать событие с участниками, местом и напоминаниями;
- `yandex_calendar_create_recurring_event` - создать повторяющееся событие;
- `yandex_calendar_update` - изменить событие;
- `yandex_calendar_move` - перенести событие;
- `yandex_calendar_add_reminder` - добавить напоминание;
- `yandex_calendar_delete` - удалить событие;
- `yandex_docs_status` - проверить Документы / 360 через Диск;
- `yandex_docs_list` - показать документы;
- `yandex_docs_find` - найти документ;
- `yandex_docs_create_text` - создать текстовый документ на Яндекс Диске;
- `yandex_docs_read` - прочитать небольшой текстовый документ;
- `yandex_docs_share` - создать ссылку и QR-код на документ;
- `yandex_docs_rename` - переименовать документ;
- `yandex_docs_delete` - удалить документ;
- `yandex_contacts_status` - проверить доступ к Контактам;
- `yandex_contacts_list` - показать контакты;
- `yandex_contacts_search` - найти контакт по имени, email, телефону, организации, адресу или заметке;
- `yandex_contacts_get` - открыть карточку контакта;
- `yandex_contacts_create` - создать контакт;
- `yandex_contacts_update` - обновить поля контакта;
- `yandex_contacts_delete` - удалить контакт;
- `yandex_contacts_add_email`, `yandex_contacts_add_phone`, `yandex_contacts_add_address`, `yandex_contacts_add_note`, `yandex_contacts_add_birthday`, `yandex_contacts_add_org` - добавить отдельные поля;
- `yandex_contacts_remove_email`, `yandex_contacts_remove_phone` - удалить отдельные поля;
- `yandex_contacts_export_vcard`, `yandex_contacts_export_csv` - экспортировать контакты;
- `yandex_contacts_import_vcard`, `yandex_contacts_import_csv` - импортировать контакты;
- `yandex_contacts_find_incomplete` - найти неполные карточки;
- `yandex_contacts_find_duplicates` - найти дубликаты;
- `yandex_contacts_backup_to_disk` - сохранить backup контактов на Яндекс Диск;
- `yandex_contacts_birthdays_to_calendar` - создать события дней рождения в календаре;
- `yandex_contact_send_mail` - отправить письмо контакту;
- `yandex_contact_send_disk_link_qr` - отправить контакту ссылку и QR-код на объект Диска;
- `yandex_contact_create_disk_folder` - создать папку контакта на Диске с vCard и README;
- `yandex_contact_create_calendar_event` - создать встречу с контактом;
- `yandex_contact_create_telemost_event` - создать событие для Телемоста с контактом;
- `yandex_contact_from_public_entity` - создать контакт из открытого городского слоя;
- `yandex_contact_full_pack` - собрать полный пакет по контакту: папка на Диске, заметка, публичная ссылка/QR, событие календаря и опциональное письмо;
- `yandex_mail_meeting_pack` - собрать пакет по письму: сохранить письмо на Диск, создать ссылку/QR, поставить встречу в календарь и опционально отправить ссылку отправителю;
- `yandex_telemost_status` - проверить режим Телемоста;
- `yandex_telemost_create_event` - создать встречу: прямой Telemost API используется только если он доступен аккаунту; иначе создается календарное событие без выдуманной ссылки.
- `yandex_cloud_status` - проверить Yandex Cloud Connector;
- `yandex_go_deeplink` - построить deeplink маршрута Яндекс Go по адресам или координатам.

Комбинированные сценарии:

```bash
iola ask "по последнему письму создай встречу завтра в 14:00, сохрани письмо на диск и пришли отправителю ссылку"
iola ask "собери полный пакет по контакту Петров: папка на диске, заметка, встреча завтра в 12 и ссылка с QR"
iola ask "создай папку для школы 2 на яндекс диске и отправь ссылку контакту Иванов"
iola ask "сделай ссылку Яндекс Go от Медведево, Школьная 15 до Медведево, Советская 20"
```

CLI использует уже подключенные сервисы: Почту, Диск, Контакты и Календарь. Если не хватает email, найдено несколько контактов или неясна дата встречи, CLI должен уточнить, а не выбирать случайно.

Регулярная проверка контактов:

```bash
iola yandex contacts-maintenance on --days 7
iola yandex contacts-maintenance on --days 7 --backup
iola yandex contacts-maintenance status
iola yandex contacts-maintenance tick
iola yandex contacts-maintenance off
```

Проверка ищет дубликаты и неполные карточки. Если включен `--backup`, при tick сохраняется CSV-копия контактов на Яндекс Диск.

Регулярная автоматизация:

```bash
iola yandex daily-digest on --time 09:00
iola yandex daily-digest on --time 09:00 --email
iola yandex daily-digest status
iola yandex daily-digest tick
iola yandex daily-digest off

iola yandex calendar-reminders on --minutes 15
iola yandex calendar-reminders status
iola yandex calendar-reminders tick
iola yandex calendar-reminders off

iola yandex disk-maintenance on --days 7
iola yandex disk-maintenance status
iola yandex disk-maintenance tick
iola yandex disk-maintenance off
```

`daily-digest` собирает короткую сводку: непрочитанные письма, события ближайших суток и неполные контакты. По умолчанию сводка сохраняется документом в `/IOLA/docs`; с `--email` дополнительно отправляется на email подключенного Yandex ID.

`calendar-reminders` проверяет события в ближайшие минуты и показывает напоминания без повторов по уже увиденным событиям.

`disk-maintenance` проверяет место на Диске, публичные ссылки и состояние папки `/IOLA`, затем сохраняет отчет в `/IOLA/docs`.

Включение сервиса в `/yandex` разрешает CLI использовать соответствующую категорию. Отправка письма, удаление файлов, публикация ссылок и создание событий требуют явного намерения пользователя и подтверждения в tool-вызове.

## Иконка приложения

CLI поставляется с готовой иконкой OAuth-приложения. При установке она копируется в:

```text
~/.iola/assets/iola-oauth-icon.png
```

В репозитории файл лежит здесь:

```text
docs/assets/iola-oauth-icon.png
```

Если создается новое OAuth-приложение Яндекса вручную, эту иконку можно указать в поле "Иконка сервиса".

## Важно

Yandex Connector не является универсальным ключом ко всему Яндексу.

Обычные пользовательские сервисы работают через OAuth и scope. Yandex Cloud, YandexGPT и Geocoder подключаются через отдельный Yandex Cloud Connector.

Для браузерного подключения в сборке CLI уже указан public OAuth `client_id` приложения IOLA. Это не секретный ключ. Пользователь не должен создавать OAuth-приложение вручную.

Яндекс ограничивает количество разных групп сервисов в одном OAuth-приложении. Поэтому один токен не может покрыть Диск, Почту, Календарь и Контакты сразу. CLI использует две встроенные группы: `IOLA CLI A` и `IOLA CLI B`.

CLI не должен автоматически оформлять покупки, вызывать такси, подтверждать доставку или выполнять платежи. Для Яндекс Go сейчас допустимы только геокодирование адресов, подготовка deeplink маршрута и открытие приложения. Финальное действие делает пользователь в приложении Яндекса.
