import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const DB_SCHEMA_VERSION = 3;
const LOCAL_TOOLS = ["search_local", "get_card", "export_data", "run_report", "save_view"];
const HOOK_EVENTS = ["SessionStart", "BeforeTool", "AfterTool", "AfterSync", "BeforeExport", "SessionEnd"];
const FEATURES = {
  "sqlite-history": { stage: "stable", defaultEnabled: true, description: "Запись истории AI-запросов в SQLite." },
  sessions: { stage: "stable", defaultEnabled: true, description: "Сессии, resume и fork для AI-диалогов." },
  "api-cache": { stage: "experimental", defaultEnabled: false, description: "Локальный кеш API-ответов." },
  events: { stage: "experimental", defaultEnabled: true, description: "JSONL-события выполнения ask." },
  "mcp-management": { stage: "stable", defaultEnabled: true, description: "Команды управления MCP-интеграциями." },
  "web-search": { stage: "experimental", defaultEnabled: false, description: "Резерв под web-search режимы AI." },
};
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
  permissions: {
    localTools: {
      search_local: true,
      get_card: true,
      export_data: true,
      run_report: true,
      save_view: true,
    },
    writeFiles: true,
    sync: true,
    externalApi: true,
    externalAi: true,
    codex: true,
  },
  memory: {
    enabled: true,
  },
  hooks: {},
};
const AGENTS = {
  "data-analyst": {
    profile: null,
    tools: true,
    reasoning: "verify",
    description: "Анализирует открытые данные, ищет объекты и отвечает с опорой на локальные данные.",
  },
  "quality-checker": {
    profile: "local",
    tools: true,
    reasoning: "verify",
    prefix: "Проверь качество данных и укажи найденные проблемы: ",
    description: "Проверяет телефоны, email, ИНН и неполные карточки.",
  },
  exporter: {
    profile: "local",
    tools: true,
    reasoning: "fast",
    prefix: "Подготовь выгрузку данных: ",
    description: "Готовит CSV/JSON выгрузки через локальные инструменты.",
  },
  "mcp-helper": {
    profile: null,
    tools: false,
    description: "Помогает с MCP, профилями AI и диагностикой подключения.",
  },
  "local-fast": {
    profile: "local",
    tools: true,
    reasoning: "fast",
    description: "Быстрый локальный режим для простых запросов.",
  },
  reviewer: {
    profile: null,
    tools: false,
    prefix: "Проверь ответ и найди слабые места: ",
    description: "Режим проверки и уточнения ответов.",
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
  ["sessions", handleSessions],
  ["resume", resumeSession],
  ["fork", forkSession],
  ["features", handleFeatures],
  ["permissions", handlePermissions],
  ["memory", handleMemory],
  ["hooks", handleHooks],
  ["agents", handleAgents],
  ["mcp", handleMcp],
  ["cache", handleCache],
  ["sync", handleSync],
  ["diff", handleDiff],
  ["views", handleViews],
  ["view", handleView],
  ["card", handleCard],
  ["quality", handleQuality],
  ["report", handleReport],
  ["privacy", handlePrivacy],
  ["backup", handleBackup],
  ["alias", handleAlias],
  ["run", runNaturalLanguage],
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
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    await showHelp();
    return;
  }

  const runtime = parseGlobalOptions(argv);
  if (runtime.help) {
    await showHelp();
    return;
  }
  if (runtime.debug) {
    process.env.IOLA_DEBUG = "1";
  }
  if (runtime.debugFile) {
    process.env.IOLA_DEBUG = "1";
    process.env.IOLA_DEBUG_FILE = runtime.debugFile;
  }
  if (runtime.noColor) {
    process.env.NO_COLOR = "1";
  }

  argv = runtime.args;
  const [command = "help", ...args] = argv;
  const nodeStatus = getNodeRequirementStatus();
  if (!nodeStatus.ok && !["help", "version", "doctor", "init"].includes(command)) {
    throw new Error(`Нужен Node.js ${MIN_NODE_VERSION} или новее. Сейчас: ${nodeStatus.current}. Запустите: iola init --upgrade-node`);
  }

  const handler = COMMANDS.get(command);

  if (!handler) {
    const alias = getAlias(command);
    if (alias) {
      await main([...splitCommandLine(alias.command), ...args]);
      return;
    }
    throw new Error(`Unknown command: ${command}\nRun "iola help" to see available commands.`);
  }

  await handler(runtime.debugFile ? [...args, "--debug-file", runtime.debugFile] : args);
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
  iola sessions [--limit 20]
  iola resume SESSION_ID [TEXT]
  iola fork SESSION_ID [TEXT]
  iola features list|enable|disable
  iola permissions list|allow|deny
  iola memory show|add|set|clear|export
  iola hooks list|add|delete|run
  iola agents list|run
  iola mcp list|status|install|remove
  iola cache status|warm|clear
  iola sync [--dataset schools|kindergartens]
  iola sync status
  iola diff [schools|kindergartens]
  iola card schools 1215067180
  iola card "школа 29"
  iola quality [schools|kindergartens|missing-phones|invalid-emails|duplicate-inn]
  iola views
  iola view NAME [--format table|json|csv] [--output FILE]
  iola report schools-summary|education-contacts|missing-phones|licenses
  iola privacy
  iola backup create
  iola alias add NAME COMMAND
  iola run "выгрузи школы на Петрова в csv"
  iola config get
  iola config set api.baseUrl URL
  iola config set api.mcpBaseUrl URL
  iola config reset
  iola update
  iola ask TEXT [--profile NAME] [--model MODEL] [--tools] [--reasoning fast|verify|vote] [--output FILE] [--schema json|table] [--events] [--no-history] [--bare] [--quiet] [--no-color] [--fail-on-empty]
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
  await runHooks("SessionStart", { mode: "agent" });

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
  await runHooks("SessionEnd", { mode: "agent" });
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

  if (command === "sessions") {
    await handleSessions(args);
    return false;
  }

  if (command === "resume") {
    await resumeSession(args);
    return false;
  }

  if (command === "fork") {
    await forkSession(args);
    return false;
  }

  if (command === "features") {
    await handleFeatures(args);
    return false;
  }

  if (command === "permissions") {
    await handlePermissions(args);
    return false;
  }

  if (command === "memory") {
    await handleMemory(args);
    return false;
  }

  if (command === "hooks") {
    await handleHooks(args);
    return false;
  }

  if (command === "agents") {
    await handleAgents(args);
    return false;
  }

  if (command === "tools") {
    await handlePermissions(["tools"]);
    return false;
  }

  if (command === "mcp") {
    await handleMcp(args);
    return false;
  }

  if (command === "cache") {
    await handleCache(args);
    return false;
  }

  if (command === "sync") {
    await handleSync(args);
    return false;
  }

  if (command === "diff" || command === "card" || command === "quality" || command === "views" || command === "view" || command === "report" || command === "privacy" || command === "backup" || command === "alias" || command === "run") {
    await COMMANDS.get(command)(args);
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
    sessions: ["sessions", args],
    resume: ["resume", args],
    fork: ["fork", args],
    features: ["features", args],
    permissions: ["permissions", args],
    memory: ["memory", args],
    hooks: ["hooks", args],
    agents: ["agents", args],
    tools: ["permissions", ["tools", ...args]],
    mcp: ["mcp", args],
    cache: ["cache", args],
    sync: ["sync", args],
    diff: ["diff", args],
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
  /sessions
  /resume SESSION_ID
  /features list
  /permissions
  /tools
  /memory show
  /hooks list
  /agents list
  /mcp status
  /cache status
  /sync
  /diff
  /card школа 29
  /quality
  /views
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

  if (options.summary) {
    printTable([
      { group: "cli", status: report.cli.nodeStatus === "ok" && report.cli.update !== "available" ? "ok" : "check" },
      { group: "sqlite", status: report.db.status },
      { group: "api", status: report.api.health },
      { group: "ai", status: report.ai.provider },
      { group: "ollama", status: report.ai.ollama },
    ], [
      ["group", "Группа"],
      ["status", "Статус"],
    ]);
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
  if (options.all) {
    console.log("");
    console.log("Фичи");
    await handleFeatures(["list"]);
  }
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

async function handleSessions(args) {
  const [action] = args;
  if (action === "clear") {
    clearSessions();
    console.log("Сессии очищены.");
    return;
  }

  const options = parseOptions(args);
  const rows = listSessions(Number(options.limit || 20));

  if (options.json) {
    printJson(rows);
    return;
  }

  printTable(rows, [
    ["id", "ID"],
    ["updated_at", "Обновлена"],
    ["profile", "Профиль"],
    ["provider", "Провайдер"],
    ["model", "Модель"],
    ["messages", "Сообщ."],
    ["title", "Название"],
  ]);
}

async function resumeSession(args) {
  const [sessionId, ...questionParts] = args;
  if (!sessionId) {
    throw new Error("SESSION_ID обязателен. Пример: iola resume 1 \"продолжи\"");
  }

  const question = questionParts.join(" ").trim();
  if (!question) {
    printSessionMessages(Number(sessionId));
    return;
  }

  const session = getSession(Number(sessionId));
  await aiAsk([question, "--session", sessionId, "--profile", session.profile || "local"]);
}

async function forkSession(args) {
  const [sessionId, ...questionParts] = args;
  if (!sessionId) {
    throw new Error("SESSION_ID обязателен. Пример: iola fork 1 \"новый вопрос\"");
  }

  const forkedId = forkSessionInDb(Number(sessionId));
  console.log(`Создана новая сессия: ${forkedId}`);
  const question = questionParts.join(" ").trim();
  if (question) {
    const session = getSession(forkedId);
    await aiAsk([question, "--session", String(forkedId), "--profile", session.profile || "local"]);
  }
}

async function handleFeatures(args) {
  const [action = "list", name] = args;

  if (action === "list" || action === "ls") {
    const rows = listFeatures();
    printTable(rows, [
      ["name", "Фича"],
      ["enabled", "Вкл"],
      ["stage", "Стадия"],
      ["description", "Описание"],
    ]);
    return;
  }

  if (action === "enable" || action === "disable") {
    if (!name || !FEATURES[name]) {
      throw new Error(`Неизвестная фича. Доступно: ${Object.keys(FEATURES).join(", ")}`);
    }
    setFeatureEnabled(name, action === "enable");
    console.log(`${name}: ${action === "enable" ? "enabled" : "disabled"}`);
    return;
  }

  throw new Error("Команды features: list, enable NAME, disable NAME.");
}

async function handlePermissions(args) {
  const [action = "list", name] = args;
  const config = await loadConfig();

  if (action === "list" || action === "ls" || action === "tools") {
    const permissions = config.permissions || DEFAULT_AI_CONFIG.permissions;
    const rows = [
      ...LOCAL_TOOLS.map((tool) => ({
        permission: `localTools.${tool}`,
        value: permissions.localTools?.[tool] === false ? "deny" : "allow",
        scope: "local-tool",
      })),
      { permission: "writeFiles", value: permissions.writeFiles === false ? "deny" : "allow", scope: "runtime" },
      { permission: "sync", value: permissions.sync === false ? "deny" : "allow", scope: "runtime" },
      { permission: "externalApi", value: permissions.externalApi === false ? "deny" : "allow", scope: "network" },
      { permission: "externalAi", value: permissions.externalAi === false ? "deny" : "allow", scope: "network" },
      { permission: "codex", value: permissions.codex === false ? "deny" : "allow", scope: "external-cli" },
    ];
    printTable(rows, [
      ["permission", "Разрешение"],
      ["value", "Статус"],
      ["scope", "Область"],
    ]);
    return;
  }

  if (action === "allow" || action === "deny") {
    if (!name) {
      throw new Error("Пример: iola permissions deny export_data");
    }
    const allow = action === "allow";
    const next = { ...(config.permissions || DEFAULT_AI_CONFIG.permissions) };
    next.localTools = { ...(next.localTools || {}) };
    if (LOCAL_TOOLS.includes(name)) {
      next.localTools[name] = allow;
    } else if (name in DEFAULT_AI_CONFIG.permissions) {
      next[name] = allow;
    } else {
      throw new Error(`Неизвестное разрешение: ${name}. Доступно: ${[...LOCAL_TOOLS, "writeFiles", "sync", "externalApi", "externalAi", "codex"].join(", ")}`);
    }
    await saveConfig({ permissions: next });
    console.log(`${name}: ${allow ? "allow" : "deny"}`);
    return;
  }

  throw new Error("Команды permissions: list, tools, allow NAME, deny NAME.");
}

async function handleMemory(args) {
  const [action = "show", ...rest] = args;
  const options = parseOptions(rest);

  if (action === "show" || action === "list" || action === "ls") {
    const rows = listMemory(Number(options.limit || 50));
    if (options.json) {
      printJson(rows);
      return;
    }
    printTable(rows, [
      ["id", "ID"],
      ["scope", "Область"],
      ["content", "Память"],
      ["created_at", "Дата"],
    ]);
    return;
  }

  if (action === "add" || action === "set") {
    const text = rest.join(" ").trim();
    if (!text) {
      throw new Error('Пример: iola memory add "Отвечай кратко и по данным Йошкар-Олы"');
    }
    const id = addMemory(text, options.scope || "user");
    console.log(`Память сохранена: ${id}`);
    return;
  }

  if (action === "delete" || action === "remove" || action === "rm") {
    const id = rest[0];
    if (!id) throw new Error("Пример: iola memory delete 1");
    deleteMemory(Number(id));
    console.log(`Память удалена: ${id}`);
    return;
  }

  if (action === "clear") {
    clearMemory();
    console.log("Память очищена.");
    return;
  }

  if (action === "export") {
    const rows = listMemory(1000);
    const file = rest[0] || path.join(CONFIG_DIR, "memory-export.json");
    await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`Память экспортирована: ${file}`);
    return;
  }

  throw new Error("Команды memory: show, add TEXT, delete ID, clear, export [FILE].");
}

async function handleHooks(args) {
  const [action = "list", event, ...commandParts] = args;
  const config = await loadConfig();

  if (action === "list" || action === "ls") {
    const rows = Object.entries(config.hooks || {}).flatMap(([hookEvent, commands]) =>
      (commands || []).map((command, index) => ({ event: hookEvent, index, command })));
    printTable(rows, [
      ["event", "Событие"],
      ["index", "#"],
      ["command", "Команда"],
    ]);
    return;
  }

  if (action === "events") {
    printTable(HOOK_EVENTS.map((name) => ({ name })), [["name", "Событие"]]);
    return;
  }

  if (action === "add") {
    if (!HOOK_EVENTS.includes(event) || commandParts.length === 0) {
      throw new Error(`Пример: iola hooks add AfterSync "iola quality" Доступно: ${HOOK_EVENTS.join(", ")}`);
    }
    const hooks = { ...(config.hooks || {}) };
    hooks[event] = [...(hooks[event] || []), commandParts.join(" ")];
    await saveConfig({ hooks });
    console.log(`Hook добавлен: ${event}`);
    return;
  }

  if (action === "delete" || action === "remove") {
    const index = Number(commandParts[0] ?? event);
    const hookEvent = Number.isFinite(Number(event)) ? null : event;
    const hooks = { ...(config.hooks || {}) };
    if (hookEvent) {
      hooks[hookEvent] = (hooks[hookEvent] || []).filter((_, itemIndex) => itemIndex !== index);
    } else {
      for (const key of Object.keys(hooks)) hooks[key] = (hooks[key] || []).filter((_, itemIndex) => itemIndex !== index);
    }
    await saveConfig({ hooks });
    console.log("Hook удален.");
    return;
  }

  if (action === "run") {
    if (!HOOK_EVENTS.includes(event)) throw new Error(`Событие обязательно: ${HOOK_EVENTS.join(", ")}`);
    await runHooks(event, { manual: true });
    return;
  }

  throw new Error("Команды hooks: list, events, add EVENT COMMAND, delete EVENT INDEX, run EVENT.");
}

async function handleAgents(args) {
  const [action = "list", name, ...rest] = args;

  if (action === "list" || action === "ls") {
    const rows = Object.entries(AGENTS).map(([agent, meta]) => ({
      agent,
      profile: meta.profile || "active",
      tools: meta.tools ? "yes" : "no",
      reasoning: meta.reasoning || "-",
      description: meta.description,
    }));
    printTable(rows, [
      ["agent", "Агент"],
      ["profile", "Профиль"],
      ["tools", "Tools"],
      ["reasoning", "Reasoning"],
      ["description", "Описание"],
    ]);
    return;
  }

  if (action === "run") {
    if (!AGENTS[name]) {
      throw new Error(`Неизвестный агент: ${name}. Доступно: ${Object.keys(AGENTS).join(", ")}`);
    }
    const agent = AGENTS[name];
    const options = parseOptions(rest);
    const question = options._.join(" ").trim();
    if (!question) throw new Error(`Пример: iola agents run ${name} "найди школы на Петрова"`);
    const askArgs = [agent.prefix ? `${agent.prefix}${question}` : question, "--agent", name];
    if (agent.profile) askArgs.push("--profile", agent.profile);
    if (agent.tools) askArgs.push("--tools");
    if (agent.reasoning) askArgs.push("--reasoning", agent.reasoning);
    for (const flag of ["no-history", "quiet", "bare", "events", "fail-on-empty"]) {
      if (options[flag]) askArgs.push(`--${flag}`);
    }
    for (const flag of ["profile", "model", "output", "schema", "format", "reasoning"]) {
      if (options[flag]) askArgs.push(`--${flag}`, options[flag]);
    }
    await aiAsk(askArgs);
    return;
  }

  throw new Error("Команды agents: list, run NAME TEXT.");
}

async function handleMcp(args) {
  const [action = "status", target = "codex"] = args;

  if (action === "status") {
    const [health, version] = await Promise.all([
      fetchJson(`${await getMcpBaseUrl()}/mcp-health`),
      fetchJson(`${await getMcpBaseUrl()}/mcp-version`),
    ]);
    printKeyValue({
      endpoint: `${await getMcpBaseUrl()}/mcp`,
      status: health.status,
      server_version: version.server_version,
      layers: version.data_layers?.map((layer) => layer.id).join(", "),
    });
    return;
  }

  if (action === "list") {
    await runCommand("codex", ["mcp", "list"], { inherit: true });
    return;
  }

  if (action === "install" || action === "add") {
    await setupClient([target]);
    return;
  }

  if (action === "remove" || action === "delete") {
    if (target !== "codex") {
      throw new Error("Пока доступно удаление только Codex MCP.");
    }
    await runCommand("codex", ["mcp", "remove", "yoshkarOlaPublicData"], { inherit: true });
    return;
  }

  throw new Error("Команды mcp: status, list, install codex, remove codex.");
}

async function handleCache(args) {
  const [action = "status"] = args;
  if (action === "status") {
    printKeyValue(getCacheStatus());
    return;
  }
  if (action === "clear") {
    clearCache();
    console.log("Кеш очищен.");
    return;
  }
  if (action === "warm") {
    const result = await warmCache();
    printKeyValue(result);
    return;
  }
  throw new Error("Команды cache: status, warm, clear.");
}

async function handleSync(args) {
  const [action] = args;
  if (action === "status") {
    printTable(getSyncStatus(), [
      ["dataset", "Слой"],
      ["records", "Записей"],
      ["last_sync", "Последний sync"],
      ["status", "Статус"],
    ]);
    return;
  }
  await assertPermission("sync");
  const options = parseOptions(args);
  const datasets = options.dataset ? [options.dataset] : Object.keys(DATASETS);
  const rows = [];
  for (const dataset of datasets) {
    rows.push(await syncDataset(dataset));
  }
  await runHooks("AfterSync", { datasets, rows });
  printTable(rows, [
    ["dataset", "Слой"],
    ["records", "Записей"],
    ["status", "Статус"],
    ["message", "Сообщение"],
  ]);
}

async function handleDiff(args) {
  const [dataset] = args;
  const rows = listSyncChanges(dataset);
  printTable(rows, [
    ["created_at", "Дата"],
    ["dataset", "Слой"],
    ["change_type", "Тип"],
    ["record_key", "Ключ"],
    ["summary", "Сводка"],
  ]);
}

async function handleCard(args) {
  await ensureLocalData();
  const options = parseOptions(args);
  const query = args.join(" ").trim();
  if (!query) throw new Error('Пример: iola card "школа 29"');
  const item = findCard(query);
  if (!item) throw new Error(`Объект не найден: ${query}`);
  if (options.json) {
    printJson(item);
    return;
  }
  printKeyValue(item);
}

async function handleQuality(args) {
  const [scope = "all"] = args;
  await ensureLocalData();
  const rows = runQuality(scope);
  printTable(rows, [
    ["check", "Проверка"],
    ["dataset", "Слой"],
    ["count", "Кол-во"],
    ["sample", "Пример"],
  ]);
}

async function handleViews(args) {
  const [action, name] = args;
  if (action === "delete" || action === "remove") {
    deleteSavedView(name);
    console.log(`View удален: ${name}`);
    return;
  }
  const rows = listSavedViews();
  printTable(rows, [
    ["name", "Имя"],
    ["dataset", "Слой"],
    ["created_at", "Создано"],
  ]);
}

async function handleView(args) {
  const [name, ...rest] = args;
  if (!name) {
    throw new Error("Имя view обязательно.");
  }
  const view = getSavedView(name);
  const query = JSON.parse(view.query_json);
  await listDataset(view.dataset, [...(query.args || []), ...rest]);
}

async function handleReport(args) {
  const [name] = args;
  await ensureLocalData();
  if (name === "schools-summary") {
    printTable(getLocalSummaryRows("schools"), [["metric", "Показатель"], ["value", "Значение"]]);
    return;
  }
  if (name === "education-contacts") {
    printDatasetTable(searchLocalRecords("", { dataset: "all", limit: 500 }), "name,address,phone,email,website");
    return;
  }
  if (name === "missing-phones") {
    printDatasetTable(searchLocalRecords("", { dataset: "all", limit: 500 }).filter((item) => !item.phone || item.phone === "-"));
    return;
  }
  if (name === "licenses") {
    printDatasetTable(searchLocalRecords("", { dataset: "all", limit: 500 }), "name,license_number,license_status");
    return;
  }
  throw new Error("Отчеты: schools-summary, education-contacts, missing-phones, licenses.");
}

async function handlePrivacy() {
  printKeyValue({
    config: CONFIG_FILE,
    secrets: SECRETS_FILE,
    sqlite: DB_FILE,
    api: await getApiBaseUrl(),
    mcp: await getMcpBaseUrl(),
    keys_in_sqlite: "no",
    history_clear: "iola history clear",
    db_reset: "iola db reset",
    delete_openai_key: "iola ai key delete openai",
  });
}

async function handleBackup(args) {
  const [action = "create", fileArg] = args;
  if (action !== "create") {
    throw new Error("Пока доступно: iola backup create [FILE]");
  }
  const file = fileArg || path.join(CONFIG_DIR, `iola-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const payload = {
    created_at: new Date().toISOString(),
    config: await loadConfig(),
    db: exportDbSnapshot(),
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Backup создан: ${file}`);
}

async function handleAlias(args) {
  const [action, name, ...commandParts] = args;
  if (action === "list" || !action) {
    printTable(listAliases(), [["name", "Алиас"], ["command", "Команда"]]);
    return;
  }
  if (action === "add") {
    if (!name || commandParts.length === 0) {
      throw new Error('Пример: iola alias add petrova "data schools --where address=Петрова"');
    }
    saveAlias(name, commandParts.join(" "));
    console.log(`Алиас сохранен: ${name}`);
    return;
  }
  if (action === "delete" || action === "remove") {
    deleteAlias(name);
    console.log(`Алиас удален: ${name}`);
    return;
  }
  throw new Error("Команды alias: list, add NAME COMMAND, delete NAME.");
}

async function runNaturalLanguage(args) {
  const text = args.join(" ").trim();
  if (!text) {
    throw new Error('Пример: iola run "выгрузи школы на Петрова в csv"');
  }
  const command = inferCommandFromText(text);
  console.log(`> iola ${command.join(" ")}`);
  await main(command);
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
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER,
        title TEXT NOT NULL,
        profile TEXT,
        provider TEXT,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id, id);
      CREATE TABLE IF NOT EXISTS feature_flags (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
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
      CREATE TABLE IF NOT EXISTS local_records (
        dataset TEXT NOT NULL,
        record_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(dataset, record_key)
      );
      CREATE INDEX IF NOT EXISTS idx_local_records_dataset ON local_records(dataset);
      CREATE VIRTUAL TABLE IF NOT EXISTS local_records_fts USING fts5(dataset, record_key, searchable_text);
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        records INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        record_key TEXT NOT NULL,
        change_type TEXT NOT NULL,
        old_json TEXT,
        new_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sync_changes_dataset_created_at ON sync_changes(dataset, created_at DESC);
      CREATE TABLE IF NOT EXISTS aliases (
        name TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at DESC);
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
      const sessions = db.prepare("SELECT COUNT(*) AS count FROM sessions").get();
      const local = db.prepare("SELECT COUNT(*) AS count FROM local_records").get();
      const cache = db.prepare("SELECT COUNT(*) AS count FROM api_cache").get();
      const memory = db.prepare("SELECT COUNT(*) AS count FROM memory").get();
      return {
        status: "ok",
        file: DB_FILE,
        schema: schema?.value || "-",
        history: history?.count ?? 0,
        sessions: sessions?.count ?? 0,
        local_records: local?.count ?? 0,
        cache: cache?.count ?? 0,
        memory: memory?.count ?? 0,
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

function recordAskHistory({ question, answer, providerConfig, dataContext, error, sessionId }) {
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

function clearSessions() {
  initDatabase();
  const db = openDatabase();
  try {
    db.exec("DELETE FROM session_messages; DELETE FROM sessions;");
  } finally {
    db.close();
  }
}

function createSession(providerConfig, title, parentId = null) {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare(`
      INSERT INTO sessions(parent_id, title, profile, provider, model)
      VALUES (?, ?, ?, ?, ?)
    `).run(parentId, title.slice(0, 120), providerConfig.name || "", providerConfig.provider || "", providerConfig.model || "");
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function ensureSessionForAsk(options, providerConfig, question) {
  if (options.session) {
    return Number(options.session);
  }
  return createSession(providerConfig, question);
}

function appendSessionExchange(sessionId, question, answer, dataContext, error) {
  if (!sessionId) {
    return;
  }
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, 'user', ?, ?)")
      .run(sessionId, question, JSON.stringify(dataContext));
    db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, 'assistant', ?, ?)")
      .run(sessionId, error || answer || "", JSON.stringify({ error: error || "" }));
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  } finally {
    db.close();
  }
}

function listSessions(limit) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT s.id, s.updated_at, s.profile, s.provider, s.model, s.title, COUNT(m.id) AS messages
      FROM sessions s
      LEFT JOIN session_messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT ?
    `).all(limit);
  } finally {
    db.close();
  }
}

function getSessionAiHistory(sessionId) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT role, content FROM session_messages WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId)
      .map((row) => ({ role: row.role, content: row.content }));
  } finally {
    db.close();
  }
}

function getSession(sessionId) {
  initDatabase();
  const db = openDatabase();
  try {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (!session) {
      throw new Error(`Сессия не найдена: ${sessionId}`);
    }
    return session;
  } finally {
    db.close();
  }
}

function printSessionMessages(sessionId) {
  const rows = getSessionAiHistory(sessionId).map((row, index) => ({ id: index + 1, ...row }));
  printTable(rows, [
    ["id", "#"],
    ["role", "Роль"],
    ["content", "Текст"],
  ]);
}

function forkSessionInDb(sessionId) {
  initDatabase();
  const db = openDatabase();
  try {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (!session) {
      throw new Error(`Сессия не найдена: ${sessionId}`);
    }
    const result = db.prepare(`
      INSERT INTO sessions(parent_id, title, profile, provider, model)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, `Fork: ${session.title}`, session.profile, session.provider, session.model);
    const newId = Number(result.lastInsertRowid);
    const messages = db.prepare("SELECT role, content, context_json FROM session_messages WHERE session_id = ? ORDER BY id ASC").all(sessionId);
    const insert = db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, ?, ?, ?)");
    for (const message of messages) {
      insert.run(newId, message.role, message.content, message.context_json);
    }
    return newId;
  } finally {
    db.close();
  }
}

