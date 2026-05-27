# Блок 1. Model Architecture / Sparse-подходы

Эти концепции вдохновлены MoE, conditional memory и early-exit исследованиями 2026 года. Внутри обычного CLI мы не можем переписать слои установленной модели, поэтому тестируем практические аналоги на уровне рантайма.

## `conditional-memory`

Аналог DeepSeek Engram для нашего домена: факты не вспоминаются моделью, а достаются из MCP/API/локального индекса как внешняя память.

Пайплайн:

```text
question -> intent/number/entity parser -> MCP/API lookup -> structured facts -> answer
```

Гипотеза: для городских данных это даст максимальную точность на фактах и минимальные hallucinations.

## `sparse-escalation`

Аналог MoE по смыслу: активируем не всю "систему интеллекта", а минимально нужный уровень.

Пайплайн:

```text
simple fact -> direct skill
ambiguous fact -> verifier
analysis -> bigger local MoE / Codex / API
```

Гипотеза: маленькая модель не должна получать задачи, которые требуют большой модели.

## `early-exit`

Если confidence поиска высокое, отвечаем сразу. Если confidence низкое, не даем слабой модели гадать.

Пайплайн:

```text
MCP facts + confidence >= threshold -> answer
otherwise -> ask clarification / route verify
```

Гипотеза: early stop снижает ошибки и задержку.
