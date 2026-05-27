# Лаборатория концепций для маленьких локальных моделей

Цель: сравнить несколько способов повысить качество ответов маленьких локальных моделей на данных Йошкар-Олы.

Лаборатория разделена на три блока:

1. `concepts/model-architecture` - идеи из sparse/MoE/conditional-memory подходов.
2. `concepts/agent-consensus` - идеи verifier, council и multi-agent consensus.
3. `concepts/hybrid` - смешанные схемы: MCP-first, skill-router, verifier, escalation.

Тестовые наборы:

- `datasets/simple-facts.jsonl` - 100 пользовательских вопросов с разными формулировками, ошибками и разговорным стилем.
- `datasets/adversarial-facts.jsonl` - 100 вопросов с ловушками: ложные предпосылки, смешение слоев, конфликтные утверждения.

Запуск:

```powershell
node experiments/small-model-concepts/scripts/generate-datasets.js
node experiments/small-model-concepts/scripts/run-evaluation.js --concept strict-skill --dataset simple-facts
node experiments/small-model-concepts/scripts/run-evaluation.js --all
node experiments/small-model-concepts/scripts/summarize-results.js
```

По умолчанию прототипы не вызывают локальную модель: они тестируют надежность поиска, маршрутизации, строгой проверки и формата ответа. Модельные концепции с реальным Ollama/Codex можно включать отдельным флагом после утверждения набора тестов.

Интерпретация первого прогона:

- 100 обычных вопросов проверяют, умеет ли схема найти слой, номер организации и нужное поле при разговорных формулировках и опечатках.
- 100 вопросов с ловушками проверяют, повторяет ли схема ложную предпосылку пользователя или сверяет ее с MCP-данными.
- `conditional-memory` и `early-exit` намеренно не опровергают ложные предпосылки: они показывают риск подхода "модель помнит и сразу отвечает".
- `verify`, `council`, `skill-router`, `memory-verified` и `escalation-ladder` используют обязательную проверку факта перед ответом.

Последний подробный прогон лежит в `results/latest`, сводка - в `results/latest-summary.json`.
