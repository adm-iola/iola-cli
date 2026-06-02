# Yandex Connector

`Yandex Connector` - единая точка подключения пользовательских сервисов Яндекса в `iola-cli`.

Цель: пользователь один раз настраивает вход через Яндекс, а CLI хранит токен локально и включает только выбранные категории функций.

Секреты сохраняются только на компьютере пользователя в `~/.iola/secrets.json`. Они не отправляются на сервер IOLA и не попадают в `iola cloud backup`.

## Команды

```bash
iola yandex services
iola yandex setup
iola yandex status
iola yandex doctor
iola yandex enable disk mail calendar
iola yandex disable mail
iola yandex oauth-url disk --client-id CLIENT_ID
iola yandex token set
iola yandex token delete
```

## Категории

Готово к первому контуру:

- `identity` - Yandex ID, профиль пользователя, логин и email;
- `disk` - Яндекс Диск, папка `/IOLA`, файлы, папки, загрузка, скачивание и публичные ссылки.

Исследуется:

- `mail` - Яндекс Почта, чтение и поиск писем, отправка только после явного подтверждения;
- `calendar` - Яндекс Календарь;
- `contacts` - Яндекс Контакты;
- `wiki` - Yandex Wiki;
- `tracker` - Yandex Tracker;
- `forms` - Yandex Forms;
- `docs` - Яндекс Документы / 360.

Отдельные ключи, не обычный OAuth бытового Яндекса:

- `cloud` - Yandex Cloud, YandexGPT, SpeechKit, Vision, IAM и folder ID;
- `maps` - Yandex Geocoder API и карты.

Backlog после первого контура:

- `taxi` - Яндекс Go / Такси: только подготовить маршрут и открыть приложение, без заказа и оплаты;
- `market` - Яндекс Маркет: поиск и список покупок, без корзины и оплаты;
- `delivery` - Яндекс Доставка: подготовка заявки/ссылки, без оформления и оплаты.

## Как подключить

1. Создайте OAuth-приложение Яндекса по инструкции на странице [Облачные диски](Облачные-диски).
2. Включите нужные scope. Для первого контура нужны:
   - `login:info`;
   - `login:email`;
   - `cloud_api:disk.read`;
   - `cloud_api:disk.write`;
   - `cloud_api:disk.info`.
3. Запустите:

```bash
iola yandex setup disk --client-id CLIENT_ID
```

4. Откройте ссылку авторизации, которую выведет CLI.
5. Скопируйте OAuth-токен.
6. Сохраните токен:

```bash
iola yandex token set
```

7. Проверьте:

```bash
iola yandex doctor
iola cloud doctor
```

Если включен `disk`, токен автоматически подключается и к старому облачному провайдеру `yandex-disk`, поэтому команды `iola cloud ...` продолжают работать.

## Важно

Yandex Connector не является универсальным ключом ко всему Яндексу.

Обычные пользовательские сервисы работают через OAuth и scope. Yandex Cloud, YandexGPT и Geocoder требуют отдельные ключи, folder ID или настройки в Yandex Cloud.

CLI не должен автоматически оформлять покупки, вызывать такси, подтверждать доставку или выполнять платежи. Для таких сценариев допустима только подготовка ссылки, маршрута или списка, а финальное действие делает пользователь в приложении Яндекса.
