import {
  containsNormalized,
  detectField,
  detectLayer,
  extractQuestionNumber,
  findEntity,
  formatAnswer,
  getFieldValue,
  inferQuestion,
} from './common.js';

function confidence(parts) {
  let score = 0;
  if (parts.layer) score += 0.3;
  if (parts.number) score += 0.3;
  if (parts.field) score += 0.25;
  if (parts.entity) score += 0.15;
  return Number(score.toFixed(2));
}

function answerFromInference(parts, question, options = {}) {
  if (!parts.entity || !parts.field) {
    return {
      status: options.fallbackStatus || 'needs_clarification',
      answer: 'Нужно уточнить слой, номер организации или поле, которое нужно найти.',
      confidence: confidence(parts),
    };
  }
  const falseValue = options.verifyFalsePremise ? findFalsePremise(question, parts.entity, parts.field) : null;
  return {
    status: 'answered',
    answer: formatAnswer(parts.entity, parts.field, {
      refute: Boolean(falseValue),
      falseValue,
    }),
    confidence: confidence(parts),
  };
}

function findFalsePremise(question, entity, field) {
  const value = getFieldValue(entity, field);
  if (!value) return null;
  const normalizedQuestion = String(question ?? '');
  if (containsNormalized(normalizedQuestion, value)) return null;
  if (/(правда|подтверди|проверь|так\?|да или нет)/iu.test(normalizedQuestion)) {
    return 'possible_false_premise';
  }
  return null;
}

function strictSkill(data, question) {
  return answerFromInference(inferQuestion(data, question), question, { verifyFalsePremise: true });
}

function conditionalMemory(data, question) {
  const parts = inferQuestion(data, question);
  if (confidence(parts) < 0.75) {
    return {
      status: 'needs_clarification',
      answer: 'В локальной памяти не хватает уверенности для ответа без уточнения.',
      confidence: confidence(parts),
    };
  }
  return answerFromInference(parts, question);
}

function sparseEscalation(data, question) {
  const parts = inferQuestion(data, question);
  if (confidence(parts) < 0.95) {
    return {
      status: 'escalated',
      answer: 'ESCALATE: вопрос нужно передать более сильной модели или строгому MCP-скиллу.',
      confidence: confidence(parts),
    };
  }
  return answerFromInference(parts, question, { verifyFalsePremise: true });
}

function earlyExit(data, question) {
  const layer = detectLayer(question);
  if (!layer) {
    return {
      status: 'needs_clarification',
      answer: 'Ранний выход: слой данных не определен.',
      confidence: 0,
    };
  }
  const number = extractQuestionNumber(question);
  if (!number) {
    return {
      status: 'needs_clarification',
      answer: 'Ранний выход: номер организации не найден.',
      confidence: 0.3,
    };
  }
  const field = detectField(question);
  if (!field) {
    return {
      status: 'needs_clarification',
      answer: 'Ранний выход: не понял, какое поле нужно.',
      confidence: 0.6,
    };
  }
  return answerFromInference({ layer, number, field, entity: findEntity(data, layer, number) }, question);
}

function verify(data, question) {
  const draft = answerFromInference(inferQuestion(data, question), question);
  if (draft.status !== 'answered') return draft;
  const parts = inferQuestion(data, question);
  const expected = getFieldValue(parts.entity, parts.field);
  if (!containsNormalized(draft.answer, expected)) {
    return strictSkill(data, question);
  }
  const falseValue = findFalsePremise(question, parts.entity, parts.field);
  if (falseValue) return strictSkill(data, question);
  return {
    ...draft,
    answer: `${draft.answer} Проверено по MCP-слою.`,
  };
}

function council(data, question) {
  const router = {
    layer: detectLayer(question),
    field: detectField(question),
    number: extractQuestionNumber(question),
  };
  const retriever = {
    ...router,
    entity: findEntity(data, router.layer, router.number),
  };
  const criticScore = confidence(retriever);
  if (criticScore < 0.75) {
    return {
      status: 'escalated',
      answer: 'Консилиум не согласовал ответ: недостаточно уверенности в маршруте или найденной записи.',
      confidence: criticScore,
    };
  }
  return answerFromInference(retriever, question, { verifyFalsePremise: true });
}

function skillRouter(data, question) {
  const parts = inferQuestion(data, question);
  if (!parts.layer) {
    return {
      status: 'escalated',
      answer: 'Маршрутизатор не выбрал MCP-слой.',
      confidence: confidence(parts),
    };
  }
  return strictSkill(data, question);
}

function memoryVerified(data, question) {
  const memory = conditionalMemory(data, question);
  if (memory.status !== 'answered') return memory;
  return verify(data, question);
}

function escalationLadder(data, question) {
  const early = earlyExit(data, question);
  if (early.status === 'answered') {
    const checked = verify(data, question);
    if (checked.status === 'answered') return checked;
  }
  const agreed = council(data, question);
  if (agreed.status === 'answered') return agreed;
  return sparseEscalation(data, question);
}

export const CONCEPTS = {
  'conditional-memory': {
    block: 'model-architecture',
    run: conditionalMemory,
  },
  'sparse-escalation': {
    block: 'model-architecture',
    run: sparseEscalation,
  },
  'early-exit': {
    block: 'model-architecture',
    run: earlyExit,
  },
  'strict-skill': {
    block: 'agent-consensus',
    run: strictSkill,
  },
  verify: {
    block: 'agent-consensus',
    run: verify,
  },
  council: {
    block: 'agent-consensus',
    run: council,
  },
  'skill-router': {
    block: 'hybrid',
    run: skillRouter,
  },
  'memory-verified': {
    block: 'hybrid',
    run: memoryVerified,
  },
  'escalation-ladder': {
    block: 'hybrid',
    run: escalationLadder,
  },
};
