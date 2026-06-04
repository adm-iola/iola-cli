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

Рекомендуемый путь - через `Yandex Cloud Connector`:

```bash
iola yandex cloud setup
```

В интерактивном агенте можно выбрать YandexGPT через `/model`. Если Cloud Connector еще не подключен, CLI предложит открыть настройку.

Для CLI нужны две вещи: API key и ID каталога Yandex Cloud. Тот же мастер Cloud Connector может дополнительно сохранить ключ геокодера, чтобы geo-skills и Яндекс Go deeplink работали сразу.

Пошаговая настройка:

1. Откройте консоль Yandex Cloud: `https://console.yandex.cloud/`.
2. Войдите в аккаунт Яндекса.
3. Если Yandex Cloud попросит создать облако, создайте облако. Название может быть любым, например `iola-cli`.
4. Откройте каталог внутри облака. Если каталога нет, создайте каталог. Название может быть любым, например `default`.
5. На верхней панели страницы каталога найдите название каталога и его идентификатор. В нашем примере рядом с `default` был показан ID вида `b1g8...`.
6. Нажмите кнопку `Копировать` рядом с идентификатором каталога. Это значение будет `YANDEXGPT_FOLDER_ID`.
7. В левом меню или через поиск сервисов откройте `Identity and Access Management`.
8. Внутри `Identity and Access Management` откройте раздел `Сервисные аккаунты`.
9. Нажмите `Создать сервисный аккаунт`.
10. В поле `Имя` введите понятное имя, например `iola-cli`.
11. В поле `Описание` можно написать `API-доступ iola-cli к YandexGPT`.
12. В блоке `Роли в каталоге` нажмите `Добавить роль`.
13. В поле поиска роли введите `ai.languageModels.user`.
14. В найденной группе `ai.languageModels` выберите роль `user`. В форме должна появиться роль `ai.languageModels.user`.
15. Нажмите `Создать`.
16. После создания откройте созданный сервисный аккаунт `iola-cli`.
17. На странице сервисного аккаунта нажмите кнопку `Создать новый ключ`.
18. В выпадающем меню выберите `Создать API-ключ`. Не выбирайте `Создать статический ключ доступа` и не выбирайте `Создать авторизованный ключ`.
19. В поле `Описание` напишите, например, `iola-cli YandexGPT API key`.
20. В поле `Область действия` выберите `yc.ai.foundationModels.execute`. Если список пустой, начните вводить это значение в поле фильтра и выберите найденный вариант.
21. Поле `Срок действия` можно оставить пустым или выбрать дату окончания действия ключа по вашей политике безопасности.
22. Нажмите `Создать`.
23. Yandex Cloud покажет `Идентификатор ключа` и `Ваш секретный ключ`. Секретный ключ показывается только один раз.
24. Скопируйте `Ваш секретный ключ` и сохраните его локально. Это значение будет `YANDEXGPT_API_KEY`.
25. Сохраните ключ в CLI:

```bash
iola ai key set yandexgpt
```

CLI попросит ввести:

- `YANDEXGPT_API_KEY` - API-ключ сервисного аккаунта;
- `YANDEXGPT_FOLDER_ID` - ID каталога Yandex Cloud.

Важно: `Идентификатор ключа` - это не API-ключ для CLI. Для CLI нужен именно `Ваш секретный ключ`. Если закрыть окно создания ключа, секретный ключ больше нельзя посмотреть. В этом случае удалите старый API-ключ и создайте новый.

После сохранения ключа выберите профиль и модель:

