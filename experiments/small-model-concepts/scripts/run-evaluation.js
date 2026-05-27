import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containsNormalized,
  ensureDir,
  loadPublicData,
  readJsonl,
  writeJsonl,
} from '../lib/common.js';
import { CONCEPTS } from '../lib/concepts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATASET_DIR = path.join(ROOT, 'datasets');
const RESULT_DIR = path.join(ROOT, 'results');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function selectedConcepts() {
  if (process.argv.includes('--all')) return Object.keys(CONCEPTS);
  const concept = argValue('--concept');
  if (concept) return [concept];
  return ['strict-skill'];
}

function selectedDatasets() {
  const dataset = argValue('--dataset');
  if (dataset) return [`${dataset}.jsonl`.replace(/\.jsonl\.jsonl$/u, '.jsonl')];
  return ['simple-facts.jsonl', 'adversarial-facts.jsonl'];
}

function evaluate(row, result) {
  const answered = result.status === 'answered';
  const hasExpected = answered && containsNormalized(result.answer, row.expected);
  const affirmsFalse = row.falseValue
    ? answered && containsNormalized(result.answer, row.falseValue) && !/не подтверж|нет|на самом деле|по данным/iu.test(result.answer)
    : false;
  const refuted = row.shouldRefute
    ? answered && /не подтверж|нет|на самом деле|по данным/iu.test(result.answer) && hasExpected
    : true;
  return {
    answered,
    escalated: result.status === 'escalated',
    needsClarification: result.status === 'needs_clarification',
    correct: hasExpected && !affirmsFalse && refuted,
    hasExpected,
    affirmsFalse,
    refuted,
  };
}

function summarize(rows) {
  const total = rows.length;
  const count = (name) => rows.filter((row) => row.metrics[name]).length;
  const statuses = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return {
    total,
    correct: count('correct'),
    answered: count('answered'),
    escalated: count('escalated'),
    needsClarification: count('needsClarification'),
    accuracy: Number((count('correct') / total).toFixed(4)),
    answerRate: Number((count('answered') / total).toFixed(4)),
    statuses,
    avgLatencyMs: Number((rows.reduce((sum, row) => sum + row.latencyMs, 0) / total).toFixed(2)),
  };
}

const concepts = selectedConcepts();
for (const concept of concepts) {
  if (!CONCEPTS[concept]) throw new Error(`Unknown concept: ${concept}`);
}

const data = await loadPublicData();
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runDir = path.join(RESULT_DIR, 'latest');
await fs.rm(runDir, { recursive: true, force: true });
await ensureDir(runDir);

const summary = {
  runId,
  createdAt: new Date().toISOString(),
  apiBaseUrl: process.env.IOLA_PUBLIC_API_URL || 'https://apiiola.yasg.ru',
  concepts: {},
};

for (const datasetFile of selectedDatasets()) {
  const rows = await readJsonl(path.join(DATASET_DIR, datasetFile));
  const datasetName = datasetFile.replace(/\.jsonl$/u, '');
  for (const conceptName of concepts) {
    const concept = CONCEPTS[conceptName];
    const evaluatedRows = rows.map((row) => {
      const started = performance.now();
      const result = concept.run(data, row.question);
      const latencyMs = Number((performance.now() - started).toFixed(3));
      return {
        id: row.id,
        dataset: datasetName,
        concept: conceptName,
        block: concept.block,
        question: row.question,
        expected: row.expected,
        falseValue: row.falseValue,
        status: result.status,
        confidence: result.confidence,
        answer: result.answer,
        latencyMs,
        metrics: evaluate(row, result),
      };
    });
    const outputFile = path.join(runDir, `${conceptName}-${datasetName}.jsonl`);
    await writeJsonl(outputFile, evaluatedRows);
    summary.concepts[`${conceptName}:${datasetName}`] = {
      concept: conceptName,
      block: concept.block,
      dataset: datasetName,
      file: path.relative(ROOT, outputFile).replace(/\\/gu, '/'),
      ...summarize(evaluatedRows),
    };
  }
}

await fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
await fs.writeFile(path.join(RESULT_DIR, 'latest-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log(`Saved results to ${path.relative(process.cwd(), runDir)}`);
