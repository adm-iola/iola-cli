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

Официальные страницы:

- документация Foundation Models: `https://yandex.cloud/ru/docs/foundation-models/`;
- аутентификация API: `https://yandex.cloud/ru/docs/ai-studio/api-ref/authentication`;
- тарифы: `https://yandex.cloud/ru/docs/foundation-models/pricing`.

Для CLI нужны API key и ID каталога Yandex Cloud:

```bash
iola ai key set yandexgpt
iola ai setup yandexgpt --model yandexgpt-lite/latest
```

CLI также понимает env-переменные `YANDEXGPT_API_KEY` или `YANDEX_CLOUD_API_KEY`, а для каталога - `YANDEXGPT_FOLDER_ID` или `YANDEX_CLOUD_FOLDER_ID`.

### GigaChat

Официальные страницы:

- документация GigaChat: `https://developers.sber.ru/docs/ru/gigachat/overview`;
- получение OAuth-токена: `https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token`;
- тарифы: `https://developers.sber.ru/docs/ru/gigachat/tariffs`.

Для CLI нужен authorization key:

```bash
iola ai key set gigachat
iola ai setup gigachat --model GigaChat-2
```

CLI также понимает env-переменные `GIGACHAT_AUTH_KEY` или `GIGACHAT_API_KEY`. По умолчанию используется scope `GIGACHAT_API_PERS`; при необходимости его можно задать через `GIGACHAT_SCOPE`.

По тарифам: у GigaChat для физических лиц есть Freemium-лимит на токены; для больших объемов используются платные пакеты. У YandexGPT тарификация идет через Yandex Cloud по токенам и квотам аккаунта, поэтому актуальные бесплатные гранты или лимиты нужно проверять в консоли Yandex Cloud.

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
