# Local tool-agent

Режим `--tools` предназначен для локальных моделей Ollama. Маленькая модель не выполняет действия напрямую, а предлагает JSON-план. CLI проверяет план и выполняет только разрешенные встроенные tools.

Пример:

```bash
iola ask "выгрузи школы на Петрова в csv" --profile local --tools
iola ask "найди детсады без телефона" --profile local --tools --reasoning verify
```

Доступные tools:

- `search_local`
- `get_card`
- `export_data`
- `run_report`
- `save_view`

Управление разрешениями:

```bash
iola permissions list
iola permissions deny export_data
iola permissions allow export_data
```

Режимы планирования:

```bash
--reasoning fast
--reasoning verify
--reasoning vote
```

Если Ollama недоступна или модель вернула некорректный JSON, CLI использует fallback-планировщик для типовых запросов.