function listFeatures() {
  initDatabase();
  const db = openDatabase();
  try {
    return Object.entries(FEATURES).map(([name, meta]) => {
      const row = db.prepare("SELECT enabled FROM feature_flags WHERE name = ?").get(name);
      const enabled = row ? Boolean(row.enabled) : meta.defaultEnabled;
      return { name, enabled: enabled ? "yes" : "no", stage: meta.stage, description: meta.description };
    });
  } finally {
    db.close();
  }
}

function isFeatureEnabled(name) {
  const meta = FEATURES[name];
  if (!meta) {
    return false;
  }
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT enabled FROM feature_flags WHERE name = ?").get(name);
    return row ? Boolean(row.enabled) : meta.defaultEnabled;
  } finally {
    db.close();
  }
}

function setFeatureEnabled(name, enabled) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare(`
      INSERT INTO feature_flags(name, enabled, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(name, enabled ? 1 : 0);
  } finally {
    db.close();
  }
}

async function fetchJsonMaybeCached(url, options = {}) {
  if (!options.cache && !isFeatureEnabled("api-cache")) {
    return fetchJson(url);
  }
  const cached = getCachedResponse(url);
  if (cached) {
    return cached;
  }
  const payload = await fetchJson(url);
  setCachedResponse(url, payload, 3600);
  return payload;
}

function getCachedResponse(url) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT response_json, expires_at FROM api_cache WHERE key = ?").get(cacheKey(url));
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return JSON.parse(row.response_json);
  } finally {
    db.close();
  }
}

function setCachedResponse(url, payload, ttlSeconds) {
  initDatabase();
  const db = openDatabase();
  try {
    const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    db.prepare(`
      INSERT INTO api_cache(key, url, response_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at, created_at = excluded.created_at
    `).run(cacheKey(url), url, JSON.stringify(payload), expires);
  } finally {
    db.close();
  }
}

function cacheKey(url) {
  return Buffer.from(url).toString("base64url");
}

function getCacheStatus() {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM api_cache").get();
    return { status: "ok", entries: row?.count ?? 0 };
  } finally {
    db.close();
  }
}

function clearCache() {
  initDatabase();
  const db = openDatabase();
  try {
    db.exec("DELETE FROM api_cache");
  } finally {
    db.close();
  }
}

async function warmCache() {
  const urls = [
    `${await getMcpBaseUrl()}/mcp-version`,
    `${await getMcpBaseUrl()}/mcp-health`,
    `${await getApiBaseUrl()}/schools?limit=100&offset=0`,
    `${await getApiBaseUrl()}/kindergartens?limit=100&offset=0`,
  ];
  for (const url of urls) {
    setCachedResponse(url, await fetchJson(url), 3600);
  }
  return { status: "ok", entries: urls.length };
}

async function syncDataset(dataset) {
  if (!DATASETS[dataset]) {
    throw new Error(`Неизвестный слой: ${dataset}`);
  }
  await assertPermission("externalApi");
  try {
    const payload = await fetchJson(`${await getApiBaseUrl()}/${DATASETS[dataset].endpoint}?limit=500&offset=0`);
    const items = normalizeItems(payload);
    saveLocalRecords(dataset, items);
    recordSyncRun(dataset, items.length, "ok", "");
    return { dataset, records: items.length, status: "ok", message: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordSyncRun(dataset, 0, "error", message);
    return { dataset, records: 0, status: "error", message };
  }
}

function saveLocalRecords(dataset, items) {
  initDatabase();
  const db = openDatabase();
  try {
    const oldRows = db.prepare("SELECT record_key, record_json FROM local_records WHERE dataset = ?").all(dataset);
    const oldMap = new Map(oldRows.map((row) => [row.record_key, row.record_json]));
    const newKeys = new Set();
    db.prepare("DELETE FROM local_records WHERE dataset = ?").run(dataset);
    db.prepare("DELETE FROM local_records_fts WHERE dataset = ?").run(dataset);
    const insert = db.prepare("INSERT INTO local_records(dataset, record_key, record_json, searchable_text, synced_at) VALUES (?, ?, ?, ?, datetime('now'))");
    const insertFts = db.prepare("INSERT INTO local_records_fts(dataset, record_key, searchable_text) VALUES (?, ?, ?)");
    const insertChange = db.prepare("INSERT INTO sync_changes(dataset, record_key, change_type, old_json, new_json) VALUES (?, ?, ?, ?, ?)");
    for (const item of items) {
      const summary = selectPublicSummary(item);
      const key = String(summary.inn || item.id || `${dataset}-${Math.random()}`);
      newKeys.add(key);
      const newJson = JSON.stringify(item);
      const oldJson = oldMap.get(key);
      if (!oldJson) insertChange.run(dataset, key, "added", null, newJson);
      else if (oldJson !== newJson) insertChange.run(dataset, key, "changed", oldJson, newJson);
      const text = JSON.stringify(summary).toLocaleLowerCase("ru-RU");
      insert.run(dataset, key, newJson, text);
      insertFts.run(dataset, key, text);
    }
    for (const [key, oldJson] of oldMap.entries()) {
      if (!newKeys.has(key)) insertChange.run(dataset, key, "removed", oldJson, null);
    }
  } finally {
    db.close();
  }
}

function recordSyncRun(dataset, records, status, message) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO sync_runs(dataset, records, status, message) VALUES (?, ?, ?, ?)").run(dataset, records, status, message);
  } finally {
    db.close();
  }
}

async function ensureLocalData() {
  const status = getDbStatus();
  if (Number(status.local_records || 0) === 0) {
    await handleSync([]);
  }
}

function searchLocalRecords(query, options = {}) {
  initDatabase();
  const db = openDatabase();
  const dataset = options.dataset || "all";
  const limit = Number(options.limit || 20);
  try {
    if (options.fts && query) {
      const ftsQuery = query.split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, "")}"`).join(" ");
      const params = dataset === "all" ? [ftsQuery, limit] : [ftsQuery, dataset, limit];
      const sql = dataset === "all"
        ? "SELECT r.record_json FROM local_records_fts f JOIN local_records r ON r.dataset=f.dataset AND r.record_key=f.record_key WHERE local_records_fts MATCH ? LIMIT ?"
        : "SELECT r.record_json FROM local_records_fts f JOIN local_records r ON r.dataset=f.dataset AND r.record_key=f.record_key WHERE local_records_fts MATCH ? AND f.dataset = ? LIMIT ?";
      return db.prepare(sql).all(...params).map((row) => selectPublicSummary(JSON.parse(row.record_json)));
    }
    const params = [];
    let sql = "SELECT dataset, record_json FROM local_records";
    const where = [];
    if (dataset !== "all") {
      where.push("dataset = ?");
      params.push(dataset);
    }
    if (query) {
      where.push("searchable_text LIKE ?");
      params.push(`%${query.toLocaleLowerCase("ru-RU")}%`);
    }
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY dataset, record_key LIMIT ?";
    params.push(limit);
    return db.prepare(sql).all(...params).map((row) => selectPublicSummary(JSON.parse(row.record_json)));
  } finally {
    db.close();
  }
}

