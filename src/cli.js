import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";
const CONFIG_DIR = path.join(os.homedir(), ".iola");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");
const DEFAULT_AI_CONFIG = {
  ai: {
    provider: "ollama",
    model: "llama3.2:1b",
    baseUrl: "http://127.0.0.1:11434",
  },
};
const DATASETS = {
  schools: {
    title: "Школы",
    endpoint: "schools",
  },
  kindergartens: {
    title: "Детские сады",
    endpoint: "kindergartens",
  },
};
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
  ["update", checkUpdate],
  ["banner", showBanner],
  ["agent", startAgent],
  ["chat", startAgent],
  ["ai", handleAi],
  ["init", initCli],
  ["health", checkHealth],
  ["layers", listLayers],
  ["data", handleData],
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
  iola chat
  iola init
  iola update
  iola data LAYER [--limit 10] [--search TEXT] [--format table|json|csv]
  iola ai ask TEXT [--provider ollama|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter
  iola ai doctor [--json]
  iola ai setup
  iola ai setup ollama [--yes] [--model MODEL]
  iola health [--json]
  iola layers [--json]
  iola schools [--limit 10] [--search TEXT] [--format table|json|csv]
  iola schools get --inn INN [--json]
  iola kindergartens [--limit 10] [--search TEXT] [--format table|json|csv]
  iola kindergartens get --inn INN [--json]
  iola search TEXT [--limit 5] [--format table|json|csv]
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
  const state = {
    history: [],
  };
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
      const shouldExit = await handleAgentLine(line, state);
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

async function handleAgentLine(line, state) {
  if (!line.startsWith("/")) {
    const answer = await aiAsk([line], { history: state.history });
    state.history.push({ role: "user", content: line });
    state.history.push({ role: "assistant", content: answer });
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

  if (command === "clear") {
    state.history = [];
    console.log("История agent-сессии очищена.");
    return false;
  }

  if (command === "history") {
    printAgentHistory(state.history);
    return false;
  }

  if (command === "config") {
    await printAiConfig();
    return false;
  }

  if (command === "context") {
    await aiContext(args);
    return false;
  }

  if (command === "use") {
    await useAiProvider(args);
    return false;
  }

  if (command === "key") {
    await handleAiKey(args);
    return false;
  }

  if (command === "provider") {
    await printAiConfigField("provider");
    return false;
  }

  if (command === "model") {
    await printAiConfigField("model");
    return false;
  }

  if (command === "banner") {
    showBanner();
    return false;
  }

  if (command === "update") {
    await checkUpdate(args);
    return false;
  }

  if (command === "init") {
    await initCli(args);
    return false;
  }

  if (command === "ai") {
    await handleAi(args);
    return false;
  }

  const mapped = {
    health: ["health", args],
    layers: ["layers", args],
    data: ["data", args],
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
  /data schools --limit 10
  /schools --limit 10
  /schools get --inn 1215067180
  /kindergartens --search 29
  /kindergartens get --inn 1215077421
  /search лицей --limit 3
  /mcp-info
  /context школа 29
  /ai doctor
  /ai setup ollama
  /use openai
  /use ollama
  /key status
  /key set openai
  /config
  /provider
  /model
  /history
  /clear
  /banner
  /update
  /init
  /exit

Обычный текст без slash-команды отправляется в настроенный AI-провайдер.`);
}

function printAgentHistory(history) {
  if (history.length === 0) {
    console.log("История пуста.");
    return;
  }

  for (const item of history.slice(-10)) {
    console.log(`${item.role}: ${item.content}`);
  }
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

async function showVersion(args = []) {
  const options = parseOptions(args);
  const packageJson = await import("../package.json", { with: { type: "json" } });
  console.log(packageJson.default.version);

  if (options.check) {
    await checkUpdate([]);
  }
}

async function checkUpdate() {
  const packageJson = await import("../package.json", { with: { type: "json" } });
  const current = packageJson.default.version;
  const latest = await getLatestNpmVersion(packageJson.default.name);

  if (!latest) {
    console.log("Не удалось проверить npm-версию.");
    return;
  }

  const comparison = compareVersions(latest, current);

  if (comparison > 0) {
    console.log(`Доступна новая версия: ${latest}`);
    console.log("Обновление:");
    console.log(`  npm install -g ${packageJson.default.name}@latest`);
    console.log("Или запуск без установки:");
    console.log(`  npx -y ${packageJson.default.name}@latest help`);
    return;
  }

  if (comparison < 0) {
    console.log(`Локальная версия ${current} новее опубликованной npm latest ${latest}.`);
    return;
  }

  console.log(`Установлена актуальная версия: ${current}`);
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

async function initCli(args = []) {
  const options = parseOptions(args);

  showBanner();
  console.log("Проверка окружения");
  printKeyValue({
    node: process.version,
    npm: await getCommandVersion("npm", ["--version"]),
    api: await probeEndpoint(`${MCP_BASE_URL}/mcp-health`),
    mcp: MCP_BASE_URL,
  });
  console.log("");

  await aiDoctor(options.json ? ["--json"] : []);

  if (!process.stdin.isTTY || options.yes) {
    console.log("");
    console.log("Для настройки AI используйте:");
    console.log("  iola ai setup ollama");
    console.log("  iola ai key set openai");
    console.log("  iola ai setup openai --model gpt-4.1-mini");
    return;
  }

  console.log("");
  const configureAi = await confirm("Настроить AI-провайдер сейчас? [Y/n] ");

  if (configureAi) {
    await aiSetup([]);
  }

  console.log("");
  await checkUpdate();
}

async function handleAi(args) {
  const [subcommand = "help", ...rest] = args;

  if (subcommand === "help") {
    showBanner();
    console.log(`AI-команды:
  iola ai ask TEXT [--provider ollama|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter
  iola ai doctor [--json]
  iola ai setup
  iola ai setup ollama [--yes] [--model MODEL]
  iola ai setup openai [--model MODEL]
  iola ai setup openrouter [--model MODEL]

Локальная настройка сохраняется в ${CONFIG_FILE}`);
    return;
  }

  if (subcommand === "ask") {
    await aiAsk(rest);
    return;
  }

  if (subcommand === "context") {
    await aiContext(rest);
    return;
  }

  if (subcommand === "key") {
    await handleAiKey(rest);
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
    const options = parseOptions(args.slice(1));
    const model = options.model || (provider === "openai" ? "gpt-4.1-mini" : "openai/gpt-4.1-mini");
    await saveConfig({
      ai: {
        provider,
        model,
        baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1",
      },
    });
    console.log(`AI-профиль ${provider} сохранен в ${CONFIG_FILE}`);
    console.log(`Ключ сохраните командой: iola ai key set ${provider}`);
    console.log(`Также можно использовать переменную окружения ${provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}.`);
    return;
  }

  if (provider === "codex") {
    await setupClient(["codex"]);
    return;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

async function handleAiKey(args) {
  const [action, provider] = args;

  if (action === "set") {
    await setAiKey(provider);
    return;
  }

  if (action === "status") {
    await printAiKeyStatus();
    return;
  }

  if (action === "delete") {
    await deleteAiKey(provider);
    return;
  }

  throw new Error(`Unknown key command. Use:
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter`);
}

async function useAiProvider(args) {
  const [provider] = args;

  if (provider !== "ollama" && provider !== "openai" && provider !== "openrouter") {
    throw new Error("Провайдер должен быть ollama, openai или openrouter.");
  }

  const config = await loadConfig();
  const defaultModel = {
    ollama: config.ai.provider === "ollama" ? config.ai.model : "llama3.2:1b",
    openai: config.ai.provider === "openai" ? config.ai.model : "gpt-4.1-mini",
    openrouter: config.ai.provider === "openrouter" ? config.ai.model : "openai/gpt-4.1-mini",
  }[provider];

  await saveConfig({
    ai: {
      provider,
      model: defaultModel,
      baseUrl: provider === "ollama"
        ? "http://127.0.0.1:11434"
        : provider === "openai"
          ? "https://api.openai.com/v1"
          : "https://openrouter.ai/api/v1",
    },
  });

  console.log(`AI-провайдер переключен: ${provider}, модель: ${defaultModel}`);
}

async function aiContext(args) {
  const options = parseOptions(args);
  const query = options._.join(" ").trim();

  if (!query) {
    throw new Error('Текст запроса обязателен. Пример: iola ai context "школа 29"');
  }

  const context = await buildDataContext(query);

  if (options.json) {
    printJson(context);
    return;
  }

  printContext(context);
}

async function setAiKey(provider) {
  assertKeyProvider(provider);

  if (!process.stdin.isTTY) {
    throw new Error("Для сохранения ключа запустите команду в интерактивном терминале.");
  }

  const envName = provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  const rl = readline.createInterface({ input, output });

  try {
    const key = (await rl.question(`Введите ${envName}: `)).trim();

    if (!key) {
      throw new Error("Ключ пустой, сохранение отменено.");
    }

    const secrets = await loadSecrets();
    secrets[provider] = { apiKey: key };
    await saveSecrets(secrets);
    console.log(`Ключ ${provider} сохранен локально: ${SECRETS_FILE}`);
  } finally {
    rl.close();
  }
}

async function printAiKeyStatus() {
  const secrets = await loadSecrets();
  const rows = ["openai", "openrouter"].map((provider) => ({
    provider,
    env: provider === "openai" ? (process.env.OPENAI_API_KEY ? "yes" : "no") : (process.env.OPENROUTER_API_KEY ? "yes" : "no"),
    local: secrets[provider]?.apiKey ? "yes" : "no",
  }));

  printTable(rows, [
    ["provider", "Провайдер"],
    ["env", "Env"],
    ["local", "Локально"],
  ]);
}

async function deleteAiKey(provider) {
  assertKeyProvider(provider);
  const secrets = await loadSecrets();
  delete secrets[provider];
  await saveSecrets(secrets);
  console.log(`Локальный ключ ${provider} удален.`);
}

function assertKeyProvider(provider) {
  if (provider !== "openai" && provider !== "openrouter") {
    throw new Error("Провайдер должен быть openai или openrouter.");
  }
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

async function aiAsk(args, context = {}) {
  const options = parseOptions(args);
  const question = options._.join(" ").trim();

  if (!question) {
    throw new Error('Текст вопроса обязателен. Пример: iola ai ask "Какие школы есть на улице Петрова?"');
  }

  const config = await loadConfig();
  const provider = options.provider || config.ai.provider;
  const model = options.model || config.ai.model;
  const providerConfig = {
    ...config.ai,
    provider,
    model,
  };
  const dataContext = await buildDataContext(question);
  const messages = buildAiMessages(question, dataContext, context.history || []);
  const answer = await callAiProvider(providerConfig, messages);

  console.log(answer);
  return answer;
}

async function buildDataContext(question) {
  const [layers, schools, kindergartens] = await Promise.all([
    fetchJson(`${MCP_BASE_URL}/mcp-version`),
    fetchJson(`${API_BASE_URL}/schools?limit=100&offset=0`),
    fetchJson(`${API_BASE_URL}/kindergartens?limit=100&offset=0`),
  ]);
  const queryTerms = extractSearchTerms(question);
  const patterns = extractStructuredPatterns(question);
  const includeSchools = patterns.targetLayers.length === 0 || patterns.targetLayers.includes("schools");
  const includeKindergartens = patterns.targetLayers.length === 0 || patterns.targetLayers.includes("kindergartens");
  const schoolItems = includeSchools
    ? findRelevantItems(normalizeItems(schools), queryTerms, patterns, "schools").slice(0, 8)
    : [];
  const kindergartenItems = includeKindergartens
    ? findRelevantItems(normalizeItems(kindergartens), queryTerms, patterns, "kindergartens").slice(0, 8)
    : [];

  return {
    layers: layers.data_layers || [],
    query: {
      text: question,
      terms: queryTerms,
      patterns,
    },
    schools: schoolItems.map(selectPublicSummary),
    kindergartens: kindergartenItems.map(selectPublicSummary),
  };
}

function extractSearchTerms(question) {
  const normalized = question
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !["какие", "какая", "какой", "есть", "найди", "покажи", "контакты", "адрес", "телефон", "школы", "школа", "сад", "детский", "детские", "сады", "улица", "ул"].includes(term));

  return normalized.length > 0 ? normalized : [question];
}

function extractStructuredPatterns(question) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const numbers = [...new Set([...normalized.matchAll(/\b\d{1,3}\b/g)].map((match) => match[0]))];
  const inns = [...new Set([...normalized.matchAll(/\b\d{10,12}\b/g)].map((match) => match[0]))];
  const targetLayers = [];
  if (/(^|[^а-яёa-z])(школа|школы|лицей|лицея|гимназия|гимназии)(?=$|[^а-яёa-z])/iu.test(normalized)) {
    targetLayers.push("schools");
  }
  if (/(^|[^а-яёa-z])(сад|сады|детсад|детский|детские|доу|мбдоу)(?=$|[^а-яёa-z])/iu.test(normalized)) {
    targetLayers.push("kindergartens");
  }
  const streetMatches = [
    ...normalized.matchAll(/(?:улица|ул\.?)\s+([а-яёa-z0-9 .-]+)/giu),
    ...normalized.matchAll(/([а-яёa-z0-9 .-]+)\s+(?:улица|ул\.?)/giu),
  ];
  const streets = [...new Set(streetMatches.map((match) => cleanupPattern(match[1])).filter(Boolean))];

  return { numbers, inns, streets, targetLayers: [...new Set(targetLayers)] };
}

function cleanupPattern(value) {
  return value
    .replace(/\b(школа|школы|сад|детский|детские|сады|лицей|гимназия|контакты|телефон|адрес|найди|покажи)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findRelevantItems(items, terms, patterns, layer) {
  return items
    .map((item) => ({
      item,
      score: scoreItem(item, terms, patterns, layer),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item);
}

function scoreItem(item, terms, patterns, layer) {
  const summary = selectPublicSummary(item);
  const text = JSON.stringify(summary).toLocaleLowerCase("ru-RU");
  const name = String(summary.name || "").toLocaleLowerCase("ru-RU");
  const address = String(summary.address || "").toLocaleLowerCase("ru-RU");
  const generalTerms = terms.filter((term) => !/^\d+$/.test(term));
  let score = generalTerms.reduce((value, term) => value + (text.includes(term.toLocaleLowerCase("ru-RU")) ? 1 : 0), 0);

  for (const inn of patterns.inns) {
    if (String(summary.inn) === inn) {
      score += 20;
    }
  }

  for (const number of patterns.numbers) {
    const numberPatterns = [
      `№ ${number}`,
      `№${number}`,
      `школа ${number}`,
      `сад ${number}`,
      `лицей ${number}`,
      `гимназия ${number}`,
    ];

    if (numberPatterns.some((pattern) => name.includes(pattern))) {
      score += 12;
      if (patterns.targetLayers.length === 0 || patterns.targetLayers.includes(layer)) {
        score += 5;
      }
    }
  }

  for (const street of patterns.streets) {
    if (street && address.includes(street)) {
      score += 8;
    }
  }

  return score;
}

function buildAiMessages(question, dataContext, history) {
  const sourceLines = buildSourceLines(dataContext);
  const system = [
    "Ты терминальный AI-ассистент CLI-проекта Йошкар-Олы.",
    "Отвечай на русском языке.",
    "Используй только данные из переданного контекста.",
    "Если в контексте нет нужных сведений, прямо напиши, что данных недостаточно.",
    "Не выдумывай адреса, телефоны, лицензии и руководителей.",
    "Если отвечаешь по конкретным организациям, укажи источник в конце: слой, название и ИНН.",
    "Отвечай кратко и по делу.",
  ].join(" ");
  const contextText = JSON.stringify(dataContext, null, 2);
  const recentHistory = history.slice(-6);

  return [
    { role: "system", content: system },
    ...recentHistory,
    {
      role: "user",
      content: `Контекст открытых данных городского округа "Город Йошкар-Ола":\n${contextText}\n\nКраткие источники контекста:\n${sourceLines}\n\nВопрос пользователя: ${question}`,
    },
  ];
}

function buildSourceLines(dataContext) {
  const rows = [
    ...dataContext.schools.map((item) => ({ layer: "schools", ...item })),
    ...dataContext.kindergartens.map((item) => ({ layer: "kindergartens", ...item })),
  ];

  if (rows.length === 0) {
    return "Совпавших организаций нет.";
  }

  return rows
    .map((item) => `- ${item.layer}: ${item.name || "-"}; ИНН ${item.inn || "-"}; адрес ${item.address || "-"}`)
    .join("\n");
}

async function callAiProvider(config, messages) {
  if (config.provider === "ollama") {
    return callOllama(config, messages);
  }

  if (config.provider === "openai") {
    return callOpenAiCompatible(config, messages, await getApiKey("openai"), "OpenAI");
  }

  if (config.provider === "openrouter") {
    return callOpenAiCompatible(config, messages, await getApiKey("openrouter"), "OpenRouter");
  }

  throw new Error(`Неизвестный AI-провайдер: ${config.provider}`);
}

async function callOllama(config, messages) {
  let response;

  try {
    response = await fetch(`${config.baseUrl || "http://127.0.0.1:11434"}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model || "llama3.2:1b",
        messages,
        stream: false,
      }),
    });
  } catch {
    throw new Error("Ollama недоступен. Запустите Ollama и проверьте: ollama --version");
  }

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}. Проверьте "ollama serve" и модель.`);
  }

  const payload = await response.json();
  return payload.message?.content || "";
}

async function callOpenAiCompatible(config, messages, apiKey, providerName) {
  if (!apiKey) {
    throw new Error(`${providerName} API key не найден. Задайте ${providerName === "OpenAI" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}.`);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": "https://github.com/adm-iola/iola-cli",
      "x-title": "iola-cli",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${providerName} request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || "";
}

async function getApiKey(provider) {
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  const secrets = await loadSecrets();
  return secrets[provider]?.apiKey || "";
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

async function handleData(args) {
  const [dataset, ...rest] = args;

  if (!dataset) {
    console.log("Доступные слои:");
    printTable(Object.entries(DATASETS).map(([id, value]) => ({ id, name: value.title })), [
      ["id", "ID"],
      ["name", "Название"],
    ]);
    console.log("");
    console.log("Пример:");
    console.log("  iola data schools --limit 10");
    return;
  }

  if (!DATASETS[dataset]) {
    throw new Error(`Неизвестный слой: ${dataset}. Доступно: ${Object.keys(DATASETS).join(", ")}`);
  }

  await listDataset(dataset, rest);
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

  const data = await fetchJson(`${API_BASE_URL}/${DATASETS[dataset].endpoint}?${params}`);
  const items = normalizeItems(data);
  const filtered = options.search ? filterItems(items, options.search) : items;
  const limited = filtered.slice(0, Number(options.limit || 20));

  if (options.json || options.format === "json") {
    printJson(limited);
    return;
  }

  if (options.format === "csv") {
    printCsv(limited.map(selectPublicSummary));
    return;
  }

  printDatasetTable(limited);
}

async function getDatasetItem(dataset, options) {
  if (!options.inn) {
    throw new Error(`INN is required. Example: iola ${dataset} get --inn 1215067180`);
  }

  const data = await fetchJson(`${API_BASE_URL}/${DATASETS[dataset].endpoint}?limit=500&offset=0`);
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

  if (options.json || options.format === "json") {
    printJson(result);
    return;
  }

  if (options.format === "csv") {
    printCsv([
      ...result.schools.map((item) => ({ layer: "schools", ...selectPublicSummary(item) })),
      ...result.kindergartens.map((item) => ({ layer: "kindergartens", ...selectPublicSummary(item) })),
    ]);
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
    } else if (arg === "--check") {
      result.check = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--inn" || arg === "--model" || arg === "--provider" || arg === "--format") {
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

async function getCommandVersion(command, args) {
  try {
    const { stdout } = await runCommand(command, args);
    return stdout.trim() || "installed";
  } catch {
    if (process.platform === "win32" && !command.endsWith(".cmd")) {
      try {
        const { stdout } = await runCommand(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`]);
        return stdout.trim() || "installed";
      } catch {
        return "не найден";
      }
    }

    return "не найден";
  }
}

