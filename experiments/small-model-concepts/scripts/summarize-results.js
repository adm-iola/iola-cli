import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUMMARY_FILE = path.join(ROOT, 'results', 'latest-summary.json');

const summary = JSON.parse(await fs.readFile(SUMMARY_FILE, 'utf8'));
const rows = Object.values(summary.concepts)
  .sort((a, b) => a.dataset.localeCompare(b.dataset) || b.accuracy - a.accuracy || a.concept.localeCompare(b.concept));

console.log(`Run: ${summary.runId}`);
console.log('');
console.log('| Dataset | Block | Concept | Correct | Accuracy | Answer rate | Escalated | Clarify | Avg ms |');
console.log('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const row of rows) {
  console.log(`| ${row.dataset} | ${row.block} | ${row.concept} | ${row.correct}/${row.total} | ${(row.accuracy * 100).toFixed(1)}% | ${(row.answerRate * 100).toFixed(1)}% | ${row.escalated} | ${row.needsClarification} | ${row.avgLatencyMs} |`);
}