function getSyncStatus() {
  initDatabase();
  const db = openDatabase();
  try {
    return Object.keys(DATASETS).map((dataset) => {
      const records = db.prepare("SELECT COUNT(*) AS count FROM local_records WHERE dataset = ?").get(dataset);
      const run = db.prepare("SELECT status, created_at FROM sync_runs WHERE dataset = ? ORDER BY id DESC LIMIT 1").get(dataset);
      return { dataset, records: records?.count || 0, last_sync: run?.created_at || "-", status: run?.status || "never" };
    });
  } finally {
    db.close();
  }
}

function listSyncChanges(dataset) {
  initDatabase();
  const db = openDatabase();
  try {
    const rows = dataset
      ? db.prepare("SELECT * FROM sync_changes WHERE dataset = ? ORDER BY id DESC LIMIT 50").all(dataset)
      : db.prepare("SELECT * FROM sync_changes ORDER BY id DESC LIMIT 50").all();
    return rows.map((row) => ({
      ...row,
      summary: summarizeChange(row),
    }));
  } finally {
    db.close();
  }
}

function summarizeChange(row) {
  const payload = row.new_json || row.old_json;
  if (!payload) return "-";
  try {
    const item = selectPublicSummary(JSON.parse(payload));
    return item.name || item.inn || "-";
  } catch {
    return "-";
  }
}

