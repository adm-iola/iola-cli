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
