# Troubleshooting

## Команда iola не найдена

Проверьте глобальную установку:

```bash
npm install -g @iola_adm/iola-cli
npm bin -g
```

## Нужна новая версия Node.js

```bash
node --version
iola init --upgrade-node
```

## Ollama недоступна

```bash
ollama --version
ollama serve
iola ai doctor
```

## OpenAI/OpenRouter key не найден

```bash
iola ai key status
iola ai key set openai
iola ai key set openrouter
```

## Нет локальных данных

```bash
iola sync
iola sync status
iola search "школа" --local
```

## Нужен подробный лог

```bash
iola --debug --debug-file iola-debug.log doctor
```