function findCard(query) {
  const normalized = query.toLocaleLowerCase("ru-RU");
  const dataset = normalized.includes("сад") ? "kindergartens" : normalized.includes("школ") || normalized.includes("лицей") ? "schools" : "all";
  const inn = normalized.match(/\b\d{10,12}\b/)?.[0];
  const number = normalized.match(/\b\d{1,3}\b/)?.[0];
  const rows = searchLocalRecords(inn || number || query, { dataset, limit: 20, fts: false });
  if (inn) return rows.find((row) => String(row.inn) === inn) || null;
  if (number) return rows.find((row) => String(row.name || "").includes(`№ ${number}`) || String(row.name || "").includes(`№${number}`)) || rows[0] || null;
  return rows[0] || null;
}

function runQuality(scope) {
  const datasets = ["schools", "kindergartens"];
  const rows = [];
  for (const dataset of datasets) {
    if (scope !== "all" && scope !== dataset && !scope.includes("-")) continue;
    const records = searchLocalRecords("", { dataset, limit: 1000 });
    const missingPhones = records.filter((item) => !item.phone || item.phone === "-");
    const invalidEmails = records.filter((item) => item.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.email));
    const innCounts = new Map();
    for (const item of records) innCounts.set(item.inn, (innCounts.get(item.inn) || 0) + 1);
    const duplicateInn = records.filter((item) => item.inn && innCounts.get(item.inn) > 1);
    if (scope === "all" || scope === dataset || scope === "missing-phones") rows.push({ check: "missing-phones", dataset, count: missingPhones.length, sample: missingPhones[0]?.name || "-" });
    if (scope === "all" || scope === dataset || scope === "invalid-emails") rows.push({ check: "invalid-emails", dataset, count: invalidEmails.length, sample: invalidEmails[0]?.email || "-" });
    if (scope === "all" || scope === dataset || scope === "duplicate-inn") rows.push({ check: "duplicate-inn", dataset, count: duplicateInn.length, sample: duplicateInn[0]?.inn || "-" });
  }
  return rows;
}

