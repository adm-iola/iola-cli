#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(rootDir, "bin", "iola.js");
const node = process.execPath;
const frames = ["|", "/", "-", "\\"];

const steps = [
  {
    title: "Подготовка локальной БД",
    args: [cliPath, "db", "init", "--silent"],
  },
  {
    title: "Проверка браузерного runtime",
    args: [cliPath, "browser", "install"],
  },
  {
    title: "Проверка локальной модели IOLA",
    args: [cliPath, "ai", "setup", "iola", "--yes", "--quiet", "--optional"],
  },
];

const canAnimate = process.stdout.isTTY && process.env.CI !== "true";

console.log("");
console.log("IOLA CLI: настройка после установки");

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index];
  await runStep(step, index + 1, steps.length);
}

console.log("IOLA CLI готова. Запуск: iola");

async function runStep(step, current, total) {
  const started = Date.now();
  let frame = 0;
  let lastOutput = "";
  const prefix = `[${current}/${total}] ${step.title}`;
  const render = () => {
    if (!canAnimate) return;
    const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
    process.stdout.write(`\r${frames[frame]} ${prefix}... ${seconds}s`);
    frame = (frame + 1) % frames.length;
  };

  if (!canAnimate) {
    console.log(`... ${prefix}`);
  }
  render();
  const timer = setInterval(render, 120);
  const result = await run(node, ["--no-warnings", ...step.args], (chunk) => {
    lastOutput = chunk.trim() || lastOutput;
  });
  clearInterval(timer);

  if (result.code !== 0) {
    if (canAnimate) process.stdout.write(`\r`);
    if (lastOutput) console.error(lastOutput);
    console.error(`× ${prefix}: ошибка установки`);
    process.exit(result.code || 1);
  }

  if (canAnimate) {
    process.stdout.write(`\r✓ ${prefix} готово за ${formatDuration(Date.now() - started)}\n`);
  } else {
    console.log(`✓ ${prefix} готово за ${formatDuration(Date.now() - started)}`);
  }
}

function run(command, args, onOutput) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => onOutput(String(chunk)));
    child.stderr.on("data", (chunk) => onOutput(String(chunk)));
    child.on("close", (code) => resolvePromise({ code }));
    child.on("error", (error) => {
      onOutput(error.message);
      resolvePromise({ code: 1 });
    });
  });
}

function formatDuration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}
