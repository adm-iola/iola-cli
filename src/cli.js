import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";
const CONFIG_DIR = path.join(os.homedir(), ".iola");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const BANNER = `\x1b[38;5;45m┌────────────────────────────────────────────────────────────────────────────┐
│\x1b[38;5;51m   ____ _     ___      ____  ____   ___  _____ _  _______                  \x1b[38;5;45m│
│\x1b[38;5;51m  / ___| |   |_ _|    |  _ \\|  _ \\ / _ \\| ____| |/ /_   _|                 \x1b[38;5;45m│
│\x1b[38;5;51m | |   | |    | |_____| |_) | |_) | | | |  _| | ' /  | |                   \x1b[38;5;45m│
│\x1b[38;5;51m | |___| |___ | |_____|  __/|  _ <| |_| | |___| . \\  | |                   \x1b[38;5;45m│
│\x1b[38;5;51m  \\____|_____|___|    |_|   |_| \\_\\\\___/|_____|_|\\_\\ |_|                   \x1b[38;5;45m│
│                                                                            │
│\x1b[38;5;213m                    Й О Ш К А Р - О Л Ы                                    \x1b[38;5;45m│
│                                                                            │
│\x1b[38;5;250m        открытые данные • MCP • локальный AI                               \x1b[38;5;45m│
│                                                                            │
│\x1b[38;5;82m        > iola help                                                         \x1b[38;5;45m│
└────────────────────────────────────────────────────────────────────────────┘\x1b[0m`;

const COMMANDS = new Map([
  ["help", showHelp],
  ["version", showVersion],
  ["banner", showBanner],
  ["agent", startAgent],
  ["ai", handleAi],
  ["health", checkHealth],
  ["layers", listLayers],
  ["schools", listSchools],
  ["kindergartens", listKindergartens],
  ["search", searchAll],
  ["mcp-info", showMcpInfo],
  ["setup", setupClient],
]);

export async function main(argv) {
  const [command = "help", ...args] = argv;
  const handler = COMMANDS.get(command);

  if (!handler) {
    throw new Error(`Unknown command: ${command}\nRun "iola help" to see available commands.`);
  }

  await handler(args);
}

async function showHelp() {
  showBanner();
  console.log(`iola - CLI для открытых данных городского округа "Город Йошкар-Ола"

Usage:
  iola banner
  iola agent
  iola ai doctor [--json]
  iola ai setup
  iola ai setup ollama [--yes] [--model MODEL]
  iola health [--json]
  iola layers [--json]
  iola schools [--limit 10] [--search TEXT] [--json]
  iola schools get --inn INN [--json]
  iola kindergartens [--limit 10] [--search TEXT] [--json]
  iola kindergartens get --inn INN [--json]
  iola search TEXT [--limit 5] [--json]
  iola mcp-info [--json]
  iola setup codex
  iola version

Environment:
  IOLA_API_BASE_URL   default: ${API_BASE_URL}
  IOLA_MCP_BASE_URL   default: ${MCP_BASE_URL}
`);
}