function saveView(name, dataset, args) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare(`
      INSERT INTO saved_views(name, dataset, query_json) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET dataset = excluded.dataset, query_json = excluded.query_json
    `).run(name, dataset, JSON.stringify({ args }));
  } finally {
    db.close();
  }
}

function listSavedViews() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT name, dataset, created_at FROM saved_views ORDER BY name").all();
  } finally {
    db.close();
  }
}

function getSavedView(name) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM saved_views WHERE name = ?").get(name);
    if (!row) throw new Error(`View не найден: ${name}`);
    return row;
  } finally {
    db.close();
  }
}

function deleteSavedView(name) {
  if (!name) {
    throw new Error("Имя view обязательно.");
  }
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM saved_views WHERE name = ?").run(name);
  } finally {
    db.close();
  }
}

function getLocalSummaryRows(dataset) {
  const rows = searchLocalRecords("", { dataset, limit: 1000 });
  return [
    { metric: "records", value: rows.length },
    { metric: "with_phone", value: rows.filter((row) => row.phone && row.phone !== "-").length },
    { metric: "with_email", value: rows.filter((row) => row.email).length },
    { metric: "with_website", value: rows.filter((row) => row.website).length },
  ];
}

function exportDbSnapshot() {
  initDatabase();
  return {
    db: getDbStatus(),
    views: listSavedViews(),
    aliases: listAliases(),
    features: listFeatures(),
    memory: listMemory(1000),
    sessions: listSessions(100),
    history: listHistory(100),
  };
}

