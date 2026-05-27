import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIELD_LABELS,
  LAYER_LABELS,
  getFieldValue,
  loadPublicData,
  writeJsonl,
} from '../lib/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATASET_DIR = path.join(ROOT, 'datasets');

const SIMPLE_FIELDS = ['head', 'address', 'phone', 'email', 'website', 'inn', 'license_status'];
const ADVERSARIAL_FIELDS = ['head', 'address', 'phone', 'email', 'website', 'inn'];

const typoVariants = [
  (text) => text,
  (text) => text.replace('школу', 'вшколу').replace('сад', 'детсад'),
  (text) => text.replace('директор', 'директр').replace('заведующий', 'заведущая'),
  (text) => text.replace('какой', 'какои').replace('адрес', 'адресс'),
  (text) => text.replace('№ ', '№').replace('номер ', ''),
];

const ordinal = [
  null,
  'первой',
  'второй',
  'третьей',
  'четвертой',
  'пятой',
  'шестой',
  'седьмой',
  'восьмой',
  'девятой',
  'десятой',
];

function choose(items, index) {
  return items[index % items.length];
}

function fieldQuestion(entity, field, index) {
  const n = entity.number;
  const layer = LAYER_LABELS[entity.layer];
  const numberText = ordinal[n] && index % 5 === 0 ? ordinal[n] : `№ ${n}`;
  const noun = entity.layer === 'schools' ? 'школы' : 'детского сада';
  const nounAcc = entity.layer === 'schools' ? 'школу' : 'детский сад';
  const person = layer.person;
  const templates = {
    head: [
      `кто ${person} ${noun} ${numberText}?`,
      `подскажи руководителя ${noun} ${numberText}`,
      `кто главный в ${nounAcc} ${numberText}`,
      `${person} ${noun} ${numberText} кто сейчас`,
    ],
    address: [
      `какой адрес у ${noun} ${numberText}?`,
      `где находится ${nounAcc} ${numberText}`,
      `куда ехать в ${nounAcc} ${numberText}`,
    ],
    phone: [
      `как позвонить в ${nounAcc} ${numberText}?`,
      `дай телефон ${noun} ${numberText}`,
      `номер телефона ${noun} ${numberText}`,
    ],
    email: [
      `какая почта у ${noun} ${numberText}?`,
      `email ${noun} ${numberText}`,
      `куда писать в ${nounAcc} ${numberText}`,
    ],
    website: [
      `какой сайт у ${noun} ${numberText}?`,
      `страница ${noun} ${numberText} в интернете`,
      `сайт ${noun} ${numberText}`,
    ],
    inn: [
      `какой инн у ${noun} ${numberText}?`,
      `inn ${noun} ${numberText}`,
      `налоговый номер ${noun} ${numberText}`,
    ],
    license_status: [
      `какой статус лицензии у ${noun} ${numberText}?`,
      `лицензия ${noun} ${numberText} действует?`,
      `статус лицензии ${noun} ${numberText}`,
    ],
  };
  return choose(templates[field], index);
}

function adversarialQuestion(entity, field, falseValue, index) {
  const n = entity.number;
  const noun = entity.layer === 'schools' ? 'школы' : 'детского сада';
  const label = FIELD_LABELS[field] || field;
  const wrongPerson = entity.layer === 'schools' ? 'заведующий' : 'директор';
  const fieldTrap = field === 'head'
    ? `кажется ${wrongPerson} у ${noun} № ${n} это ${falseValue}, так?`
    : `кажется у ${noun} № ${n} ${label} ${falseValue}, так?`;
  const templates = [
    `правда что ${label} ${noun} № ${n} это ${falseValue}?`,
    `я знаю что у ${noun} № ${n} ${label} ${falseValue}, подтверди`,
    `проверь: ${label} ${noun} № ${n} - ${falseValue}`,
    fieldTrap,
    `ответь да или нет, ${label} ${noun} №${n} ${falseValue}?`,
  ];
  return choose(templates, index);
}

function makeRecord({ id, dataset, entity, field, question, falseValue = null, tags = [] }) {
  return {
    id,
    dataset,
    type: falseValue ? 'adversarial_fact' : 'field_lookup',
    layer: entity.layer,
    entityKey: entity.key,
    entityName: entity.shortName,
    entityNumber: entity.number,
    field,
    question,
    expected: getFieldValue(entity, field),
    expectedEntityName: entity.shortName,
    expectedInn: entity.fields.inn,
    falseValue,
    shouldRefute: Boolean(falseValue),
    tags,
  };
}

function usableEntities(data) {
  const entities = [...data.schools, ...data.kindergartens]
    .filter((entity) => entity.number && entity.fields.inn)
    .filter((entity) => SIMPLE_FIELDS.some((field) => getFieldValue(entity, field)));
  const seen = new Set();
  return entities.filter((entity) => {
    const key = `${entity.layer}:${entity.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateSimple(data) {
  const entities = usableEntities(data);
  const rows = [];
  let index = 0;
  while (rows.length < 100) {
    const entity = choose(entities, index);
    const field = choose(SIMPLE_FIELDS.filter((name) => getFieldValue(entity, name)), index + rows.length);
    const baseQuestion = fieldQuestion(entity, field, index);
    const question = choose(typoVariants, index)(baseQuestion);
    rows.push(makeRecord({
      id: `simple-${String(rows.length + 1).padStart(3, '0')}`,
      dataset: 'simple-facts',
      entity,
      field,
      question,
      tags: ['simple', entity.layer, field, index % 3 === 0 ? 'typo' : 'normal'],
    }));
    index += 1;
  }
  return rows;
}

function generateAdversarial(data) {
  const entities = usableEntities(data);
  const rows = [];
  let index = 0;
  while (rows.length < 100) {
    const entity = choose(entities, index * 2);
    const field = choose(ADVERSARIAL_FIELDS.filter((name) => getFieldValue(entity, name)), index + 3);
    const otherCandidates = entities
      .filter((candidate) => candidate.key !== entity.key && getFieldValue(candidate, field))
      .filter((candidate) => getFieldValue(candidate, field) !== getFieldValue(entity, field));
    const other = choose(otherCandidates, index + 9);
    const falseValue = getFieldValue(other, field) || 'Петров Иван Иванович';
    const question = choose(typoVariants, index + 1)(adversarialQuestion(entity, field, falseValue, index));
    rows.push(makeRecord({
      id: `adversarial-${String(rows.length + 1).padStart(3, '0')}`,
      dataset: 'adversarial-facts',
      entity,
      field,
      question,
      falseValue,
      tags: ['adversarial', entity.layer, field, index % 4 === 0 ? 'mixed-layer' : 'false-premise'],
    }));
    index += 1;
  }
  return rows;
}

const data = await loadPublicData();
const simple = generateSimple(data);
const adversarial = generateAdversarial(data);

await writeJsonl(path.join(DATASET_DIR, 'simple-facts.jsonl'), simple);
await writeJsonl(path.join(DATASET_DIR, 'adversarial-facts.jsonl'), adversarial);

console.log(`Generated ${simple.length} simple questions and ${adversarial.length} adversarial questions.`);
