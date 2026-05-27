import fs from 'node:fs/promises';
import path from 'node:path';

export const API_BASE_URL = process.env.IOLA_PUBLIC_API_URL || 'https://apiiola.yasg.ru';

export const FIELD_LABELS = {
  head: 'руководитель',
  address: 'адрес',
  phone: 'телефон',
  email: 'email',
  website: 'сайт',
  inn: 'ИНН',
  license_status: 'статус лицензии',
  license_number: 'номер лицензии',
};

export const LAYER_LABELS = {
  schools: {
    singular: 'школа',
    plural: 'школы',
    person: 'директор',
  },
  kindergartens: {
    singular: 'детский сад',
    plural: 'детские сады',
    person: 'заведующий',
  },
};

export const ORDINAL_WORDS = new Map([
  ['перв', 1],
  ['втор', 2],
  ['трет', 3],
  ['четверт', 4],
  ['пят', 5],
  ['шест', 6],
  ['седьм', 7],
  ['восьм', 8],
  ['девят', 9],
  ['десят', 10],
]);

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function writeJsonl(file, rows) {
  await ensureDir(path.dirname(file));
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, body, 'utf8');
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[«»"']/gu, '')
    .replace(/[^\p{L}\p{N}@.:/+ -]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function containsNormalized(haystack, needle) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return normalizedHaystack.includes(normalizedNeedle);
}

export function extractOrgNumber(value) {
  const text = String(value ?? '');
  const match = text.match(/(?:№|номер|n)\s*(\d{1,3})(?!\d)/iu);
  if (match) return Number(match[1]);
  return null;
}

export function extractQuestionNumber(question) {
  const text = normalizeText(question);
  const direct = text.match(/(?:№|номер|n)?\s*(\d{1,3})(?!\d)/iu);
  if (direct) return Number(direct[1]);
  for (const [stem, number] of ORDINAL_WORDS.entries()) {
    if (text.includes(stem)) return number;
  }
  return null;
}

export function detectLayer(question) {
  const text = normalizeText(question);
  if (/(детск|детсад|садик|доу)/u.test(text)) return 'kindergartens';
  if (/(школ|лице|гимназ)/u.test(text)) return 'schools';
  if (/(заведующ)/u.test(text)) return 'kindergartens';
  if (/(директор)/u.test(text)) return 'schools';
  return null;
}

export function detectField(question) {
  const text = normalizeText(question);
  if (/(директор|директр|заведующ|руковод|глава|начальник|кто ведет|кто главный)/u.test(text)) return 'head';
  if (/(адрес|где находится|где расположен|куда ехать|улиц)/u.test(text)) return 'address';
  if (/(телефон|позвон|номер телефона|связаться)/u.test(text)) return 'phone';
  if (/(почт|email|e-mail|мейл|емейл|куда писать|писать в)/u.test(text)) return 'email';
  if (/(сайт|website|страниц)/u.test(text)) return 'website';
  if (/(инн|inn|налогов)/u.test(text)) return 'inn';
  if (/(статус лиценз|лицензи.*статус|лицензия.*действ|лицензи.*действ)/u.test(text)) return 'license_status';
  if (/(номер лиценз|лицензи.*номер)/u.test(text)) return 'license_number';
  return null;
}

export function getFieldValue(entity, field) {
  return entity?.fields?.[field] ?? null;
}

export function formatAnswer(entity, field, options = {}) {
  const value = getFieldValue(entity, field);
  const label = FIELD_LABELS[field] || field;
  const layer = LAYER_LABELS[entity.layer]?.singular || entity.layer;
  const intro = `${capitalize(layer)} ${entity.shortName}`;
  if (!value) return `По данным слоя ${entity.layer} поле "${label}" не заполнено для ${entity.shortName}.`;
  if (options.refute && options.falseValue) {
    return `Нет, это не подтверждается. По данным MCP: ${intro}, ${label}: ${value}.`;
  }
  return `${intro}: ${label} - ${value}.`;
}

export function capitalize(value) {
  const text = String(value ?? '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export function normalizeEntity(layer, item) {
  const name = item.fns_short_name || item.fns_full_name || item.name || '';
  return {
    layer,
    key: `${layer}:${item.inn || name}`,
    number: extractOrgNumber(name),
    shortName: name,
    fullName: item.fns_full_name || name,
    fields: {
      head: item.fns_head_name || null,
      address: item.address || null,
      phone: item.phone || null,
      email: item.email || null,
      website: item.website || null,
      inn: item.inn || null,
      license_number: item.license_number || null,
      license_status: item.license_status || null,
    },
    raw: item,
  };
}

export async function fetchLayer(layer) {
  const response = await fetch(`${API_BASE_URL}/api/v1/${layer}?limit=500`);
  if (!response.ok) {
    throw new Error(`API ${layer} failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return (payload.data || []).map((item) => normalizeEntity(layer, item));
}

export async function loadPublicData() {
  const [schools, kindergartens] = await Promise.all([
    fetchLayer('schools'),
    fetchLayer('kindergartens'),
  ]);
  return { schools, kindergartens };
}

export function findEntity(data, layer, number) {
  if (!layer || !number) return null;
  return data[layer]?.find((entity) => entity.number === number) || null;
}

export function inferQuestion(data, question) {
  const layer = detectLayer(question);
  const field = detectField(question);
  const number = extractQuestionNumber(question);
  return {
    layer,
    field,
    number,
    entity: findEntity(data, layer, number),
  };
}
