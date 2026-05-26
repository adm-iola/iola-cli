import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DatabaseSync } from "node:sqlite";

const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";
const MIN_NODE_VERSION = "22.5.0";
const CONFIG_DIR = path.join(os.homedir(), ".iola");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");
const DB_FILE = path.join(CONFIG_DIR, "iola.db");
const DB_SCHEMA_VERSION = 1;
const DEFAULT_AI_CONFIG = {
  api: {
    baseUrl: "https://apiiola.yasg.ru/api/v1",
    mcpBaseUrl: "https://apiiola.yasg.ru",
  },
  ai: {
    activeProfile: "local",
    provider: "ollama",
    model: "llama3.2:1b",
    baseUrl: "http://127.0.0.1:11434",
    profiles: {
      local: {
        provider: "ollama",
        model: "llama3.2:1b",
        baseUrl: "http://127.0.0.1:11434",
      },
      openai: {
        provider: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
      },
      openrouter: {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        baseUrl: "https://openrouter.ai/api/v1",
      },
      codex: {
        provider: "codex",
        model: "gpt-5.5",
        sandbox: "read-only",
        approval: "never",
        cwd: ".",
      },
    },
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
  ["doctor", doctor],
  ["db", handleDb],
  ["history", handleHistory],
  ["config", handleConfig],
  ["banner", showBanner],
  ["agent", startAgent],
  ["chat", startAgent],
  ["ask", aiAsk],
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
  const nodeStatus = getNodeRequirementStatus();
  if (!nodeStatus.ok && !["help", "version", "doctor", "init"].includes(command)) {
    throw new Error(`Нужен Node.js ${MIN_NODE_VERSION} или новее. Сейчас: ${nodeStatus.current}. Запустите: iola init --upgrade-node`);
  }

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
  iola doctor
  iola db status
  iola db init
  iola history [--limit 20]
  iola history clear
  iola config get
  iola config set api.baseUrl URL
  iola config set api.mcpBaseUrl URL
  iola config reset
  iola update
  iola ask TEXT
  iola data LAYER [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola ai ask TEXT [--provider ollama|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter
  iola ai profiles
  iola ai profile add NAME --provider PROVIDER --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models ollama|openai|openrouter|codex [--search TEXT]
  iola ai doctor [--json]
  iola ai setup
  iola ai setup ollama [--yes] [--model MODEL]
  iola health [--json]
  iola layers [--json]
  iola schools [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola schools get --inn INN [--json]
  iola kindergartens [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola kindergartens get --inn INN [--json]
  iola search TEXT [--limit 5] [--format table|json|csv]
  iola mcp-info [--json]
  iola setup codex
  iola version

Environment:
  IOLA_API_BASE_URL   default: ${API_BASE_URL}
  IOLA_MCP_BASE_URL   default: ${MCP_BASE_URL}

Requirements:
  Node.js >= ${MIN_NODE_VERSION}
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
    if (args.length > 0) {
      await handleHistory(args);
    } else {
      printAgentHistory(state.history);
    }
    return false;
  }

  if (command === "db") {
    await handleDb(args);
    return false;
  }

  if (command === "config") {
    await handleConfig(args.length > 0 ? args : ["get"]);
    return false;
  }

  if (command === "doctor") {
    await doctor(args);
    return false;
  }

  if (command === "cfg" || command === "settings") {
    await handleConfig(args);
    return false;
  }

  if (command === "context") {
    await aiContext(args);
    return false;
  }

  if (command === "profiles") {
    await handleAiProfile(["list", ...args]);
    return false;
  }

  if (command === "profile") {
    await handleAiProfile(args);
    return false;
  }

  if (command === "models") {
    await aiModels(args);
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
    doctor: ["doctor", args],
    db: ["db", args],
    history: ["history", args],
    config: ["config", args],
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
  /doctor
  /db status
  /config get
  /config set api.baseUrl URL
  /layers
  /data schools --limit 10
  /schools --limit 10
  /schools get --inn 1215067180
  /kindergartens --search 29
  /kindergartens get --inn 1215077421
  /search лицей --limit 3
  /mcp-info
  /context школа 29
  /profiles
  /profile use local
  /models openrouter --search qwen
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
  /history --limit 20
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
  const health = await fetchJson(`${await getMcpBaseUrl()}/mcp-health`);

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

async function doctor(args = []) {
  const options = parseOptions(args);
  const packageJson = await import("../package.json", { with: { type: "json" } });
  const config = await loadConfig();
  const activeAiProfile = resolveAiProfile(config);
  const secrets = await loadSecrets();
  const diagnostics = await getLocalDiagnostics();
  const latest = await getLatestNpmVersion(packageJson.default.name);
  const apiBaseUrl = await getApiBaseUrl();
  const mcpBaseUrl = await getMcpBaseUrl();
  const report = {
    cli: {
      version: packageJson.default.version,
      npmLatest: latest || "-",
      update: getUpdateStatus(packageJson.default.version, latest),
      node: process.version,
      nodeRequired: `>=${MIN_NODE_VERSION}`,
      nodeStatus: getNodeRequirementStatus().ok ? "ok" : "upgrade-required",
    },
    db: getDbStatus(),
    api: {
      baseUrl: apiBaseUrl,
      mcpBaseUrl,
      health: await probeEndpoint(`${mcpBaseUrl}/mcp-health`),
    },
    ai: {
      activeProfile: getActiveProfileName(config),
      provider: activeAiProfile.provider,
      model: activeAiProfile.model,
      modelAvailable: await checkConfiguredModel({ ai: activeAiProfile }),
      openaiKey: process.env.OPENAI_API_KEY ? "env" : secrets.openai?.apiKey ? "local" : "missing",
      openrouterKey: process.env.OPENROUTER_API_KEY ? "env" : secrets.openrouter?.apiKey ? "local" : "missing",
      ollama: diagnostics.ollama.installed ? diagnostics.ollama.version : "not-installed",
    },
    system: diagnostics,
  };

  if (options.json) {
    printJson(report);
    return;
  }

  console.log("CLI");
  printKeyValue(report.cli);
  console.log("");
  console.log("SQLite");
  printKeyValue(report.db);
  console.log("");
  console.log("API/MCP");
  printKeyValue(report.api);
  console.log("");
  console.log("AI");
  printKeyValue(report.ai);
  console.log("");
  printDiagnostics(diagnostics, recommendOllamaModel(diagnostics));
}

function getUpdateStatus(current, latest) {
  if (!latest) {
    return "unknown";
  }

  const comparison = compareVersions(latest, current);

  if (comparison > 0) {
    return "available";
  }

  if (comparison < 0) {
    return "local-newer";
  }

  return "ok";
}

function getNodeRequirementStatus() {
  const current = process.versions.node;
  return {
    current,
    required: MIN_NODE_VERSION,
    ok: compareVersions(current, MIN_NODE_VERSION) >= 0,
  };
}

async function offerNodeUpgrade(options, status) {
  console.log(`Текущая версия Node.js: ${status.current}. Нужна ${MIN_NODE_VERSION} или новее.`);

  if (!process.stdin.isTTY && !options["upgrade-node"]) {
    printNodeUpgradeInstructions();
    return;
  }

  const shouldUpgrade = options["upgrade-node"] || (await confirm("Обновить Node.js установщиком сейчас? [y/N] "));

  if (!shouldUpgrade) {
    printNodeUpgradeInstructions();
    return;
  }

  await upgradeNodeWithInstaller();
  console.log("");
  console.log("После обновления перезапустите терминал и проверьте:");
  console.log("  node --version");
  console.log("  iola init");
}

function printNodeUpgradeInstructions() {
  console.log("Обновите Node.js:");
  console.log("  Windows: winget install OpenJS.NodeJS.LTS");
  console.log("  macOS:   brew install node");
  console.log("  Linux:   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs");
}

async function upgradeNodeWithInstaller() {
  if (process.platform === "win32") {
    try {
      await runCommand("winget", ["upgrade", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"], { inherit: true });
    } catch {
      await runCommand("winget", ["install", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"], { inherit: true });
    }
    return;
  }

  if (process.platform === "darwin") {
    try {
      await runCommand("brew", ["upgrade", "node"], { inherit: true });
    } catch {
      await runCommand("brew", ["install", "node"], { inherit: true });
    }
    return;
  }

  await runCommand("sh", [
    "-c",
    "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs",
  ], { inherit: true });
}

async function checkConfiguredModel(config) {
  if (config.ai.provider !== "ollama") {
    return "external-api";
  }

  try {
    const response = await fetch(`${config.ai.baseUrl || "http://127.0.0.1:11434"}/api/tags`);

    if (!response.ok) {
      return "unknown";
    }

    const payload = await response.json();
    const models = payload.models || [];
    return models.some((model) => model.name === config.ai.model) ? "installed" : "missing";
  } catch {
    return "ollama-unavailable";
  }
}

async function initCli(args = []) {
  const options = parseOptions(args);
  const nodeStatus = getNodeRequirementStatus();

  showBanner();
  console.log("Проверка окружения");
  initDatabase();
  const dbStatus = getDbStatus();
  printKeyValue({
    node: process.version,
    node_required: `>=${MIN_NODE_VERSION}`,
    node_status: nodeStatus.ok ? "ok" : "нужно обновить",
    npm: await getCommandVersion("npm", ["--version"]),
    api: await probeEndpoint(`${await getMcpBaseUrl()}/mcp-health`),
    mcp: await getMcpBaseUrl(),
    sqlite: dbStatus.status,
    sqlite_file: dbStatus.file,
  });
  console.log("");

  if (!nodeStatus.ok) {
    await offerNodeUpgrade(options, nodeStatus);
    console.log("");
  }

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
  iola ai profiles
  iola ai profile add NAME --provider ollama|openai|openrouter|codex --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models ollama|openai|openrouter|codex [--search TEXT]
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

  if (subcommand === "profiles") {
    await handleAiProfile(["list", ...rest]);
    return;
  }

  if (subcommand === "profile") {
    await handleAiProfile(rest);
    return;
  }

  if (subcommand === "models") {
    await aiModels(rest);
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

async function handleConfig(args) {
  const [action = "get", key, ...rest] = args;

  if (action === "get") {
    const config = await loadConfig();
    if (key) {
      console.log(getConfigValue(config, key) ?? "-");
      return;
    }
    printJson({
      file: CONFIG_FILE,
      config,
      effective: {
        apiBaseUrl: await getApiBaseUrl(),
        mcpBaseUrl: await getMcpBaseUrl(),
      },
    });
    return;
  }

  if (action === "set") {
    const value = rest.join(" ").trim();
    if (!key || !value) {
      throw new Error("Пример: iola config set api.baseUrl https://apiiola.yasg.ru/api/v1");
    }
    const config = await loadConfig();
    setConfigValue(config, key, value);
    await saveConfig(config);
    console.log(`Сохранено: ${key} = ${value}`);
    return;
  }

  if (action === "reset") {
    await writeConfig(DEFAULT_AI_CONFIG);
    console.log(`Конфигурация сброшена: ${CONFIG_FILE}`);
    return;
  }

  throw new Error("Команды config: get, set, reset.");
}

async function handleDb(args) {
  const [action = "status"] = args;
  const options = parseOptions(args);

  if (action === "init") {
    initDatabase();
    if (!options.silent) {
      console.log(`SQLite-БД готова: ${DB_FILE}`);
    }
    return;
  }

  if (action === "status") {
    printKeyValue(getDbStatus());
    return;
  }

  if (action === "reset") {
    const shouldReset = await confirm("Удалить локальную SQLite-БД iola.db? [y/N] ");
    if (!shouldReset) {
      console.log("Сброс отменен.");
      return;
    }
    await rm(DB_FILE, { force: true });
    initDatabase();
    console.log(`SQLite-БД пересоздана: ${DB_FILE}`);
    return;
  }

  throw new Error("Команды db: status, init, reset.");
}

async function handleHistory(args) {
  const [action] = args;
  const options = parseOptions(args);

  if (action === "clear") {
    clearHistory();
    console.log("История очищена.");
    return;
  }

  const rows = listHistory(Number(options.limit || 20));

  if (options.json) {
    printJson(rows);
    return;
  }

  printTable(rows, [
    ["id", "ID"],
    ["created_at", "Дата"],
    ["profile", "Профиль"],
    ["provider", "Провайдер"],
    ["question", "Вопрос"],
    ["answer", "Ответ"],
  ]);
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
    const profileName = options.name || provider;
    const profile = buildProfileFromOptions(provider, { ...options, model });
    const config = await loadConfig();
    await saveConfig({
      ai: {
        ...config.ai,
        activeProfile: profileName,
        provider,
        model,
        baseUrl: profile.baseUrl,
        profiles: {
          ...(config.ai.profiles || {}),
          [profileName]: profile,
        },
      },
    });
    console.log(`AI-профиль ${profileName} сохранен и выбран в ${CONFIG_FILE}`);
    console.log(`Ключ сохраните командой: iola ai key set ${provider}`);
    console.log(`Также можно использовать переменную окружения ${provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}.`);
    return;
  }

  if (provider === "codex") {
    const options = parseOptions(args.slice(1));
    const profileName = options.name || "codex";
    const profile = buildProfileFromOptions("codex", options);
    const config = await loadConfig();
    await saveConfig({
      ai: {
        ...config.ai,
        activeProfile: profileName,
        provider: "codex",
        model: profile.model,
        profiles: {
          ...(config.ai.profiles || {}),
          [profileName]: profile,
        },
      },
    });
    console.log(`AI-профиль ${profileName} сохранен и выбран.`);
    console.log("Проверка Codex CLI:");
    console.log(`  ${await getCommandVersion("codex", ["--version"])}`);
    console.log("MCP подключается отдельно командой:");
    console.log("  iola setup codex");
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

async function handleAiProfile(args) {
  const [action = "list", name, ...rest] = args;

  if (action === "list" || action === "ls") {
    await printAiProfiles();
    return;
  }

  if (action === "show") {
    await showAiProfile(name);
    return;
  }

  if (action === "use") {
    await useAiProfile(name);
    return;
  }

  if (action === "add" || action === "set") {
    await addAiProfile(name, rest);
    return;
  }

  if (action === "delete" || action === "remove" || action === "rm") {
    await deleteAiProfile(name);
    return;
  }

  throw new Error(`Unknown profile command. Use:
  iola ai profiles
  iola ai profile add NAME --provider PROVIDER --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME`);
}

async function aiModels(args) {
  const [provider] = args;
  const options = parseOptions(args.slice(1));

  if (!["ollama", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер обязателен: iola ai models ollama|openai|openrouter|codex");
  }

  const models = await listAiModels(provider);
  const filtered = options.search
    ? models.filter((model) => model.id.toLocaleLowerCase("ru-RU").includes(options.search.toLocaleLowerCase("ru-RU")))
    : models;

  if (options.json) {
    printJson(filtered);
    return;
  }

  printTable(filtered, [
    ["id", "Модель"],
    ["provider", "Провайдер"],
    ["note", "Примечание"],
  ]);
}

async function listAiModels(provider) {
  if (provider === "ollama") {
    try {
      const config = await loadConfig();
      const response = await fetch(`${config.ai.profiles?.local?.baseUrl || "http://127.0.0.1:11434"}/api/tags`);

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      return (payload.models || []).map((model) => ({
        id: model.name,
        provider: "ollama",
        note: model.modified_at ? `updated ${model.modified_at}` : "local",
      }));
    } catch {
      return [
        { id: "llama3.2:1b", provider: "ollama", note: "recommended low RAM" },
        { id: "llama3.2:3b", provider: "ollama", note: "recommended standard" },
        { id: "qwen3:4b", provider: "ollama", note: "recommended balanced" },
        { id: "qwen3:8b", provider: "ollama", note: "recommended good GPU" },
      ];
    }
  }

  if (provider === "openai") {
    const apiKey = await getApiKey("openai");
    if (!apiKey) {
      throw new Error("OpenAI API key не найден. Выполните iola ai key set openai.");
    }
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`OpenAI models request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return (payload.data || [])
      .map((model) => ({ id: model.id, provider: "openai", note: model.owned_by || "" }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  if (provider === "openrouter") {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return (payload.data || [])
      .map((model) => ({
        id: model.id,
        provider: "openrouter",
        note: model.name || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  const version = await getCommandVersion("codex", ["--version"]);
  return [
    { id: "gpt-5.5", provider: "codex", note: version },
    { id: "gpt-5", provider: "codex", note: version },
    { id: "gpt-5-codex", provider: "codex", note: version },
    { id: "gpt-5-mini", provider: "codex", note: version },
  ];
}

async function printAiProfiles() {
  const config = await loadConfig();
  const active = getActiveProfileName(config);
  const rows = Object.entries(config.ai.profiles || {}).map(([name, profile]) => ({
    active: name === active ? "*" : "",
    name,
    provider: profile.provider,
    model: profile.model || "-",
    baseUrl: profile.baseUrl || "-",
    mode: profile.provider === "codex" ? `sandbox=${profile.sandbox || "read-only"}, approval=${profile.approval || "never"}` : "-",
  }));

  printTable(rows, [
    ["active", ""],
    ["name", "Профиль"],
    ["provider", "Провайдер"],
    ["model", "Модель"],
    ["baseUrl", "Base URL"],
    ["mode", "Режим"],
  ]);
}

async function showAiProfile(name) {
  const config = await loadConfig();
  const profileName = name || getActiveProfileName(config);
  const profile = config.ai.profiles?.[profileName];

  if (!profile) {
    throw new Error(`AI-профиль не найден: ${profileName}`);
  }

  printJson({ name: profileName, active: profileName === getActiveProfileName(config), ...profile });
}

async function addAiProfile(name, args) {
  if (!name) {
    throw new Error("Имя профиля обязательно. Пример: iola ai profile add router-qwen --provider openrouter --model qwen/qwen3-32b");
  }

  const options = parseOptions(args);
  const provider = options.provider;

  if (!["ollama", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер должен быть ollama, openai, openrouter или codex.");
  }

  const profile = buildProfileFromOptions(provider, options);
  const config = await loadConfig();
  await saveConfig({
    ai: {
      ...config.ai,
      profiles: {
        ...(config.ai.profiles || {}),
        [name]: profile,
      },
    },
  });

  console.log(`AI-профиль сохранен: ${name}`);
}

async function useAiProfile(name) {
  if (!name) {
    throw new Error("Имя профиля обязательно. Пример: iola ai profile use local");
  }

  const config = await loadConfig();
  const profile = config.ai.profiles?.[name];

  if (!profile) {
    throw new Error(`AI-профиль не найден: ${name}`);
  }

  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: name,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl || config.ai.baseUrl,
    },
  });

  console.log(`Активный AI-профиль: ${name} (${profile.provider}, ${profile.model || "-"})`);
}

async function deleteAiProfile(name) {
  if (!name) {
    throw new Error("Имя профиля обязательно.");
  }

  const config = await loadConfig();
  const profiles = { ...(config.ai.profiles || {}) };

  if (!profiles[name]) {
    throw new Error(`AI-профиль не найден: ${name}`);
  }

  delete profiles[name];
  const nextActive = config.ai.activeProfile === name ? Object.keys(profiles)[0] : config.ai.activeProfile;
  const activeProfile = profiles[nextActive] || DEFAULT_AI_CONFIG.ai.profiles.local;

  await saveConfig({
    ai: {
      ...config.ai,
      profiles,
      activeProfile: nextActive || "local",
      provider: activeProfile.provider,
      model: activeProfile.model,
      baseUrl: activeProfile.baseUrl || config.ai.baseUrl,
    },
  });

  console.log(`AI-профиль удален: ${name}`);
}

function buildProfileFromOptions(provider, options) {
  const defaults = DEFAULT_AI_CONFIG.ai.profiles[provider === "ollama" ? "local" : provider];
  const profile = {
    ...defaults,
    provider,
    model: options.model || defaults.model,
  };

  if (options["base-url"]) {
    profile.baseUrl = options["base-url"];
  }

  if (provider === "codex") {
    profile.sandbox = options.sandbox || defaults.sandbox || "read-only";
    profile.approval = options.approval || defaults.approval || "never";
    profile.cwd = options.cwd || defaults.cwd || ".";
    if (options["codex-profile"]) {
      profile.codexProfile = options["codex-profile"];
    }
  }

  return profile;
}

async function useAiProvider(args) {
  const [providerOrProfile] = args;
  const config = await loadConfig();

  if (config.ai.profiles?.[providerOrProfile]) {
    await useAiProfile(providerOrProfile);
    return;
  }

  const provider = providerOrProfile;

  if (provider !== "ollama" && provider !== "openai" && provider !== "openrouter" && provider !== "codex") {
    throw new Error("Провайдер должен быть ollama, openai, openrouter, codex или именем AI-профиля.");
  }

  const defaultModel = {
    ollama: config.ai.provider === "ollama" ? config.ai.model : "llama3.2:1b",
    openai: config.ai.provider === "openai" ? config.ai.model : "gpt-4.1-mini",
    openrouter: config.ai.provider === "openrouter" ? config.ai.model : "openai/gpt-4.1-mini",
    codex: config.ai.provider === "codex" ? config.ai.model : "gpt-5.5",
  }[provider];
  const profileName = provider === "ollama" ? "local" : provider;
  const profile = buildProfileFromOptions(provider, { model: defaultModel });

  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: profileName,
      provider,
      model: defaultModel,
      baseUrl: profile.baseUrl,
      profiles: {
        ...(config.ai.profiles || {}),
        [profileName]: profile,
      },
    },
  });

  console.log(`AI-провайдер переключен: ${provider}, профиль: ${profileName}, модель: ${defaultModel}`);
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

function openDatabase() {
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function initDatabase() {
  mkdirSyncSafe(CONFIG_DIR);
  const db = openDatabase();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ask_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        profile TEXT,
        provider TEXT,
        model TEXT,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        context_json TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ask_history_created_at ON ask_history(created_at DESC);
      CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS saved_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        dataset TEXT NOT NULL,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(`
      INSERT INTO meta(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(DB_SCHEMA_VERSION));
  } finally {
    db.close();
  }
}

function mkdirSyncSafe(directory) {
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    // Directory creation is retried by write operations where needed.
  }
}

function getDbStatus() {
  try {
    initDatabase();
    const db = openDatabase();
    try {
      const schema = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
      const history = db.prepare("SELECT COUNT(*) AS count FROM ask_history").get();
      return {
        status: "ok",
        file: DB_FILE,
        schema: schema?.value || "-",
        history: history?.count ?? 0,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      status: "error",
      file: DB_FILE,
      schema: "-",
      history: "-",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function recordAskHistory({ question, answer, providerConfig, dataContext, error }) {
  try {
    initDatabase();
    const db = openDatabase();
    try {
      db.prepare(`
        INSERT INTO ask_history(profile, provider, model, question, answer, context_json, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        providerConfig.name || "",
        providerConfig.provider || "",
        providerConfig.model || "",
        question,
        answer,
        JSON.stringify(dataContext),
        error || "",
      );
    } finally {
      db.close();
    }
  } catch {
    // History must never break the main answer path.
  }
}

function listHistory(limit) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT id, created_at, profile, provider, model, question, answer, error
      FROM ask_history
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  } finally {
    db.close();
  }
}

function clearHistory() {
  initDatabase();
  const db = openDatabase();
  try {
    db.exec("DELETE FROM ask_history");
  } finally {
    db.close();
  }
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

  const config = await loadConfig();
  const profileName = options.name || "local";
  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: profileName,
      provider: "ollama",
      model,
      baseUrl: "http://127.0.0.1:11434",
      profiles: {
        ...(config.ai.profiles || {}),
        [profileName]: {
          provider: "ollama",
          model,
          baseUrl: "http://127.0.0.1:11434",
        },
      },
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
  const providerConfig = resolveAiProfile(config, options);
  const dataContext = await buildDataContext(question);
  const messages = buildAiMessages(question, dataContext, context.history || []);
  let answer = "";
  let errorMessage = "";

  try {
    answer = await callAiProvider(providerConfig, messages);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    recordAskHistory({ question, answer: "", providerConfig, dataContext, error: errorMessage });
    throw error;
  }

  recordAskHistory({ question, answer, providerConfig, dataContext, error: "" });

  console.log(answer);
  return answer;
}

function resolveAiProfile(config, options = {}) {
  const profileName = options.profile || (options.provider && config.ai.profiles?.[options.provider]
    ? options.provider
    : getActiveProfileName(config));
  const activeProfile = config.ai.profiles?.[profileName] || {
    provider: config.ai.provider,
    model: config.ai.model,
    baseUrl: config.ai.baseUrl,
  };
  const provider = options.provider && !config.ai.profiles?.[options.provider] ? options.provider : activeProfile.provider;

  return {
    name: profileName,
    ...activeProfile,
    provider,
    model: options.model || activeProfile.model || config.ai.model,
    baseUrl: options["base-url"] || activeProfile.baseUrl || config.ai.baseUrl,
  };
}

async function buildDataContext(question) {
  const apiBaseUrl = await getApiBaseUrl();
  const mcpBaseUrl = await getMcpBaseUrl();
  const [layers, schools, kindergartens] = await Promise.all([
    fetchJson(`${mcpBaseUrl}/mcp-version`),
    fetchJson(`${apiBaseUrl}/schools?limit=100&offset=0`),
    fetchJson(`${apiBaseUrl}/kindergartens?limit=100&offset=0`),
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

  if (config.provider === "codex") {
    return callCodex(config, messages);
  }

  throw new Error(`Неизвестный AI-провайдер: ${config.provider}`);
}

async function callCodex(config, messages) {
  const prompt = messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
  const outputFile = path.join(os.tmpdir(), `iola-codex-${process.pid}-${Date.now()}.txt`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFile,
    "--cd",
    path.resolve(process.cwd(), config.cwd || "."),
    "--model",
    config.model || "gpt-5.5",
    "--sandbox",
    config.sandbox || "read-only",
  ];

  if (config.codexProfile) {
    args.push("--profile", config.codexProfile);
  }

  args.push("-");

  try {
    const { stdout, stderr } = await runCommand("codex", args, { input: prompt });
    const answer = (await readFile(outputFile, "utf8")).trim();
    if (answer) {
      return answer;
    }
    return stdout.trim() || stderr.trim();
  } catch (error) {
    throw new Error(`Codex CLI недоступен или не авторизован. Проверьте "codex doctor" и "codex login".\n${error.message}`);
  } finally {
    await rm(outputFile, { force: true });
  }
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
    throw new Error(`${providerName} API key не найден. Выполните iola ai key set ${providerName === "OpenAI" ? "openai" : "openrouter"} или задайте ${providerName === "OpenAI" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}.`);
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
  const info = await fetchJson(`${await getMcpBaseUrl()}/mcp-version`);

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
  const info = await fetchJson(`${await getMcpBaseUrl()}/mcp-version`);

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

  const data = await fetchJson(`${await getApiBaseUrl()}/${DATASETS[dataset].endpoint}?${params}`);
  const items = normalizeItems(data);
  const filtered = applyDatasetFilters(items, options);
  const limited = filtered.slice(0, Number(options.limit || 20));
  const summarized = limited.map(selectPublicSummary);
  const projected = projectColumns(summarized, options.columns);

  if (options.json || options.format === "json") {
    printJson(projected);
    return;
  }

  if (options.format === "csv") {
    printCsv(projected);
    return;
  }

  printDatasetTable(projected, options.columns);
}

async function getDatasetItem(dataset, options) {
  if (!options.inn) {
    throw new Error(`INN is required. Example: iola ${dataset} get --inn 1215067180`);
  }

  const data = await fetchJson(`${await getApiBaseUrl()}/${DATASETS[dataset].endpoint}?limit=500&offset=0`);
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
    fetchJson(`${await getApiBaseUrl()}/schools?limit=100&offset=0`),
    fetchJson(`${await getApiBaseUrl()}/kindergartens?limit=100&offset=0`),
  ]);

  const limit = Number(options.limit || 5);
  const result = {
    schools: projectColumns(filterItems(normalizeItems(schools), query).slice(0, limit).map(selectPublicSummary), options.columns),
    kindergartens: projectColumns(filterItems(normalizeItems(kindergartens), query).slice(0, limit).map(selectPublicSummary), options.columns),
  };

  if (options.json || options.format === "json") {
    printJson(result);
    return;
  }

  if (options.format === "csv") {
    printCsv([
      ...result.schools.map((item) => ({ layer: "schools", ...item })),
      ...result.kindergartens.map((item) => ({ layer: "kindergartens", ...item })),
    ]);
    return;
  }

  console.log("Школы");
  printDatasetTable(result.schools, options.columns);
  console.log("");
  console.log("Детские сады");
  printDatasetTable(result.kindergartens, options.columns);
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
    if (arg === "--json" || arg === "--yes" || arg === "--silent") {
      result[arg.slice(2)] = true;
    } else if (arg === "--check" || arg === "--upgrade-node") {
      result.check = true;
      result[arg.slice(2)] = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--where" || arg === "--columns" || arg === "--inn" || arg === "--model" || arg === "--provider" || arg === "--profile" || arg === "--name" || arg === "--base-url" || arg === "--sandbox" || arg === "--approval" || arg === "--cwd" || arg === "--codex-profile" || arg === "--format") {
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

function applyDatasetFilters(items, options) {
  let result = options.search ? filterItems(items, options.search) : items;

  if (options.where) {
    const [field, ...valueParts] = String(options.where).split("=");
    const value = valueParts.join("=").trim().toLocaleLowerCase("ru-RU");
    const key = field.trim();

    if (!key || !value) {
      throw new Error('Фильтр --where должен быть в формате field=value. Пример: --where address=Петрова');
    }

    result = result.filter((item) => {
      const summary = selectPublicSummary(item);
      const raw = summary[key] ?? item[key];
      return String(raw ?? "").toLocaleLowerCase("ru-RU").includes(value);
    });
  }

  return result;
}

function projectColumns(rows, columnsValue) {
  if (!columnsValue) {
    return rows;
  }

  const columns = String(columnsValue).split(",").map((column) => column.trim()).filter(Boolean);

  if (columns.length === 0) {
    return rows;
  }

  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
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
    name: item.name || item.fns_short_name || item.fns_full_name,
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
  if (value.ai?.profiles) {
    merged.ai.profiles = value.ai.profiles;
  }
  await writeConfig(merged);
}

async function writeConfig(value) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    api: {
      ...base.api,
      ...(override.api || {}),
    },
    ai: {
      ...base.ai,
      ...(override.ai || {}),
      profiles: {
        ...(base.ai.profiles || {}),
        ...(override.ai?.profiles || {}),
      },
    },
  };
}

function getActiveProfileName(config) {
  if (config.ai.activeProfile && config.ai.profiles?.[config.ai.activeProfile]) {
    return config.ai.activeProfile;
  }

  const provider = config.ai.provider === "ollama" ? "local" : config.ai.provider;
  if (provider && config.ai.profiles?.[provider]) {
    return provider;
  }

  return Object.keys(config.ai.profiles || {})[0] || "local";
}

async function getApiBaseUrl() {
  if (process.env.IOLA_API_BASE_URL) {
    return process.env.IOLA_API_BASE_URL;
  }

  const config = await loadConfig();
  return config.api.baseUrl;
}

async function getMcpBaseUrl() {
  if (process.env.IOLA_MCP_BASE_URL) {
    return process.env.IOLA_MCP_BASE_URL;
  }

  const config = await loadConfig();
  return config.api.mcpBaseUrl;
}

function getConfigValue(config, key) {
  return key.split(".").reduce((value, part) => value?.[part], config);
}

function setConfigValue(config, key, value) {
  const parts = key.split(".");
  let current = config;

  for (const part of parts.slice(0, -1)) {
    current[part] = current[part] && typeof current[part] === "object" ? current[part] : {};
    current = current[part];
  }

  current[parts.at(-1)] = value;
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
        if (process.platform === "win32" && (error.code === "ENOENT" || error.code === "EINVAL") && !options.cmdFallback) {
          runCommand(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", quoteWindowsCommand(command, args)], {
            ...options,
            cmdFallback: true,
          }).then(resolve, reject);
          return;
        }

        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });

    if (options.inherit) {
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
    }

    if (options.input) {
      child.stdin?.end(options.input);
    }
  });
}

function quoteWindowsCommand(command, args) {
  return [command, ...args].map((value) => {
    const text = String(value);
    if (/^[A-Za-z0-9_./:=\\-]+$/.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, "\\\"")}"`;
  }).join(" ");
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

function printDatasetTable(items, columnsValue) {
  if (columnsValue) {
    const columns = String(columnsValue)
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => [column, column]);
    printTable(items, columns);
    return;
  }

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
