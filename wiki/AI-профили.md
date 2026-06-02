# AI profiles

CLI поддерживает несколько AI-профилей одновременно.

## Локальная модель

```bash
iola ai setup ollama
iola ai profile use local
iola ask "найди школы на Петрова"
```

В интерактивном агенте команда `/model` открывает выбор локальной модели. В локальном меню доступны:

- штатная модель IOLA `iola-router:qwen3-1.7b-v4-q8`;
- установленные и рекомендуемые модели Ollama;
- ручной ввод имени любой Ollama-модели.

Если выбранная Ollama-модель еще не установлена, CLI предложит скачать ее через `ollama pull`. При выборе сторонней Ollama-модели профиль `local` сохраняется как `provider: ollama`; при выборе штатной модели IOLA профиль `local` возвращается к `provider: iola`.

## Российские AI

Российские провайдеры вынесены в отдельный блок `/model` и вызываются напрямую, без gateway/proxy:

```text
/model
2. Российские AI (YandexGPT/GigaChat)
```

### YandexGPT

Для CLI нужны две вещи: API key и ID каталога Yandex Cloud.

Пошаговая настройка:

1. Перейдите в консоль Yandex Cloud: `https://console.cloud.yandex.ru/`.
2. Войдите в аккаунт Яндекса.
3. Если облако еще не создано, создайте облако.
4. Откройте нужный каталог внутри облака или создайте новый каталог для `iola-cli`.
5. Скопируйте ID каталога. Обычно он виден на странице каталога в консоли Yandex Cloud. Этот ID понадобится как `YANDEXGPT_FOLDER_ID`.
6. Откройте раздел сервисных аккаунтов в выбранном каталоге.
7. Создайте сервисный аккаунт для CLI, например `iola-cli`.
8. Назначьте сервисному аккаунту роль, которая разрешает вызов Foundation Models / AI Studio в этом каталоге.
9. Откройте созданный сервисный аккаунт.
10. Перейдите в раздел ключей сервисного аккаунта.
11. Создайте API-ключ.
12. Скопируйте API-ключ сразу после создания и сохраните его локально в CLI:

```bash
iola ai key set yandexgpt
```

CLI попросит ввести:

- `YANDEXGPT_API_KEY` - API-ключ сервисного аккаунта;
- `YANDEXGPT_FOLDER_ID` - ID каталога Yandex Cloud.

После сохранения ключа выберите профиль и модель:

```bash
iola ai setup yandexgpt --model yandexgpt-lite/latest
```

Через интерактивное меню:

```text
/model
2. Российские AI (YandexGPT/GigaChat)
1. YandexGPT API
```

Доступные модели в CLI:

- `yandexgpt-lite/latest` - быстрый и более дешевый вариант;
- `yandexgpt/latest` - YandexGPT Pro latest;
- `yandexgpt/rc` - release candidate.

CLI также понимает env-переменные `YANDEXGPT_API_KEY` или `YANDEX_CLOUD_API_KEY`, а для каталога - `YANDEXGPT_FOLDER_ID` или `YANDEX_CLOUD_FOLDER_ID`.

### GigaChat

Для CLI нужен authorization key. Это не одноразовый OAuth access token: CLI сам получает OAuth-токен перед запросом, используя сохраненный authorization key.

Пошаговая настройка:

1. Перейдите на портал разработчиков Сбера: `https://developers.sber.ru/`.
2. Войдите в аккаунт.
3. Откройте раздел GigaChat.
4. Если нужно, подключите доступ к GigaChat API для физического лица или организации.
5. Откройте кабинет/проект, в котором доступны учетные данные GigaChat API.
6. Найдите authorization key для REST API. В документации GigaChat он используется в OAuth-запросе в заголовке `Authorization: Basic ...`.
7. Скопируйте authorization key и сохраните его локально в CLI:

```bash
iola ai key set gigachat
```

CLI попросит ввести:

- `GIGACHAT_AUTH_KEY` - authorization key;
- `scope` - по умолчанию `GIGACHAT_API_PERS` для персонального доступа.

После сохранения ключа выберите профиль и модель:

```bash
iola ai setup gigachat --model GigaChat-2
```

Через интерактивное меню:

```text
/model
2. Российские AI (YandexGPT/GigaChat)
2. GigaChat API
```

Доступные модели в CLI:

- `GigaChat-2` - основная модель;
- `GigaChat-2-Pro` - повышенное качество;
- `GigaChat-2-Max` - максимальное качество;
- `GigaChat` - legacy/fallback.

