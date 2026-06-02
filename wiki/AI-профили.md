# AI profiles

CLI поддерживает несколько AI-профилей одновременно.

## Локальная модель

```bash
iola ai setup ollama
iola ai profile use local
iola ask "найди школы на Петрова"
```

## OpenAI

```bash
iola ai key set openai
iola ai setup openai --model gpt-4.1-mini
iola ask "найди школу 29" --profile openai
```

## OpenRouter

```bash
iola ai key set openrouter
iola ai setup openrouter --model openai/gpt-4.1-mini
iola ai models openrouter --search qwen
```

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

В интерактивном агенте можно использовать `/model`, чтобы выбрать подключение и модель без ручного ввода id модели.
