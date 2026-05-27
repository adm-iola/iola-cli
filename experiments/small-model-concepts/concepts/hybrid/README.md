# Блок 3. Hybrid / Смешанные концепции

## `skill-router`

CLI до модели определяет skill и вызывает MCP. Модель используется только для языка.

## `memory-verified`

Conditional-memory поиск + verifier. Если verifier не подтверждает ответ, возвращается "данные не подтверждают".

## `escalation-ladder`

Лестница:

```text
0 direct fact
1 strict skill
2 verifier
3 council
4 bigger local MoE / Codex / API
```

Гипотеза: это лучший продуктовый режим, потому что он экономит ресурсы и не дает слабой модели отвечать там, где она опасна.
