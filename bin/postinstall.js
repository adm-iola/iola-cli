#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import os from "node:os";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(rootDir, "bin", "iola.js");
const oauthIconSource = resolve(rootDir, "docs", "assets", "iola-oauth-icon.png");
const iolaHome = getIolaHomeDir();
const oauthIconTarget = join(iolaHome, "assets", "iola-oauth-icon.png");
const certsDir = join(iolaHome, "certs");
const trustedCaBundle = join(certsDir, "russian-trusted-ca-bundle.pem");
const node = process.execPath;
const frames = ["|", "/", "-", "\\"];
const russianTrustedCertificates = [
  {
    name: "russian_trusted_root_ca_pem.crt",
    url: "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt",
  },
  {
    name: "russian_trusted_sub_ca_pem.crt",
    url: "https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt",
  },
];

const steps = [
  {
    title: "Подготовка локальной БД",
    args: [cliPath, "db", "init", "--silent"],
    timeoutMs: 60_000,
  },
  {
    title: "Установка иконки Yandex OAuth",
    local: installOauthIcon,
  },
  {
    title: "Установка сертификатов НУЦ Минцифры для GigaChat",
    local: installRussianTrustedCertificates,
    optional: true,
    retryHint: "Повторите позже: iola security doctor или переустановите пакет при доступном интернете.",
  },
];

const canAnimate = process.stdout.isTTY && process.env.CI !== "true";
const setupStarted = process.hrtime.bigint();

console.log("");
console.log("IOLA CLI: настройка после скачивания npm-пакета");
console.log("Важно: это не полное время npm install. Скачивание, распаковку и служебные действия npm этот скрипт измерить не может.");
console.log("Локальная модель и browser runtime не устанавливаются автоматически. Их можно включить позже в мастере настройки.");

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index];
  await runStep(step, index + 1, steps.length);
}

console.log(`Настройка CLI после скачивания заняла ${formatDuration(elapsedMs(setupStarted))}. Запуск: iola`);

async function runStep(step, current, total) {
  const started = process.hrtime.bigint();
  let frame = 0;
  let lastOutput = "";
  const prefix = `[${current}/${total}] ${step.title}`;
  const render = () => {
    if (!canAnimate) return;
    const seconds = Math.max(1, Math.floor(elapsedMs(started) / 1000));
    process.stdout.write(`\r${frames[frame]} ${prefix}... ${seconds}s`);
    frame = (frame + 1) % frames.length;
  };

  if (!canAnimate) {
    console.log(`... ${prefix}`);
  }
  render();
  const timer = setInterval(render, 120);
  const result = step.local
    ? await runLocalStep(step.local)
    : await run(node, ["--no-warnings", ...step.args], (chunk) => {
      lastOutput = chunk.trim() || lastOutput;
    }, step.timeoutMs);
  clearInterval(timer);

  if (result.code !== 0) {
    if (canAnimate) process.stdout.write(`\r`);
    if (lastOutput) console.error(lastOutput);
    if (step.optional) {
      console.warn(`! ${prefix}: пропущено (${result.error || "ошибка установки"})`);
      if (step.retryHint) console.warn(`  ${step.retryHint}`);
      return;
    }
    console.error(`× ${prefix}: ошибка установки`);
    process.exit(result.code || 1);
  }

  if (canAnimate) {
    process.stdout.write(`\r✓ ${prefix} готово за ${formatDuration(elapsedMs(started))}\n`);
  } else {
    console.log(`✓ ${prefix} готово за ${formatDuration(elapsedMs(started))}`);
  }
}

async function runLocalStep(fn) {
  try {
    await fn();
    return { code: 0 };
  } catch (error) {
    return { code: 1, error };
  }
}

function installOauthIcon() {
  if (!existsSync(oauthIconSource)) return;
  mkdirSync(dirname(oauthIconTarget), { recursive: true });
  copyFileSync(oauthIconSource, oauthIconTarget);
}

async function installRussianTrustedCertificates() {
  mkdirSync(certsDir, { recursive: true });
  const certificateTexts = [];
  for (const certificate of russianTrustedCertificates) {
    const target = join(certsDir, certificate.name);
    if (!existsSync(target) || !isPemCertificate(readFileSync(target, "utf8"))) {
      const text = await downloadText(certificate.url, 20_000);
      if (!isPemCertificate(text)) throw new Error(`Некорректный PEM certificate: ${certificate.url}`);
      writeFileSync(target, normalizePem(text), "utf8");
    }
    certificateTexts.push(normalizePem(readFileSync(target, "utf8")));
  }
  writeFileSync(trustedCaBundle, `${certificateTexts.join("\n")}\n`, "utf8");
}

function isPemCertificate(text) {
  return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/u.test(String(text || ""));
}

function normalizePem(text) {
  return String(text || "").trim().replace(/\r\n/g, "\n");
}

async function downloadText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function run(command, args, onOutput, timeoutMs = 0) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill();
      onOutput(`timeout after ${formatDuration(timeoutMs)}`);
      resolvePromise({ code: 124, error: "timeout" });
    }, timeoutMs) : null;

    child.stdout.on("data", (chunk) => onOutput(String(chunk)));
    child.stderr.on("data", (chunk) => onOutput(String(chunk)));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code });
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      onOutput(error.message);
      resolvePromise({ code: 1, error: error.message });
    });
  });
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const seconds = Math.floor(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function getIolaHomeDir() {
  const raw = String(process.env.IOLA_HOME || "").trim();
  if (!raw) return join(os.homedir(), ".iola");
  if (raw === "~") return os.homedir();
  if (raw.startsWith(`~${process.platform === "win32" ? "\\" : "/"}`) || raw.startsWith("~/")) {
    return resolve(join(os.homedir(), raw.slice(2)));
  }
  return resolve(raw);
}