async function startAgent() {
  showBanner();
  console.log("Интерактивный режим. Введите /help для списка команд, /exit для выхода.");

  const rl = readline.createInterface({ input, output, prompt: "iola> " });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  safePrompt(rl);

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (!line) {
      safePrompt(rl, closed);
      continue;
    }

    try {
      const shouldExit = await handleAgentLine(line);
      if (shouldExit) {
        break;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    safePrompt(rl, closed);
  }

  if (!closed) {
    rl.close();
  }
}

async function handleAgentLine(line) {
  if (!line.startsWith("/")) {
    console.log("AI-ответы будут добавлены следующим этапом. Сейчас используйте slash-команды, например /search лицей.");
    return false;
  }

  const [command, ...args] = splitCommandLine(line.slice(1));

  if (command === "exit" || command === "quit") {
    return true;
  }

  if (command === "help") {
    printAgentHelp();
    return false;
  }

  if (command === "banner") {
    showBanner();
    return false;
  }

  if (command === "ai") {
    await handleAi(args);
    return false;
  }

  const mapped = {
    health: ["health", args],
    layers: ["layers", args],
    schools: ["schools", args],
    kindergartens: ["kindergartens", args],
    search: ["search", args],
    "mcp-info": ["mcp-info", args],
    setup: ["setup", args],
  }[command];

  if (!mapped) {
    console.log(`Неизвестная slash-команда: /${command}`);
    printAgentHelp();
    return false;
  }

  const [cliCommand, cliArgs] = mapped;
  await COMMANDS.get(cliCommand)(cliArgs);
  return false;
}

function printAgentHelp() {
  console.log(`Slash-команды:
  /help
  /health
  /layers
  /schools --limit 10
  /schools get --inn 1215067180
  /kindergartens --search 29
  /kindergartens get --inn 1215077421
  /search лицей --limit 3
  /mcp-info
  /ai doctor
  /ai setup ollama
  /banner
  /exit`);
}

function safePrompt(rl, closed = false) {
  if (closed) {
    return;
  }

  try {
    rl.prompt();
  } catch {
    // The input stream can close while an async slash-command is still running.
  }
}

function showBanner() {
  if (process.stdout.isTTY && process.env.NO_COLOR !== "1") {
    console.log(BANNER);
    return;
  }

  console.log("CLI-ПРОЕКТ ЙОШКАР-ОЛЫ");
  console.log("открытые данные • MCP • локальный AI");
}

async function showVersion() {
  const packageJson = await import("../package.json", { with: { type: "json" } });
  console.log(packageJson.default.version);
}

async function checkHealth(args) {
  const options = parseOptions(args);
  const health = await fetchJson(`${MCP_BASE_URL}/mcp-health`);

  if (options.json) {
    printJson(health);
    return;
  }

  printKeyValue({
    status: health.status,
    server_version: health.server_version,
    skill_version: health.skill_version,
    mcp_endpoint: health.mcp_endpoint,
  });
}

async function handleAi(args) {
  const [subcommand = "help", ...rest] = args;

  if (subcommand === "help") {
    showBanner();
    console.log(`AI-команды:
  iola ai doctor [--json]
  iola ai setup
  iola ai setup ollama [--yes] [--model MODEL]

Локальная настройка сохраняется в ${CONFIG_FILE}`);
    return;
  }

  if (subcommand === "doctor") {
    await aiDoctor(rest);
    return;
  }

  if (subcommand === "setup") {
    await aiSetup(rest);
    return;
  }

  throw new Error(`Unknown AI command: ${subcommand}\nRun "iola ai help" to see available commands.`);
}

async function aiDoctor(args) {
  const options = parseOptions(args);
  const diagnostics = await getLocalDiagnostics();
  const recommendation = recommendOllamaModel(diagnostics);

  if (options.json) {
    printJson({ ...diagnostics, recommendation });
    return;
  }

  printDiagnostics(diagnostics, recommendation);
}

async function aiSetup(args) {
  const [provider] = args;

  if (!provider) {
    showBanner();
    const selected = await chooseAiProvider();
    await aiSetup([selected]);
    return;
  }

  if (provider === "ollama") {
    await setupOllama(args.slice(1));
    return;
  }

  if (provider === "openai" || provider === "openrouter") {
    console.log(`Для ${provider} используйте переменную окружения ${provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}.`);
    console.log("AI-запросы через API будут добавлены отдельной командой iola ai ask.");
    return;
  }

  if (provider === "codex") {
    await setupClient(["codex"]);
    return;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

async function chooseAiProvider() {
  console.log("Выберите режим AI:");
  console.log("1. Локальная модель через Ollama");
  console.log("2. OpenAI API");
  console.log("3. OpenRouter API");
  console.log("4. Codex/MCP");

  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("Введите номер [1]: ")).trim() || "1";
    return {
      1: "ollama",
      2: "openai",
      3: "openrouter",
      4: "codex",
    }[answer] || "ollama";
  } finally {
    rl.close();
  }
}

async function setupOllama(args) {
  const options = parseOptions(args);
  const diagnostics = await getLocalDiagnostics();
  const recommendation = recommendOllamaModel(diagnostics);
  const model = options.model || recommendation.model;

  printDiagnostics(diagnostics, { ...recommendation, model });

  if (!diagnostics.ollama.installed) {
    console.log("");
    console.log("Ollama не найден. Установите Ollama, затем повторите команду:");
    console.log("  iola ai setup ollama");
    console.log("");
    console.log("Windows:");
    console.log("  winget install Ollama.Ollama");
    console.log("macOS:");
    console.log("  brew install --cask ollama");
    console.log("Linux:");
    console.log("  curl -fsSL https://ollama.com/install.sh | sh");
    return;
  }

  const shouldInstall = options.yes || (await confirm(`Установить модель ${model} через "ollama pull ${model}"? [Y/n] `));

  if (shouldInstall) {
    await runCommand("ollama", ["pull", model], { inherit: true });
  }

  await saveConfig({
    ai: {
      provider: "ollama",
      model,
      baseUrl: "http://127.0.0.1:11434",
    },
  });

  console.log("");
  console.log(`Готово. Локальный AI-профиль сохранен в ${CONFIG_FILE}`);
}

async function listLayers(args) {
  const options = parseOptions(args);
  const info = await fetchJson(`${MCP_BASE_URL}/mcp-version`);

  if (options.json) {
    printJson(info.data_layers);
    return;
  }

  printTable(info.data_layers, [
    ["id", "ID"],
    ["name", "Название"],
    ["category", "Категория"],
    ["status", "Статус"],
  ]);
}

async function showMcpInfo(args) {
  const options = parseOptions(args);
  const info = await fetchJson(`${MCP_BASE_URL}/mcp-version`);

  if (options.json) {
    printJson(info);
    return;
  }

  printKeyValue({
    server_name: info.server_name,
    server_version: info.server_version,
    skill_version: info.skill_version,
    npm_package: info.npm_package,
    mcp_endpoint: info.mcp_endpoint,
    layers: info.data_layers.map((layer) => layer.id).join(", "),
  });
}

async function listSchools(args) {
  await listDataset("schools", args);
}

async function listKindergartens(args) {
  await listDataset("kindergartens", args);
}

async function listDataset(dataset, args) {
  const options = parseOptions(args);

  if (options._[0] === "get") {
    await getDatasetItem(dataset, options);
    return;
  }

  const params = new URLSearchParams();
  params.set("limit", options.limit || "20");
  params.set("offset", options.offset || "0");

  const data = await fetchJson(`${API_BASE_URL}/${dataset}?${params}`);
  const items = normalizeItems(data);
  const filtered = options.search ? filterItems(items, options.search) : items;
  const limited = filtered.slice(0, Number(options.limit || 20));

  if (options.json) {
    printJson(limited);
    return;
  }

  printDatasetTable(limited);
}

async function getDatasetItem(dataset, options) {
  if (!options.inn) {
    throw new Error(`INN is required. Example: iola ${dataset} get --inn 1215067180`);
  }

  const data = await fetchJson(`${API_BASE_URL}/${dataset}?limit=500&offset=0`);
  const item = normalizeItems(data).find((entry) => String(entry.inn) === String(options.inn));

  if (!item) {
    throw new Error(`Record was not found in ${dataset}: inn=${options.inn}`);
  }

  if (options.json) {
    printJson(item);
    return;
  }

  printKeyValue(selectPublicSummary(item));
}

async function searchAll(args) {
  const options = parseOptions(args);
  const query = options._.join(" ").trim();

  if (!query) {
    throw new Error('Search text is required. Example: iola search "лицей"');
  }

  const [schools, kindergartens] = await Promise.all([
    fetchJson(`${API_BASE_URL}/schools?limit=100&offset=0`),
    fetchJson(`${API_BASE_URL}/kindergartens?limit=100&offset=0`),
  ]);

  const limit = Number(options.limit || 5);
  const result = {
    schools: filterItems(normalizeItems(schools), query).slice(0, limit),
    kindergartens: filterItems(normalizeItems(kindergartens), query).slice(0, limit),
  };

  if (options.json) {
    printJson(result);
    return;
  }

  console.log("Школы");
  printDatasetTable(result.schools);
  console.log("");
  console.log("Детские сады");
  printDatasetTable(result.kindergartens);
}

async function setupClient(args) {
  const [client] = args;

  if (client !== "codex") {
    throw new Error('Only "iola setup codex" is available in this first release.');
  }

  console.log("Run:");
  console.log("  codex mcp add yoshkarOlaPublicData --url https://apiiola.yasg.ru/mcp");
  console.log("  npx -y @iola_adm/yoshkar-ola-public-mcp install-skill codex");
}

function parseOptions(args) {
  const result = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--yes") {
      result[arg.slice(2)] = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--inn") {
      result[arg.slice(2)] = args[index + 1];
      index += 1;
    } else {
      result._.push(arg);
    }
  }

  return result;
}