CLI также понимает env-переменные `GIGACHAT_AUTH_KEY` или `GIGACHAT_API_KEY`. По умолчанию используется scope `GIGACHAT_API_PERS`; при необходимости его можно задать через `GIGACHAT_SCOPE`.

По тарифам: у GigaChat для физических лиц есть Freemium-лимит на токены; для больших объемов используются платные пакеты. У YandexGPT тарификация идет через Yandex Cloud по токенам и квотам аккаунта, поэтому актуальные бесплатные гранты или лимиты нужно проверять в консоли Yandex Cloud.

Официальная документация:

- Yandex Foundation Models: `https://yandex.cloud/ru/docs/foundation-models/`;
- Yandex AI Studio authentication: `https://yandex.cloud/ru/docs/ai-studio/api-ref/authentication`;
- Yandex Foundation Models pricing: `https://yandex.cloud/ru/docs/foundation-models/pricing`;
- GigaChat overview: `https://developers.sber.ru/docs/ru/gigachat/overview`;
- GigaChat OAuth token: `https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token`;
- GigaChat tariffs: `https://developers.sber.ru/docs/ru/gigachat/tariffs`.

## OpenAI

Получение ключа OpenAI Platform:

1. Зарегистрируйтесь или войдите в OpenAI Platform: `https://platform.openai.com/`.
2. Откройте страницу API-ключей: `https://platform.openai.com/api-keys`.
3. Выберите нужный project или создайте новый project.
4. Нажмите `Create new secret key`.
5. Скопируйте ключ сразу после создания. Повторно посмотреть полный ключ обычно нельзя.
6. В CLI сохраните ключ:

```bash
iola ai key set openai
iola ai setup openai --model gpt-4.1-mini
iola ask "найди школу 29" --profile openai
```

Важно: OpenAI API Platform и ChatGPT Plus/Pro - разные продукты. Подписка ChatGPT не заменяет API-биллинг. Для работы API обычно нужно отдельно настроить billing в OpenAI Platform.

## OpenRouter

Получение ключа OpenRouter:

1. Зарегистрируйтесь или войдите в OpenRouter: `https://openrouter.ai/`.
2. Откройте страницу ключей: `https://openrouter.ai/settings/keys`.
3. Нажмите создание нового API key.
4. Задайте имя ключа и при необходимости лимит расходов.
5. Скопируйте ключ сразу после создания. Храните его как секрет.
6. В CLI сохраните ключ:

```bash
iola ai key set openrouter
iola ai setup openrouter --model openai/gpt-4.1-mini
iola ai models openrouter --search qwen
```

OpenRouter удобен тем, что через один ключ можно выбирать модели разных разработчиков: OpenAI, Anthropic, Google, Qwen / Alibaba, DeepSeek, Meta / Llama, Mistral AI и других.

## Оплата

Важно: оплата российскими банковскими картами для OpenAI Platform и OpenRouter может быть невозможна. Перед настройкой платных API заранее проверьте доступный способ оплаты и пополнения баланса в личном кабинете выбранного сервиса.

Ключи YandexGPT, GigaChat, OpenAI и OpenRouter сохраняются локально на устройстве пользователя в `~/.iola/secrets.json`. CLI не публикует ключи в репозиторий и не записывает их в документацию.

В интерактивном CLI модели удобнее выбирать через slash-команду:

```text
/model
```

Для OpenRouter выбор идет в два шага:

1. выбрать разработчика моделей: OpenAI, Anthropic, Google, Qwen / Alibaba, DeepSeek, Meta / Llama, Mistral AI, xAI, Cohere, Microsoft или Perplexity;
2. выбрать модель из списка свежих моделей для текстовой работы.

CLI получает список моделей из OpenRouter, фильтрует модели под текстовую работу и показывает до 30 самых свежих вариантов выбранного разработчика. В строке модели показываются дата релиза и размер контекста. В списке моделей `0` возвращает к выбору разработчика, а в списке разработчиков `0` отменяет выбор.

## Codex CLI

```bash
codex login
iola ai setup codex --model gpt-5.5
iola setup codex
iola ask "проверь данные школы 29" --profile codex
```

## Переключение

```bash
iola ai profiles
iola ai profile use local
iola ai profile use openrouter
```

В интерактивном агенте можно использовать `/model`, чтобы выбрать подключение и модель без ручного ввода id модели. Порядок меню: локальные модели, российские AI, зарубежные API, Codex CLI.