function listMemory(limit = 50) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, scope, content, created_at FROM memory ORDER BY id DESC LIMIT ?").all(limit);
  } finally {
    db.close();
  }
}

function addMemory(content, scope = "user") {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO memory(scope, content) VALUES (?, ?)").run(scope, content);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function deleteMemory(id) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM memory WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

function clearMemory() {
  initDatabase();
  const db = openDatabase();
  try {
    db.exec("DELETE FROM memory");
  } finally {
    db.close();
  }
}

function buildMemoryText(limit = 20) {
  const rows = listMemory(limit).reverse();
  return rows.map((row) => `- ${row.content}`).join("\n");
}

function listAliases() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT name, command FROM aliases ORDER BY name").all();
  } finally {
    db.close();
  }
}

function getAlias(name) {
  try {
    initDatabase();
    const db = openDatabase();
    try {
      return db.prepare("SELECT name, command FROM aliases WHERE name = ?").get(name);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function saveAlias(name, command) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO aliases(name, command) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET command = excluded.command").run(name, command);
  } finally {
    db.close();
  }
}

function deleteAlias(name) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM aliases WHERE name = ?").run(name);
  } finally {
    db.close();
  }
}

function inferCommandFromText(text) {
  const normalized = text.toLocaleLowerCase("ru-RU");
  const dataset = normalized.includes("сад") ? "kindergartens" : "schools";
  const command = ["data", dataset];
  const street = normalized.match(/(?:на|по|улица|ул\.?)\s+([а-яёa-z-]+)/iu)?.[1];
  if (street) command.push("--where", `address=${street}`);
  if (normalized.includes("csv")) command.push("--format", "csv");
  if (normalized.includes("json")) command.push("--format", "json");
  const output = text.match(/(?:в файл|файл)\s+([^\s]+)/iu)?.[1];
  if (output) command.push("--output", output);
  return command;
}

async function outputData(value, options, format) {
  const text = format === "csv" ? toCsv(value) : `${JSON.stringify(value, null, 2)}\n`;
  if (options.output) {
    await assertPermission("writeFiles");
    await writeFile(options.output, text, "utf8");
    console.log(`Файл сохранен: ${options.output}`);
    return;
  }
  process.stdout.write(text);
}