function splitCommandLine(line) {
  const result = [];
  let current = "";
  let quote = null;

  for (const char of line) {
    if ((char === "\"" || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function filterItems(items, query) {
  const normalized = query.toLocaleLowerCase("ru-RU");
  return items.filter((item) => JSON.stringify(item).toLocaleLowerCase("ru-RU").includes(normalized));
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
}

function selectPublicSummary(item) {
  return {
    inn: item.inn,
    name: item.fns_short_name || item.fns_full_name,
    address: item.address || item.legal_address,
    phone: item.phone,
    email: item.email,
    website: item.website,
    head: item.fns_head_name,
    license_number: item.license_number,
    license_status: item.license_status,
  };
}

async function getLocalDiagnostics() {
  const [nvidia, windowsGpu, ollamaVersion] = await Promise.all([
    getNvidiaGpu(),
    process.platform === "win32" ? getWindowsGpu() : Promise.resolve(null),
    getOllamaVersion(),
  ]);
  const gpu = nvidia || windowsGpu || { name: "-", vramGb: null, source: "not-detected" };

  return {
    os: `${os.type()} ${os.release()} (${process.arch})`,
    cpu: os.cpus()?.[0]?.model || "-",
    ramGb: roundGb(os.totalmem()),
    gpu,
    ollama: {
      installed: Boolean(ollamaVersion),
      version: ollamaVersion || "-",
    },
  };
}

async function getNvidiaGpu() {
  try {
    const { stdout } = await runCommand("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    const [line] = stdout.trim().split(/\r?\n/).filter(Boolean);

    if (!line) {
      return null;
    }

    const [name, memoryMb] = line.split(",").map((value) => value.trim());
    return {
      name,
      vramGb: Math.round((Number(memoryMb) / 1024) * 10) / 10,
      source: "nvidia-smi",
    };
  } catch {
    return null;
  }
}

async function getWindowsGpu() {
  try {
    const command = [
      "$gpu = Get-CimInstance Win32_VideoController |",
      "Sort-Object AdapterRAM -Descending |",
      "Select-Object -First 1 Name,AdapterRAM;",
      "$gpu | ConvertTo-Json -Compress",
    ].join(" ");
    const { stdout } = await runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
    const parsed = JSON.parse(stdout.trim());

    return {
      name: parsed.Name || "-",
      vramGb: parsed.AdapterRAM ? roundGb(Number(parsed.AdapterRAM)) : null,
      source: "Win32_VideoController",
    };
  } catch {
    return null;
  }
}

async function getOllamaVersion() {
  try {
    const { stdout } = await runCommand("ollama", ["--version"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function recommendOllamaModel(diagnostics) {
  const ramGb = diagnostics.ramGb || 0;
  const vramGb = diagnostics.gpu.vramGb || 0;

  if (ramGb >= 32 && vramGb >= 8) {
    return {
      profile: "good",
      model: "qwen3:8b",
      reason: "достаточно RAM/VRAM для более качественной локальной модели.",
    };
  }

  if (ramGb >= 16 && vramGb >= 4) {
    return {
      profile: "balanced",
      model: "qwen3:4b",
      reason: "баланс качества, скорости и памяти для работы с вопросами по данным.",
    };
  }

  if (ramGb >= 12) {
    return {
      profile: "standard",
      model: "llama3.2:3b",
      reason: "достаточно оперативной памяти для компактной универсальной модели.",
    };
  }

  return {
    profile: "low",
    model: "llama3.2:1b",
    reason: "минимальная модель для слабого ПК или CPU-only режима.",
  };
}

function printDiagnostics(diagnostics, recommendation) {
  console.log("Диагностика системы");
  printKeyValue({
    os: diagnostics.os,
    cpu: diagnostics.cpu,
    ram: `${diagnostics.ramGb} GB`,
    gpu: diagnostics.gpu.name,
    vram: diagnostics.gpu.vramGb ? `${diagnostics.gpu.vramGb} GB` : "-",
    ollama: diagnostics.ollama.installed ? diagnostics.ollama.version : "не установлен",
  });
  console.log("");
  console.log("Рекомендация");
  printKeyValue({
    profile: recommendation.profile,
    model: recommendation.model,
    reason: recommendation.reason,
    install: `ollama pull ${recommendation.model}`,
  });
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLocaleLowerCase("ru-RU");
    return answer === "" || answer === "y" || answer === "yes" || answer === "д" || answer === "да";
  } finally {
    rl.close();
  }
}

async function saveConfig(value) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 5,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });

    if (options.inherit) {
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
    }
  });
}

function roundGb(bytes) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "@iola_adm/iola-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }

  return response.json();
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printDatasetTable(items) {
  printTable(items.map(selectPublicSummary), [
    ["inn", "ИНН"],
    ["name", "Название"],
    ["address", "Адрес"],
    ["phone", "Телефон"],
  ]);
}

function printKeyValue(value) {
  const rows = Object.entries(value).map(([key, raw]) => ({
    key,
    value: raw == null || raw === "" ? "-" : String(raw),
  }));

  printTable(rows, [
    ["key", "Поле"],
    ["value", "Значение"],
  ]);
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log("Нет данных.");
    return;
  }

  const normalized = rows.map((row) =>
    Object.fromEntries(
      columns.map(([key]) => [key, formatCell(row[key])]),
    ),
  );
  const widths = columns.map(([key, title]) =>
    Math.min(
      Math.max(
        visibleLength(title),
        ...normalized.map((row) => visibleLength(row[key])),
      ),
      52,
    ),
  );
  const header = columns.map(([, title], index) => padCell(title, widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(header);
  console.log(divider);

  for (const row of normalized) {
    console.log(columns.map(([key], index) => padCell(truncateCell(row[key], widths[index]), widths[index])).join("  "));
  }
}

function formatCell(value) {
  if (value == null || value === "") {
    return "-";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function truncateCell(value, width) {
  if (visibleLength(value) <= width) {
    return value;
  }

  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function padCell(value, width) {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function visibleLength(value) {
  return String(value).length;
}