```bash
iola yandex cloud enable yandexgpt
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

Подробно про единый путь геокодера и YandexGPT: [Yandex Cloud Connector](Yandex-Cloud-Connector).

### GigaChat

Для CLI нужен authorization key. Это не одноразовый OAuth access token: CLI сам получает OAuth-токен перед запросом, используя сохраненный authorization key.

Пошаговая настройка:

1. Перейдите на портал разработчиков Сбера: `https://developers.sber.ru/`.
2. Войдите в аккаунт. Если вход еще не выполнен, портал откроет страницу авторизации: `https://developers.sber.ru/studio/login`.
3. Откройте страницу GigaChat API. Прямой путь: `https://developers.sber.ru/studio/workspaces/my-space/get/gigachat-api`.
4. Нажмите кнопку подключения или `Попробовать`. После входа откроется форма создания проекта.
5. В форме `Почти готово` заполните `Название проекта`. Можно оставить предложенное название `Мой GigaChat API` или указать `iola-cli`.
6. В блоке `Группа проекта` нажмите `Выбрать группу`.
7. Если есть вариант `Без группы`, выберите его. Если создание проекта после этого недоступно, выберите `Создать группу`, задайте понятное имя, например `iola-cli`, и сохраните группу.
8. Нажмите `Создать проект`.
9. После создания проекта откроется страница GigaChat API. В верхней части будет название проекта, например `Мой GigaChat API`.
10. На странице проекта нажмите `Настроить API`. Если кнопки не видно, откройте раздел настроек проекта GigaChat API в левом меню.
11. На странице `Настройка API` найдите блок `Данные для авторизации запросов к API`.
12. Проверьте поле `Scope`. Для личного Freemium-доступа обычно указан `GIGACHAT_API_PERS`. Это значение понадобится CLI.
13. В блоке `Ключ авторизации` нажмите `Получить ключ`.
14. Откроется окно `Сохраните ваш Authorization Key`. Не закрывайте его, пока не сохраните данные.
15. Скопируйте поле `Authorization Key`. Это и есть значение `GIGACHAT_AUTH_KEY` для CLI.
16. При желании также сохраните `Client ID` и `Client Secret`, но CLI они не нужны, если вы уже скопировали `Authorization Key`.
17. Нажмите `Готово` только после сохранения ключа.
18. Сохраните ключ локально в CLI:

```bash
iola ai key set gigachat
```

CLI попросит ввести:

- `GIGACHAT_AUTH_KEY` - authorization key;
- `scope` - по умолчанию `GIGACHAT_API_PERS` для персонального доступа.

Важно: `Authorization Key` показывается один раз. Если закрыть окно и не сохранить ключ, его нельзя посмотреть повторно. В этом случае нажмите `Получить новый ключ` и сохраните новое значение. `Authorization Key` - это уже готовая строка для заголовка `Authorization: Basic ...`; вручную кодировать `Client ID:Client Secret` в base64 не нужно.

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

## Yakunin-Router (Карты РФ)

Yakunin-Router - профиль для пользователей, которым нужно оплачивать доступ к моделям российской картой или через СБП. Модели выбираются из каталога OpenRouter, а ключ после оплаты сохраняется локально на компьютере пользователя.

Путь подключения:

1. В CLI откройте `/model`.
2. Выберите `API (OpenAI/OpenRouter/Yakunin-Router)`.
3. Выберите `Yakunin-Router (Карты РФ)`.
4. Выберите один из предложенных вариантов пополнения.
5. CLI откроет платежную ссылку. Если автоматическое открытие не сработало, он покажет ссылку и QR-код в терминале.
6. После успешной оплаты CLI сам сохранит ключ локально.
7. После этого модели выбираются как в OpenRouter: сначала разработчик моделей, потом конкретная текстовая модель.

Пополнение существующего ключа:

```text
/model
3. API (OpenAI/OpenRouter/Yakunin-Router)
Пополнить баланс Yakunin-Router
```

Важно: пользовательский ключ хранится локально в `~/.iola/secrets.json`. Пользователю не нужно вручную получать ключ OpenRouter или настраивать иностранный способ оплаты.

## Оплата

Важно: оплата российскими банковскими картами для OpenAI Platform и OpenRouter может быть невозможна. Перед настройкой платных API заранее проверьте доступный способ оплаты и пополнения баланса в личном кабинете выбранного сервиса. Для пользователей с российскими картами в CLI добавлен отдельный профиль Yakunin-Router.

Ключи YandexGPT, GigaChat, OpenAI, OpenRouter и Yakunin-Router сохраняются локально на устройстве пользователя в `~/.iola/secrets.json`. CLI не публикует ключи в репозиторий и не записывает их в документацию.

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