function toCsv(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return "";
  const columns = [...new Set(list.flatMap((row) => Object.keys(row)))];
  return `${columns.map(csvCell).join(",")}\n${list.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
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
  if (providerConfig.provider === "codex") await assertPermission("codex");
  if (providerConfig.provider !== "ollama") await assertPermission("externalAi");
  if (options.tools && providerConfig.provider === "ollama") {
    return localToolAsk(question, providerConfig, options);
  }
  applyRuntimeConfig(providerConfig, options.config);
  const dataContext = options.bare ? { layers: [], query: { text: question, terms: [], patterns: { numbers: [], inns: [], streets: [], targetLayers: [] } }, schools: [], kindergartens: [] } : await buildDataContext(question);
  emitEvent(options, "context_loaded", { schools: dataContext.schools.length, kindergartens: dataContext.kindergartens.length });
  const historyEnabled = !options.bare && !options["no-history"] && isFeatureEnabled("sqlite-history");
  const sessionId = historyEnabled && isFeatureEnabled("sessions") ? ensureSessionForAsk(options, providerConfig, question) : null;
  const history = context.history || (sessionId ? getSessionAiHistory(sessionId) : []);
  const messages = buildAiMessages(question, dataContext, history, options);
  let answer = "";
  let errorMessage = "";

  try {
    emitEvent(options, "provider_selected", { profile: providerConfig.name, provider: providerConfig.provider, model: providerConfig.model });
    answer = await callAiProvider(providerConfig, messages);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (historyEnabled) {
      recordAskHistory({ question, answer: "", providerConfig, dataContext, error: errorMessage, sessionId });
      appendSessionExchange(sessionId, question, "", dataContext, errorMessage);
    }
    throw error;
  }

  if (historyEnabled) {
    recordAskHistory({ question, answer, providerConfig, dataContext, error: "", sessionId });
    appendSessionExchange(sessionId, question, answer, dataContext, "");
  }

  emitEvent(options, "answer", { length: answer.length, sessionId });

  if (options.output) {
    await assertPermission("writeFiles");
    await writeFile(options.output, answer, "utf8");
  }

  if (options["fail-on-empty"] && !answer.trim()) {
    throw new Error("AI вернул пустой ответ.");
  }

  if (options.format === "json" || options.schema === "json") {
    printJson({ answer, profile: providerConfig.name, provider: providerConfig.provider, model: providerConfig.model, sessionId, context: dataContext });
    return answer;
  }

  if (!options.quiet) console.log(answer);
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
    temperature: options.temperature || activeProfile.temperature,
  };
}

async function localToolAsk(question, providerConfig, options) {
  await ensureLocalData();
  const plan = await buildLocalToolPlan(question, providerConfig, options);
  const validated = validateToolPlan(plan);
  const result = await executeToolPlan(validated);
  const answer = formatToolResult(result, options);

  if (!options["no-history"] && isFeatureEnabled("sqlite-history")) {
    recordAskHistory({
      question,
      answer,
      providerConfig,
      dataContext: { tool_plan: validated, tool_result: result },
      error: "",
      sessionId: null,
    });
  }

  emitEvent(options, "tool_plan", { plan: validated });
  if (options.output) {
    await assertPermission("writeFiles");
    await writeFile(options.output, answer, "utf8");
  }
  if (options.format === "json" || options.schema === "json") {
    printJson({ answer, plan: validated, result });
  } else {
    if (!options.quiet) console.log(answer);
  }
  return answer;
}

async function buildLocalToolPlan(question, providerConfig, options) {
  const mode = options.reasoning || "verify";
  const prompt = [
    "Ты планировщик CLI iola. Верни только JSON.",
    "Доступные tools: search_local, get_card, export_data, run_report, save_view.",
    "Схема: {\"steps\":[{\"tool\":\"search_local\",\"args\":{\"dataset\":\"schools|kindergartens|all\",\"query\":\"text\",\"limit\":10}}]}",
    "Для выгрузки CSV добавь export_data с format=csv и output, если пользователь назвал файл.",
    `Вопрос: ${question}`,
  ].join("\n");

  try {
    const raw = await callOllama(providerConfig, [{ role: "user", content: prompt }]);
    const parsed = parseJsonObject(raw);
    if (mode === "vote") {
      return chooseBestPlan([parsed, inferToolPlan(question)]);
    }
    return parsed;
  } catch {
    return inferToolPlan(question);
  }
}

function parseJsonObject(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON-план не найден.");
  return JSON.parse(match[0]);
}

function inferToolPlan(question) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const dataset = normalized.includes("сад") ? "kindergartens" : normalized.includes("школ") || normalized.includes("лицей") ? "schools" : "all";
  const steps = [];
  if (normalized.includes("без телефона")) {
    steps.push({ tool: "run_report", args: { name: "missing-phones" } });
  } else {
    const query = normalized.match(/петрова|школ[а-яё ]*\d+|сад[а-яё ]*\d+|лицей[а-яё ]*\d+/iu)?.[0] || question;
    steps.push({ tool: "search_local", args: { dataset, query, limit: 20 } });
  }
  if (normalized.includes("csv") || normalized.includes("выгруз")) {
    steps.push({ tool: "export_data", args: { format: "csv", output: normalized.match(/([a-z0-9_-]+\.csv)/i)?.[1] || "iola-export.csv" } });
  }
  return { steps };
}

function chooseBestPlan(plans) {
  return plans.find((plan) => {
    try {
      validateToolPlan(plan);
      return true;
    } catch {
      return false;
    }
  }) || plans.at(-1);
}

function validateToolPlan(plan) {
  const allowed = new Set(LOCAL_TOOLS);
  if (!plan || !Array.isArray(plan.steps)) throw new Error("Некорректный tool-plan.");
  for (const step of plan.steps) {
    if (!allowed.has(step.tool)) throw new Error(`Недопустимый tool: ${step.tool}`);
  }
  return plan;
}

async function executeToolPlan(plan) {
  let current = [];
  const outputs = [];
  for (const step of plan.steps) {
    await assertPermission(step.tool);
    await runHooks("BeforeTool", { tool: step.tool, args: step.args || {} });
    if (step.tool === "search_local") {
      current = searchLocalRecords(step.args?.query || "", { dataset: step.args?.dataset || "all", limit: step.args?.limit || 20, fts: true });
      outputs.push({ tool: step.tool, rows: current.length });
    } else if (step.tool === "get_card") {
      const card = findCard(step.args?.query || "");
      current = card ? [card] : [];
      outputs.push({ tool: step.tool, rows: current.length });
    } else if (step.tool === "run_report") {
      current = runQuality(step.args?.name || "all");
      outputs.push({ tool: step.tool, rows: current.length });
    } else if (step.tool === "save_view") {
      saveView(step.args?.name, step.args?.dataset || "all", step.args?.args || []);
      outputs.push({ tool: step.tool, saved: step.args?.name });
    } else if (step.tool === "export_data") {
      await assertPermission("writeFiles");
      await runHooks("BeforeExport", { output: step.args?.output || "iola-export.csv", format: step.args?.format || "csv", rows: current.length });
      const text = step.args?.format === "json" ? JSON.stringify(current, null, 2) : toCsv(current);
      await writeFile(step.args?.output || "iola-export.csv", text, "utf8");
      outputs.push({ tool: step.tool, output: step.args?.output || "iola-export.csv", rows: current.length });
    }
    await runHooks("AfterTool", { tool: step.tool, rows: current.length });
  }
  return { rows: current, outputs };
}

function formatToolResult(result, options) {
  if (options.schema === "json") return JSON.stringify(result, null, 2);
  const exported = result.outputs.find((item) => item.output);
  if (exported) return `Готово. Файл сохранен: ${exported.output}. Записей: ${exported.rows}`;
  if (!result.rows.length) return "Данных не найдено.";
  return result.rows.slice(0, 10).map((row) => `${row.name || row.check}: ${row.address || row.count || ""}`).join("\n");
}

function applyRuntimeConfig(target, value) {
  if (!value) {
    return;
  }
  const [key, ...parts] = String(value).split("=");
  if (!key || parts.length === 0) {
    throw new Error("Флаг --config должен быть в формате key=value.");
  }
  setConfigValue(target, key, parts.join("="));
}

async function runHooks(event, payload = {}) {
  const config = await loadConfig();
  const commands = config.hooks?.[event] || [];
  for (const command of commands) {
    const parts = splitCommandLine(command);
    if (parts.length === 0) continue;
    await runCommand(parts[0], parts.slice(1), {
      inherit: true,
      env: {
        IOLA_HOOK_EVENT: event,
        IOLA_HOOK_PAYLOAD: JSON.stringify(payload),
      },
    });
  }
}

async function assertPermission(name) {
  const config = await loadConfig();
  const permissions = config.permissions || DEFAULT_AI_CONFIG.permissions;
  if (LOCAL_TOOLS.includes(name)) {
    if (permissions.localTools?.[name] === false) {
      throw new Error(`Tool запрещен политикой permissions: ${name}`);
    }
    return;
  }
  if (permissions[name] === false) {
    throw new Error(`Действие запрещено политикой permissions: ${name}`);
  }
}

function emitEvent(options, type, data) {
  if (!options.events) {
    return;
  }
  printJson({ type, at: new Date().toISOString(), ...data });
}

async function buildDataContext(question) {
  await assertPermission("externalApi");
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

function buildAiMessages(question, dataContext, history, options = {}) {
  const sourceLines = buildSourceLines(dataContext);
  const memoryText = options.bare ? "" : buildMemoryText();
  const system = [
    "Ты терминальный AI-ассистент CLI-проекта Йошкар-Олы.",
    "Отвечай на русском языке.",
    "Используй только данные из переданного контекста.",
    "Если в контексте нет нужных сведений, прямо напиши, что данных недостаточно.",
    "Не выдумывай адреса, телефоны, лицензии и руководителей.",
    "Если отвечаешь по конкретным организациям, укажи источник в конце: слой, название и ИНН.",
    options.schema === "json" ? "Верни валидный JSON без markdown-обертки." : "",
    options.schema === "table" ? "Если уместно, верни ответ в виде markdown-таблицы." : "",
    memoryText ? `Учитывай пользовательскую память:\n${memoryText}` : "",
    "Отвечай кратко и по делу.",
  ].filter(Boolean).join(" ");
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
      temperature: Number(config.temperature ?? 0.2),
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

  const data = options.local
      ? searchLocalRecords(options.search || options._.join(" ") || "", { dataset, limit: Number(options.limit || 20), fts: options.fts })
    : normalizeItems(await fetchJsonMaybeCached(`${await getApiBaseUrl()}/${DATASETS[dataset].endpoint}?${params}`, options));
  const items = data;
  const filtered = applyDatasetFilters(items, options);
  const limited = filtered.slice(0, Number(options.limit || 20));
  const summarized = limited.map(selectPublicSummary);
  const projected = projectColumns(summarized, options.columns);
  if (options.save) {
    saveView(options.save, dataset, args.filter((arg) => arg !== "--save" && arg !== options.save));
    console.log(`View сохранен: ${options.save}`);
  }

  if (options.json || options.format === "json") {
    await outputData(projected, options, "json");
    return;
  }

  if (options.format === "csv") {
    await outputData(projected, options, "csv");
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

  const limit = Number(options.limit || 5);
  const [schools, kindergartens] = options.local
    ? [
        searchLocalRecords(query, { dataset: "schools", limit, fts: options.fts }),
        searchLocalRecords(query, { dataset: "kindergartens", limit, fts: options.fts }),
      ]
    : await Promise.all([
        fetchJsonMaybeCached(`${await getApiBaseUrl()}/schools?limit=100&offset=0`, options),
        fetchJsonMaybeCached(`${await getApiBaseUrl()}/kindergartens?limit=100&offset=0`, options),
      ]);

  const result = {
    schools: projectColumns(filterItems(normalizeItems(schools), query).slice(0, limit).map(selectPublicSummary), options.columns),
    kindergartens: projectColumns(filterItems(normalizeItems(kindergartens), query).slice(0, limit).map(selectPublicSummary), options.columns),
  };

  if (options.json || options.format === "json") {
    await outputData(result, options, "json");
    return;
  }

  if (options.format === "csv") {
    await outputData([
      ...result.schools.map((item) => ({ layer: "schools", ...item })),
      ...result.kindergartens.map((item) => ({ layer: "kindergartens", ...item })),
    ], options, "csv");
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

  await runCommand("codex", ["mcp", "add", "yoshkarOlaPublicData", "--url", `${await getMcpBaseUrl()}/mcp`], { inherit: true });
  await runCommand("npx", ["-y", "@iola_adm/yoshkar-ola-public-mcp", "install-skill", "codex"], { inherit: true });
  console.log("Codex MCP и skill установлены.");
}

function parseOptions(args) {
  const result = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--yes" || arg === "--silent" || arg === "--events" || arg === "--no-history" || arg === "--summary" || arg === "--all" || arg === "--local" || arg === "--cache" || arg === "--tools" || arg === "--fts" || arg === "--bare" || arg === "--quiet" || arg === "--no-color" || arg === "--fail-on-empty" || arg === "--debug") {
      result[arg.slice(2)] = true;
    } else if (arg === "--check" || arg === "--upgrade-node") {
      result.check = true;
      result[arg.slice(2)] = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--where" || arg === "--columns" || arg === "--inn" || arg === "--model" || arg === "--provider" || arg === "--profile" || arg === "--name" || arg === "--base-url" || arg === "--sandbox" || arg === "--approval" || arg === "--cwd" || arg === "--codex-profile" || arg === "--format" || arg === "--output" || arg === "--schema" || arg === "--session" || arg === "--temperature" || arg === "--config" || arg === "--dataset" || arg === "--save" || arg === "--reasoning" || arg === "--agent" || arg === "--scope" || arg === "--debug-file") {
      result[arg.slice(2)] = args[index + 1];
      index += 1;
    } else {
      result._.push(arg);
    }
  }

  return result;
}

function parseGlobalOptions(argv) {
  const result = { args: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--debug") result.debug = true;
    else if (arg === "--no-color") result.noColor = true;
    else if (arg === "--debug-file") {
      result.debugFile = argv[index + 1];
      index += 1;
    } else result.args.push(arg);
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
    if (process.env.IOLA_DEBUG) {
      console.error(`[debug] run: ${command} ${args.join(" ")}`);
      debugLog(`run: ${command} ${args.join(" ")}`);
    }
    const child = execFile(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 5,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
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

function debugLog(message) {
  if (!process.env.IOLA_DEBUG_FILE) return;
  appendFile(process.env.IOLA_DEBUG_FILE, `[${new Date().toISOString()}] ${message}\n`, "utf8").catch(() => {});
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