async function probeEndpoint(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    return response.ok ? "доступен" : `${response.status} ${response.statusText}`;
  } catch {
    return "недоступен";
  }
}

async function getLatestNpmVersion(packageName) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return payload.version || null;
  } catch {
    return null;
  }
}

function compareVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);

    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
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
  const current = await loadConfig();
  const merged = mergeConfig(current, value);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function loadConfig() {
  try {
    const text = await readFile(CONFIG_FILE, "utf8");
    return mergeConfig(DEFAULT_AI_CONFIG, JSON.parse(text));
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    ai: {
      ...base.ai,
      ...(override.ai || {}),
    },
  };
}

async function loadSecrets() {
  try {
    return JSON.parse(await readFile(SECRETS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveSecrets(value) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SECRETS_FILE, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function printAiConfig() {
  const config = await loadConfig();
  printJson({
    file: CONFIG_FILE,
    ai: config.ai,
  });
}

function printContext(context) {
  const layerNames = context.layers.map((layer) => layer.name || layer.id || String(layer));
  console.log(`Запрос: ${context.query.text}`);
  console.log(`Слова поиска: ${context.query.terms.length > 0 ? context.query.terms.join(", ") : "-"}`);
  console.log(`Номера: ${context.query.patterns.numbers.length > 0 ? context.query.patterns.numbers.join(", ") : "-"}`);
  console.log(`ИНН: ${context.query.patterns.inns.length > 0 ? context.query.patterns.inns.join(", ") : "-"}`);
  console.log(`Улицы: ${context.query.patterns.streets.length > 0 ? context.query.patterns.streets.join(", ") : "-"}`);
  console.log(`Целевые слои: ${context.query.patterns.targetLayers.length > 0 ? context.query.patterns.targetLayers.join(", ") : "все"}`);
  console.log("");
  console.log(`Слои данных: ${layerNames.length > 0 ? layerNames.join(", ") : "-"}`);
  console.log("");

  if (context.schools.length > 0) {
    console.log("Школы в контексте:");
    printTable(context.schools, [
      ["name", "Название"],
      ["address", "Адрес"],
      ["phone", "Телефон"],
      ["inn", "ИНН"],
    ]);
  } else {
    console.log("Школы в контексте: нет совпадений");
  }

  console.log("");

  if (context.kindergartens.length > 0) {
    console.log("Детские сады в контексте:");
    printTable(context.kindergartens, [
      ["name", "Название"],
      ["address", "Адрес"],
      ["phone", "Телефон"],
      ["inn", "ИНН"],
    ]);
  } else {
    console.log("Детские сады в контексте: нет совпадений");
  }
}

async function printAiConfigField(field) {
  const config = await loadConfig();
  console.log(config.ai[field] || "-");
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

function printCsv(rows) {
  if (rows.length === 0) {
    return;
  }

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  console.log(columns.map(csvCell).join(","));

  for (const row of rows) {
    console.log(columns.map((column) => csvCell(row[column])).join(","));
  }
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
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
