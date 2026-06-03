# Yandex Cloud Connector

`Yandex Cloud Connector` подключает к `iola-cli` сервисы Yandex Cloud, которые нужны жителю:

- Яндекс Геокодер - адреса, координаты, расстояния, ссылки на карту и deeplink Яндекс Go;
- YandexGPT - российская AI-модель в меню `/model`.

Это отдельный коннектор. Он не заменяет обычный `Yandex Connector` для Диска, Почты, Календаря и Контактов.

## Как подключить

Самый простой путь:

```bash
iola master
```

В мастере выберите:

```text
4. Yandex Cloud Connector - геокодинг и YandexGPT
```

CLI откроет консоль Yandex Cloud и попросит сохранить:

- ключ `YANDEX_GEOCODER_API_KEY`;
- при необходимости YandexGPT API key;
- при необходимости `YANDEXGPT_FOLDER_ID`.

Геокодер включается по умолчанию. YandexGPT можно включить сразу или позже через `/model`.

Прямые команды:

```bash
iola yandex cloud setup
iola yandex cloud status
iola yandex cloud doctor
iola yandex cloud enable geocoder yandexgpt
iola yandex cloud disable yandexgpt
iola yandex cloud delete
```

Ключи сохраняются только локально в:

```text
~/.iola/secrets.json
```

## YandexGPT в /model

Откройте меню моделей:

```text
/model
```

Выберите:

```text
2. Российские AI (YandexGPT/GigaChat)
```

Если Yandex Cloud Connector еще не подключен, CLI объяснит, что нужен коннектор, и предложит включить его. Если отказаться, CLI вернется в меню выбора моделей.

## Геокодер

После подключения доступны geo-команды:

```bash
iola geo key doctor
iola geo geocode "Йошкар-Ола, улица Петрова, 15"
iola geo nearby "Йошкар-Ола, улица Петрова, 15" --dataset all --limit 5
iola geo distance --from "Петрова 15" --to "школа 7"
iola geo map-link "школа 7"
iola geo route-context "школа 7"
```

Геокодер также нужен для Яндекс Go deeplink:

```bash
iola yandex go link --from "Медведево, Школьная 15" --to "Медведево, Советская 20"
iola yandex go open --from "Медведево, Школьная 15" --to "Медведево, Советская 20" --tariff econom
```

Если ключ геокодера не найден, CLI пишет понятную ошибку и предлагает:

```bash
iola master
```

или:

```bash
iola yandex cloud setup
```

## Яндекс Go

Сейчас `iola-cli` поддерживает только безопасный сценарий:

- уточнить адрес отправления и назначения;
- получить координаты через геокодер;
- сформировать deeplink маршрута Яндекс Go;
- при команде `open` открыть ссылку в браузере или приложении.

CLI не нажимает кнопку заказа, не подтверждает поездку, не списывает деньги и не обещает цену. Цена, повышенный спрос, детское кресло, назначение машины и отмена поездки требуют партнерского `clid/apikey` от Яндекса.

Примеры:

```bash
iola yandex go link --from "Йошкар-Ола, Ленинский 24" --to "Йошкар-Ола, Кремлевская 26"
iola ask "сделай ссылку Яндекс Go от Медведево, Школьная 15 до Медведево, Советская 20"
```

## Ручная инструкция по ключу геокодера

Если нужен только геокодер без YandexGPT, можно использовать отдельную инструкцию:

[Yandex Geocoder API key](Yandex-Geocoder-API-key)

Бесплатный лимит API Геокодера для обычного ключа у Яндекса указан как до 1000 запросов в сутки. Новый ключ может активироваться с задержкой 15-30 минут.

## Важно

Yandex Cloud тарифицирует YandexGPT по правилам Yandex Cloud. Перед активным использованием модели проверьте лимиты и оплату в консоли.

Не публикуйте API-ключи и folder ID в GitHub, README, issue, wiki или чатах поддержки.
