import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { appendFile, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";
const MIN_NODE_VERSION = "22.5.0";
const CONFIG_DIR = path.join(os.homedir(), ".iola");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LAST_GOOD_CONFIG_FILE = path.join(CONFIG_DIR, "config.last-good.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");
const DB_FILE = path.join(CONFIG_DIR, "iola.db");
const DB_SCHEMA_VERSION = 8;
const IOLA_LOCAL_MODEL = "iola-router-1b";
const IOLA_LOCAL_OLLAMA_MODEL = "gemma3:1b";
const IOLA_ROUTER_HF_REPO = process.env.IOLA_ROUTER_HF_REPO || "LMSerg/iola-1b-router-2026-05-28-merged";
const IOLA_MODEL_DIR = path.join(CONFIG_DIR, "models", "router");
const IOLA_MODEL_RUNTIME_DIR = path.join(CONFIG_DIR, "model-runtime");
const IOLA_MODEL_RUNNER = path.resolve(__dirname, "iola_hf_runner.py");
const PROJECT_IOLA_DIR = path.join(process.cwd(), ".iola");
const PROJECT_CONFIG_FILE = path.join(PROJECT_IOLA_DIR, "config.json");
const LOCAL_CONFIG_FILE = path.join(PROJECT_IOLA_DIR, "local.json");
const BROWSER_RUNTIME_DIR = path.join(CONFIG_DIR, "browser-runtime");
const BROWSER_RUNTIME_PACKAGE = path.join(BROWSER_RUNTIME_DIR, "node_modules", "playwright", "package.json");
const INDEXABLE_EXTENSIONS = /\.(md|txt|csv|json|html|docx|xlsx|pptx|pdf)$/i;
const LOCAL_TOOLS = ["search_data", "search_entities", "resolve_entity_field", "get_card", "export_report", "file_read", "browser_open"];
const LEGACY_LOCAL_TOOLS = ["search_local", "export_data", "run_report", "save_view"];
const FILE_TOOLS = ["files_tree", "files_read", "files_search", "files_write", "files_patch"];
const ALL_LOCAL_TOOLS = [...LOCAL_TOOLS, ...FILE_TOOLS];
const ALL_TOOL_ALIASES = [...ALL_LOCAL_TOOLS, ...LEGACY_LOCAL_TOOLS];
const HOOK_EVENTS = ["SessionStart", "BeforeTool", "AfterTool", "PreToolUse", "PostToolUse", "OnError", "AfterSync", "BeforeExport", "SessionEnd"];
const DAEMON_PORT = Number(process.env.IOLA_DAEMON_PORT || 18790);
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, "..", "skills");
const USER_SKILLS_DIR = path.join(CONFIG_DIR, "skills");
const PROJECT_CONTEXT_FILE = path.join(process.cwd(), "IOLA.md");
const PROJECT_CONTEXT_DIR_FILE = path.join(process.cwd(), ".iola", "context.md");
const TOOLSETS = {
  "data-read": {
    description: "Чтение открытых данных и локальный поиск.",
    permissions: { externalApi: true, localTools: { search_data: true, get_card: true, export_report: true } },
  },
  reports: {
    description: "Отчеты, выгрузки и сохранение view.",
    permissions: { writeFiles: true, localTools: { export_report: true } },
  },
  sync: {
    description: "Обновление локальной копии данных из публичного API.",
    permissions: { sync: true, externalApi: true },
  },
  ai: {
    description: "Внешние AI-провайдеры и Codex CLI.",
    permissions: { externalAi: true, codex: true },
  },
  "local-files-read": {
    description: "Чтение файлов, дерево папок и поиск внутри workspace.",
    permissions: { readFiles: true, localTools: { files_tree: true, files_read: true, files_search: true } },
  },
  "local-files-write": {
    description: "Запись и patch файлов внутри workspace с учетом approvals.",
    permissions: { readFiles: true, writeFiles: true, editFiles: true, localTools: { files_write: true, files_patch: true } },
  },
  safe: {
    description: "Безопасный режим: чтение данных без записи файлов и без sync.",
    permissions: { readFiles: true, writeFiles: false, editFiles: false, deleteFiles: false, sync: false, externalApi: true, externalAi: true, codex: false },
  },
  full: {
    description: "Полный локальный режим для доверенного пользователя.",
    permissions: {
      writeFiles: true,
      sync: true,
      externalApi: true,
      externalAi: true,
      codex: true,
      readFiles: true,
      editFiles: true,
      deleteFiles: false,
      localTools: Object.fromEntries(ALL_LOCAL_TOOLS.map((tool) => [tool, true])),
    },
  },
};
const FEATURES = {
  "sqlite-history": { stage: "stable", defaultEnabled: true, description: "Запись истории AI-запросов в SQLite." },
  sessions: { stage: "stable", defaultEnabled: true, description: "Сессии, resume и fork для AI-диалогов." },
  "api-cache": { stage: "experimental", defaultEnabled: false, description: "Локальный кеш API-ответов." },
  events: { stage: "experimental", defaultEnabled: true, description: "JSONL-события выполнения ask." },
  "mcp-management": { stage: "stable", defaultEnabled: true, description: "Команды управления MCP-интеграциями." },
  "web-search": { stage: "experimental", defaultEnabled: false, description: "Резерв под web-search режимы AI." },
};
const SKILL_BUNDLES = {
  analyst: {
    description: "Аналитик открытых данных: поиск, карточки, отчеты и память.",
    skills: ["open-data", "reports", "local-model"],
    requirements: ["Локальная SQLite-БД", "публичный API"],
  },
  documents: {
    description: "Работа с локальными документами, индексом, архивами и выгрузками.",
    skills: ["open-data", "reports"],
    requirements: ["files mode read-only/workspace-write", "7-Zip для архивов"],
  },
  "local-agent": {
    description: "Локальная модель IOLA с проверочным reasoning и локальными tools.",
    skills: ["local-model", "open-data"],
    requirements: ["Python", "локальная модель"],
  },
};
let onboardRanThisProcess = false;
const DEFAULT_AI_CONFIG = {
  api: {
    baseUrl: "https://apiiola.yasg.ru/api/v1",
    mcpBaseUrl: "https://apiiola.yasg.ru",
  },
  ai: {
    activeProfile: "local",
    provider: "iola",
    model: IOLA_LOCAL_MODEL,
    profiles: {
      local: {
        provider: "iola",
        model: IOLA_LOCAL_MODEL,
        repo: IOLA_ROUTER_HF_REPO,
        modelDir: IOLA_MODEL_DIR,
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
      search_data: true,
      search_entities: true,
      resolve_entity_field: true,
      get_card: true,
      export_report: true,
      file_read: false,
      browser_open: true,
      files_tree: false,
      files_read: false,
      files_search: false,
      files_write: false,
      files_patch: false,
    },
    readFiles: false,
    writeFiles: true,
    editFiles: false,
    deleteFiles: false,
    sync: true,
    externalApi: true,
    externalAi: true,
    codex: true,
  },
  toolsets: {
    enabled: ["data-read", "reports", "sync", "ai"],
  },
  files: {
    mode: "locked",
    approvals: "on-write",
    workspaceRoot: ".",
    maxReadBytes: 200000,
    blockedGlobs: [".env", "*.pem", "*.key", "secrets", ".git", ".ssh", "AppData", "node_modules"],
  },
  memory: {
    enabled: true,
    suggestions: true,
  },
  skills: {
    enabled: ["education", "open-data", "reports", "local-model", "local-files", "browser-agent"],
  },
  daemon: {
    host: "127.0.0.1",
    port: DAEMON_PORT,
  },
  mcp: {
    servers: {},
  },
  cron: {
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
    category: "Образование",
    endpoint: "schools",
    aliases: ["школ", "лицей", "гимнази"],
    searchFields: ["name", "address", "head", "inn"],
    personFields: ["head"],
  },
  kindergartens: {
    title: "Детские сады",
    category: "Образование",
    endpoint: "kindergartens",
    aliases: ["сад", "детсад", "детский сад", "доу", "мбдоу"],
    searchFields: ["name", "address", "head", "inn"],
    personFields: ["head"],
  },
};
const SLASH_COMMANDS = [
  { command: "/help", description: "список slash-команд" },
  { command: "/health", description: "проверка публичного API/MCP" },
  { command: "/doctor", description: "диагностика CLI" },
  { command: "/master", description: "мастер настройки" },
  { command: "/db status", description: "статус локальной SQLite-БД" },
  { command: "/sessions", description: "AI-сессии" },
  { command: "/resume SESSION_ID", description: "продолжить сессию" },
  { command: "/features list", description: "feature flags" },
  { command: "/wiki", description: "ссылки на документацию" },
  { command: "/context list", description: "локальный контекст проекта" },
  { command: "/skills list", description: "skills" },
  { command: "/permissions", description: "разрешения" },
  { command: "/tools", description: "tools и toolsets" },
  { command: "/files status", description: "локальные файловые операции" },
  { command: "/archive doctor", description: "архиватор" },
  { command: "/changes list", description: "подготовленные изменения" },
  { command: "/index status", description: "индекс документов" },
  { command: "/reports list", description: "пакеты отчетов" },
  { command: "/plugins list", description: "plugins" },
  { command: "/workspace status", description: "workspace" },
  { command: "/tasks list", description: "задачи" },
  { command: "/artifacts list", description: "artifacts" },
  { command: "/trace last", description: "последние tools trace" },
  { command: "/policy use safe", description: "переключить policy" },
  { command: "/cron list", description: "cron-задачи" },
  { command: "/daemon status", description: "локальный daemon" },
  { command: "/rpc call status", description: "RPC status" },
  { command: "/memory show", description: "память агента" },
  { command: "/hooks list", description: "hooks" },
  { command: "/agents list", description: "agents" },
  { command: "/mcp status", description: "MCP" },
  { command: "/cache status", description: "cache" },
  { command: "/sync", description: "обновить локальные данные" },
  { command: "/diff", description: "изменения данных" },
  { command: "/card школа 29", description: "карточка объекта" },
  { command: "/quality", description: "качество данных" },
  { command: "/views", description: "saved views" },
  { command: "/config get", description: "конфигурация" },
  { command: "/uninstall --yes", description: "удалить локальные данные iola-cli" },
  { command: "/layers", description: "слои данных" },
  { command: "/data schools --limit 10", description: "данные слоя" },
  { command: "/schools --limit 10", description: "школы" },
  { command: "/kindergartens --search 29", description: "детские сады" },
  { command: "/search лицей --limit 3", description: "поиск" },
  { command: "/mcp-info", description: "публичный MCP" },
  { command: "/profiles", description: "AI-профили" },
  { command: "/model", description: "переключить AI: local/API/Codex" },
  { command: "/model codex", description: "выбрать модель Codex" },
  { command: "/model api", description: "выбрать API-модель" },
  { command: "/models openrouter --search qwen", description: "модели" },
  { command: "/ai doctor", description: "AI diagnostics" },
  { command: "/ai setup ollama", description: "настройка Ollama" },
  { command: "/use codex", description: "выбрать Codex CLI" },
  { command: "/use local", description: "выбрать локальный профиль" },
  { command: "/use openai", description: "выбрать OpenAI" },
  { command: "/use ollama", description: "выбрать Ollama" },
  { command: "/key status", description: "API-ключи" },
  { command: "/history", description: "история текущей сессии" },
  { command: "/new", description: "новая agent-сессия" },
  { command: "/retry", description: "повторить последний вопрос" },
  { command: "/undo", description: "удалить последний обмен" },
  { command: "/compact", description: "сжать контекст" },
  { command: "/usage", description: "использование контекста" },
  { command: "/clear", description: "очистить историю agent-сессии" },
  { command: "/banner", description: "показать баннер" },
  { command: "/update", description: "проверить обновления" },
  { command: "/init", description: "проверить окружение" },
  { command: "/exit", description: "выйти" },
];
const BANNER_WIDTH = 76;

const COMMANDS = new Map([
  ["help", showHelp],
  ["commands", showCommands],
  ["version", showVersion],
  ["update", checkUpdate],
  ["doctor", doctor],
  ["db", handleDb],
  ["history", handleHistory],
  ["sessions", handleSessions],
  ["resume", resumeSession],
  ["fork", forkSession],
  ["features", handleFeatures],
  ["settings", handleSettings],
  ["wiki", handleWiki],
  ["context", handleContext],
  ["skills", handleSkills],
  ["tools", handleTools],
  ["files", handleFiles],
  ["archive", handleArchive],
  ["changes", handleChanges],
  ["import", handleImport],
  ["index", handleIndex],
  ["reports", handleReports],
  ["plugins", handlePlugins],
  ["browser", handleBrowser],
  ["workspace", handleWorkspace],
  ["tasks", handleTasks],
  ["artifacts", handleArtifacts],
  ["snapshot", handleSnapshot],
  ["sandbox", handleSandbox],
  ["trace", handleTrace],
  ["trajectory", handleTrajectory],
  ["usage", handleUsage],
  ["budget", handleBudget],
  ["policy", handlePolicy],
  ["export", handleExport],
  ["cron", handleCron],
  ["daemon", handleDaemon],
  ["rpc", handleRpc],
  ["permissions", handlePermissions],
  ["memory", handleMemory],
  ["hooks", handleHooks],
  ["agents", handleAgents],
  ["subagents", handleSubagents],
  ["review", handleReview],
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
  ["uninstall", handleUninstall],
  ["purge", handleUninstall],
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
  ["onboard", onboard],
  ["master", onboard],
  ["wizard", onboard],
]);

export async function main(argv) {
  if (argv.length === 0) {
    await runDefaultCli();
    return;
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
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

  await maybeRefreshIolaModelForCommand(command, args);

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

async function maybeRefreshIolaModelForCommand(command, args = []) {
  if (process.env.IOLA_SKIP_MODEL_CHECK === "1") return;
  const aiRuntimeCommands = new Set(["ask", "agent", "chat"]);
  const isAiCommand = command === "ai" && !["setup", "models", "key", "profile", "profiles", "doctor"].includes(args[0]);
  if (!aiRuntimeCommands.has(command) && !isAiCommand) return;
  const config = await loadConfig();
  const profile = config.ai.profiles?.[getActiveProfileName(config)];
  if (profile?.provider !== "iola" && config.ai.provider !== "iola") return;
  await ensureIolaModelFresh({
    repo: profile?.repo || IOLA_ROUTER_HF_REPO,
    modelDir: profile?.modelDir || IOLA_MODEL_DIR,
    quiet: true,
  }).catch((error) => {
    if (process.env.IOLA_DEBUG) console.error(error instanceof Error ? error.message : String(error));
  });
}

async function showHelp() {
  await showBanner();
  console.log(`iola - CLI и AI-агент городского округа "Город Йошкар-Ола"

Запуск:
  iola                         открыть интерактивный агент
  iola master                  мастер настройки
  iola ask "найди школу 29"    задать вопрос
  iola search "Петрова"        поиск по открытым данным

Основные разделы:
  iola agent                   интерактивный режим
  iola ai setup                настройка AI-профиля
  iola browser status          браузерный runtime
  iola mcp status              MCP-подключение
  iola doctor                  диагностика
  iola wiki                    документация

Справка:
  iola help                    короткая справка
  iola commands                полный список команд
  iola version                 версия

Requirements:
  Node.js >= ${MIN_NODE_VERSION}
`);
}

async function showCommands() {
  await showBanner();
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
  iola sessions replay SESSION_ID
  iola resume SESSION_ID [TEXT]
  iola fork SESSION_ID [TEXT]
  iola features list|enable|disable
  iola settings list|get|validate|doctor|init
  iola wiki [open|links]
  iola context list|show|init
  iola skills list|show|paths|enable|disable|bundles|bundle|doctor
  iola tools list|toolsets|enable|disable|profile
  iola files status|mode|approvals|tree|read|search|write|patch
  iola archive doctor|list|test|extract|create|index
  iola changes list|show|apply|discard
  iola import file|folder
  iola index folder|status|search
  iola reports list|run
  iola plugins list|install|run|remove
  iola browser status|install|open|text|html|screenshot|pdf|click|type|eval
  iola workspace init|status|use|list
  iola tasks list|add|done|run
  iola artifacts list|show|open
  iola snapshot create|list|restore
  iola sandbox fork|run|diff|apply
  iola trace last|show
  iola trajectory export|last
  iola usage summary|models|sessions
  iola budget status|set
  iola policy use safe|analyst|developer|full
  iola export REPORT --format docx|xlsx --output FILE
  iola cron list|add|delete|run|tick
  iola daemon start|status
  iola rpc call METHOD [ARGS] [--json]
  iola permissions list|allow|deny
  iola memory show|add|set|clear|export|curate|duplicates|prune
  iola hooks list|events|add|delete|run|trust|audit
  iola agents list|run
  iola subagents list|run|parallel|add
  iola review config|data|docs|report
  iola mcp list|status|install|remove|serve [--stdio]
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
  iola config validate
  iola config schema
  iola config set api.baseUrl URL
  iola config set api.mcpBaseUrl URL
  iola config reset
  iola uninstall --yes
  iola update
  iola ask TEXT [--profile NAME] [--model MODEL] [--tools] [--files] [--plan] [--trace] [--reasoning fast|verify|vote] [--output FILE] [--schema json|table] [--events] [--no-history] [--bare] [--quiet] [--no-color] [--fail-on-empty]
  iola data LAYER [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola ai ask TEXT [--provider iola|ollama|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter
  iola ai profiles
  iola ai profile add NAME --provider PROVIDER --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models iola|ollama|openai|openrouter|codex [--search TEXT]
  iola ai doctor [--json]
  iola ai setup
  iola ai setup iola [--yes]
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
  iola onboard
  iola master
  iola wizard
  iola version

Environment:
  IOLA_API_BASE_URL   default: ${API_BASE_URL}
  IOLA_MCP_BASE_URL   default: ${MCP_BASE_URL}

Requirements:
  Node.js >= ${MIN_NODE_VERSION}
`);
}

async function runDefaultCli() {
  const nodeStatus = getNodeRequirementStatus();
  if (!nodeStatus.ok) {
    throw new Error(`Нужен Node.js ${MIN_NODE_VERSION} или новее. Сейчас: ${nodeStatus.current}. Запустите: iola init --upgrade-node`);
  }

  initDatabase();
  if (!isFirstRunCompleted()) {
    await showBanner();
    console.log("Первый запуск iola-cli. Сейчас откроется мастер настройки.");
    console.log("После мастера запустится интерактивный агент.");
    console.log("");
    await onboard([]);
    markFirstRunCompleted();
    console.log("");
  }

  await startAgent([]);
}

async function startAgent() {
  setTerminalTitle(`iola - ${path.basename(process.cwd()) || process.cwd()}`);
  await showBanner();
  await ensureAgentAiReady();
  console.log("Интерактивный режим. Введите /help для списка команд, /master чтобы запустить мастер настройки, /exit для выхода.");
  await runHooks("SessionStart", { mode: "agent" });

  if (input.isTTY && output.isTTY) {
    await startAgentRawInput();
    await runHooks("SessionEnd", { mode: "agent" });
    return;
  }

  await startAgentReadline();
  await runHooks("SessionEnd", { mode: "agent" });
}

async function ensureAgentAiReady() {
  const readiness = await getAiReadiness();
  if (readiness.ready) return readiness;

  if (readiness.anyReady) {
    const fallback = getFallbackAiProfile(readiness);
    if (fallback) {
      const shouldSwitch = await confirm(`Активный AI-профиль ${readiness.activeProfile} (${readiness.activeProvider}) недоступен, найден ${fallback.name} (${fallback.provider}). Переключить активный профиль на ${fallback.name}? [Y/n] `);
      if (shouldSwitch) {
        await setActiveAiProfile(fallback.name, fallback);
        console.log(`Активный AI-профиль: ${fallback.name} (${fallback.provider}, ${fallback.model || "-"})`);
      } else {
        console.log(`Для текстовых запросов будет использован доступный профиль ${fallback.name} (${fallback.provider}).`);
      }
      return readiness;
    }
  }

  if (!input.isTTY || !output.isTTY) {
    console.log("AI-провайдер не настроен. Для настройки запустите: iola wizard");
    return readiness;
  }

  if (onboardRanThisProcess) {
    console.log("AI-провайдер пока не настроен. Агент откроется, но AI-запросы потребуют настройки.");
    console.log("Повторно открыть мастер можно командой: /master");
    return readiness;
  }

  console.log(`AI-провайдер не настроен: активный профиль ${readiness.activeProfile} (${readiness.activeProvider}) недоступен.`);
  console.log("Сейчас откроется мастер настройки. Уже существующие настройки не будут сброшены.");
  console.log("");
  await onboard([]);

  const updated = await getAiReadiness();
  if (!updated.ready) {
    console.log("");
    console.log("AI-провайдер пока не настроен. Агент откроется, но AI-запросы потребуют настройки.");
    console.log("Повторно открыть мастер можно командой: /master");
  }
  return updated;
}

async function getAiReadiness() {
  const config = await loadConfig();
  const activeProfileName = getActiveProfileName(config);
  const activeProfile = config.ai.profiles?.[activeProfileName] || {
    provider: config.ai.provider,
    model: config.ai.model,
    baseUrl: config.ai.baseUrl,
  };
  const [secrets, ollama, codex] = await Promise.all([
    loadSecrets(),
    hasUsableOllamaModel(),
    hasUsableCodexAuth(),
  ]);
  const iola = await hasUsableIolaModel();
  const openai = Boolean(process.env.OPENAI_API_KEY || secrets.openai?.apiKey);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY || secrets.openrouter?.apiKey);
  const providerReady = {
    iola,
    ollama,
    openai,
    openrouter,
    codex,
  };
  return {
    ready: Boolean(providerReady[activeProfile.provider]),
    activeProfile: activeProfileName,
    activeProvider: activeProfile.provider || "-",
    activeModel: activeProfile.model || "-",
    anyReady: Boolean(iola || ollama || openai || openrouter || codex),
    profiles: config.ai.profiles || {},
    iola,
    ollama,
    openai,
    openrouter,
    codex,
  };
}

function getFallbackAiProfile(readiness) {
  const priority = ["iola", "openai", "openrouter", "codex", "ollama"];
  for (const provider of priority) {
    if (!readiness[provider]) continue;
    const entry = Object.entries(readiness.profiles || {}).find(([, profile]) => profile.provider === provider);
    if (entry) return { name: entry[0], ...entry[1] };
  }
  return null;
}

async function hasUsableOllamaModel() {
  try {
    const config = await loadConfig();
    const baseUrl = config.ai.profiles?.local?.baseUrl || "http://127.0.0.1:11434";
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    return models.length > 0;
  } catch {
    return false;
  }
}

async function hasUsableCodexAuth() {
  const version = await getCommandVersion("codex", ["--version"]);
  if (version === "не найден") return false;
  if (process.env.OPENAI_API_KEY) return true;
  return existsSync(path.join(os.homedir(), ".codex", "auth.json"));
}

async function startAgentReadline() {
  const rl = readline.createInterface({ input, output, prompt: "> " });
  const state = {
    history: [],
  };
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  const detachSlashSuggestions = attachSlashSuggestions(rl);
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
  detachSlashSuggestions();
}

async function startAgentRawInput() {
  const state = { history: [], buffer: "", selected: 0, slashOffset: 0, slashOpen: false, running: false, renderedInputLines: 0, renderedLines: 0, rawMode: true, pendingOutput: "", aiStatus: null, statusBar: false, statusRows: 0 };
  const wasRaw = input.isRaw;
  activateRawInput(input);
  setupAgentStatusBar(state);

  await refreshAgentAiStatus(state);
  const render = () => renderAgentInput(state);
  render();

  try {
    while (true) {
      const { str, key } = await readKeypress();
      if (key?.ctrl && key.name === "c") break;
      if (key?.name === "escape") {
        state.slashOpen = false;
        render();
        continue;
      }
      if (key?.name === "backspace") {
        state.buffer = [...state.buffer].slice(0, -1).join("");
        updateSlashState(state);
        render();
        continue;
      }
      if (key?.name === "up" && state.slashOpen) {
        const matches = currentSlashMatches(state);
        const nextSelected = Math.max(0, state.selected - 1);
        state.selected = nextSelected;
        if (state.selected < state.slashOffset) state.slashOffset = state.selected;
        render();
        continue;
      }
      if (key?.name === "down" && state.slashOpen) {
        const matches = currentSlashMatches(state);
        const visibleLimit = getSlashVisibleLimit();
        const nextSelected = Math.min(matches.length - 1, state.selected + 1);
        state.selected = Math.max(0, nextSelected);
        if (state.selected >= state.slashOffset + visibleLimit) state.slashOffset = state.selected - visibleLimit + 1;
        state.slashOffset = Math.max(0, Math.min(state.slashOffset, Math.max(0, matches.length - visibleLimit)));
        render();
        continue;
      }
      if (isShiftEnter(str, key)) {
        state.buffer += "\n";
        state.slashOpen = false;
        render();
        continue;
      }
      if (key?.name === "return" || key?.name === "enter") {
        const matches = currentSlashMatches(state);
        const selected = matches[state.selected];
        const line = state.slashOpen && selected ? selected.command : state.buffer.trim();
        state.buffer = "";
        state.slashOpen = false;
        clearAgentInputArea(state);
        if (!line) {
          render();
          continue;
        }
        output.write(`> ${line}\n`);
        const stopActivity = line.startsWith("/") ? () => {} : startActivityIndicator("работаю");
        const restoreRawInput = line.startsWith("/") ? suspendRawInputForCommand(input) : () => {};
        try {
          const shouldExit = await handleAgentLine(line, state);
          stopActivity();
          flushPendingAgentOutput(state);
          await refreshAgentAiStatus(state);
          if (!shouldExit) restoreRawInput();
          if (shouldExit) break;
        } catch (error) {
          stopActivity();
          restoreRawInput();
          console.error(error instanceof Error ? error.message : String(error));
        }
        render();
        continue;
      }
      if (str && !key?.ctrl && !key?.meta) {
        state.buffer += str;
        updateSlashState(state);
        render();
      }
    }
  } finally {
    clearAgentInputArea(state);
    clearAgentStatusBar(state);
    if (!wasRaw) input.setRawMode(false);
    input.pause();
  }
}

async function handleAgentLine(line, state) {
  if (!line.startsWith("/")) {
    const answer = await aiAsk(state.rawMode ? [line, "--quiet"] : [line], { history: state.history });
    state.history.push({ role: "user", content: line });
    state.history.push({ role: "assistant", content: answer });
    if (state.rawMode) state.pendingOutput = answer;
    return false;
  }

  if (line === "/") {
    printSlashMenu("");
    return false;
  }

  const [command, ...args] = splitCommandLine(line.slice(1));
  state.lastCommand = { command, args };

  if (!command) {
    printSlashMenu("");
    return false;
  }

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

  if (command === "new" || command === "reset") {
    state.history = [];
    console.log("Начата новая agent-сессия.");
    return false;
  }

  if (command === "undo") {
    state.history.splice(Math.max(0, state.history.length - 2), 2);
    console.log("Последний обмен удален из agent-истории.");
    return false;
  }

  if (command === "retry") {
    const lastUser = [...state.history].reverse().find((item) => item.role === "user");
    if (!lastUser) {
      console.log("Нет предыдущего вопроса для повтора.");
      return false;
    }
    const answer = await aiAsk(state.rawMode ? [lastUser.content, "--quiet"] : [lastUser.content], { history: state.history.slice(0, -2) });
    state.history.push({ role: "assistant", content: answer });
    if (state.rawMode) state.pendingOutput = answer;
    return false;
  }

  if (command === "compact") {
    state.history = compactAgentHistory(state.history);
    console.log(`Контекст сжат. Сообщений в agent-истории: ${state.history.length}`);
    return false;
  }

  if (command === "usage") {
    printAgentUsage(state.history);
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

  if (command === "wiki") {
    await handleWiki(args);
    return false;
  }

  if (command === "context") {
    await handleContext(args.length > 0 ? args : ["list"]);
    return false;
  }

  if (command === "skills") {
    await handleSkills(args);
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
    await handleTools(args.length > 0 ? args : ["list"]);
    return false;
  }

  if (command === "files") {
    await handleFiles(args);
    return false;
  }

  if (command === "archive") {
    await handleArchive(args);
    return false;
  }

  if (command === "changes") {
    await handleChanges(args);
    return false;
  }

  if (command === "index") {
    await handleIndex(args);
    return false;
  }

  if (command === "reports") {
    await handleReports(args);
    return false;
  }

  if (command === "plugins") {
    await handlePlugins(args);
    return false;
  }


  if (command === "workspace") {
    await handleWorkspace(args);
    return false;
  }

  if (command === "tasks" || command === "todos") {
    await handleTasks(args);
    return false;
  }

  if (command === "artifacts") {
    await handleArtifacts(args);
    return false;
  }

  if (command === "snapshot") {
    await handleSnapshot(args);
    return false;
  }

  if (command === "trace") {
    await handleTrace(args);
    return false;
  }

  if (command === "policy") {
    await handlePolicy(args);
    return false;
  }

  if (command === "cron") {
    await handleCron(args);
    return false;
  }

  if (command === "daemon") {
    await handleDaemon(args);
    return false;
  }

  if (command === "rpc") {
    await handleRpc(args);
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

  if (command === "model") {
    await slashModelMenu(args);
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
    await showBanner();
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
    wiki: ["wiki", args],
    context: ["context", args],
    skills: ["skills", args],
    files: ["files", args],
    archive: ["archive", args],
    changes: ["changes", args],
    index: ["index", args],
    reports: ["reports", args],
    plugins: ["plugins", args],
    workspace: ["workspace", args],
    tasks: ["tasks", args],
    todos: ["tasks", args],
    artifacts: ["artifacts", args],
    snapshot: ["snapshot", args],
    trace: ["trace", args],
    policy: ["policy", args],
    cron: ["cron", args],
    daemon: ["daemon", args],
    rpc: ["rpc", args],
    permissions: ["permissions", args],
    memory: ["memory", args],
    hooks: ["hooks", args],
    agents: ["agents", args],
    tools: ["tools", args],
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
    master: ["wizard", args],
    wizard: ["wizard", args],
    onboard: ["onboard", args],
  }[command];

  if (!mapped) {
    const matches = getSlashCommandMatches(command);
    if (matches.length > 0) {
      printSlashMenu(command);
    } else {
      console.log(`Неизвестная slash-команда: /${command}`);
      printSlashMenu(command);
    }
    return false;
  }

  const [cliCommand, cliArgs] = mapped;
  await COMMANDS.get(cliCommand)(cliArgs);
  return false;
}

function printAgentHelp() {
  printSlashMenu("");
  console.log("");
  console.log("Обычный текст без slash-команды отправляется в настроенный AI-провайдер.");
}

function printSlashMenu(filter = "", options = {}) {
  const normalized = String(filter || "").replace(/^\//, "");
  const limit = options.limit === undefined ? Infinity : Number(options.limit);
  const rows = getSlashCommandMatches(normalized)
    .slice(0, limit)
    .map((item) => ({ command: item.command, description: item.description }));
  if (rows.length === 0) {
    console.log(`Нет slash-команд по фильтру: ${filter}`);
    console.log("Введите / для списка команд.");
    return;
  }
  console.log(normalized ? `Slash-команды по фильтру "${filter}":` : "Slash-команды:");
  printTable(rows, [["command", "Команда"], ["description", "Описание"]]);
  if (!options.compact && SLASH_COMMANDS.length > rows.length && !normalized) {
    console.log(`Показано ${rows.length} из ${SLASH_COMMANDS.length}. Введите /текст для фильтра.`);
  }
}

function getSlashCommandMatches(filter = "") {
  const normalized = String(filter || "").replace(/^\//, "").toLocaleLowerCase("ru-RU");
  if (!normalized) return SLASH_COMMANDS;
  const commandPrefix = SLASH_COMMANDS.filter((item) => item.command.toLocaleLowerCase("ru-RU").startsWith(`/${normalized}`));
  if (commandPrefix.length > 0) return commandPrefix;
  const commandWordPrefix = SLASH_COMMANDS.filter((item) =>
    item.command.toLocaleLowerCase("ru-RU").split(/\s+/).some((part) => part.replace(/^\//, "").startsWith(normalized)));
  if (commandWordPrefix.length > 0) return commandWordPrefix;
  return SLASH_COMMANDS.filter((item) => item.description.toLocaleLowerCase("ru-RU").startsWith(normalized));
}

function updateSlashState(state) {
  state.slashOpen = state.buffer.startsWith("/");
  state.selected = 0;
  state.slashOffset = 0;
}

function currentSlashMatches(state) {
  if (!state.buffer.startsWith("/")) return [];
  return getSlashCommandMatches(state.buffer.slice(1));
}

function getSlashVisibleLimit() {
  return 10;
}

function renderAgentInput(state) {
  clearAgentInputArea(state);
  const prompt = "> ";
  const lines = state.buffer.split("\n");
  const inputLines = [`${prompt}${lines[0] || ""}`, ...lines.slice(1)];
  const menuLines = [];
  if (state.slashOpen) {
    const matches = currentSlashMatches(state);
    if (matches.length === 0) {
      menuLines.push("  нет команд");
    } else {
      const visibleLimit = getSlashVisibleLimit();
      const offset = Math.max(0, Math.min(state.slashOffset || 0, Math.max(0, matches.length - visibleLimit)));
      const visibleMatches = matches.slice(offset, offset + visibleLimit);
      for (let index = 0; index < visibleMatches.length; index += 1) {
        const absoluteIndex = offset + index;
        const selected = absoluteIndex === state.selected;
        const marker = selected ? ">" : " ";
        const row = truncateTerminalLine(`${marker} ${visibleMatches[index].command.padEnd(24)} ${visibleMatches[index].description}`);
        menuLines.push(selected ? colorSlashSelection(row) : `  ${row.slice(2)}`);
      }
      const shownTo = Math.min(offset + visibleLimit, matches.length);
      menuLines.push(truncateTerminalLine(`  ↑/↓ выбрать • Enter выполнить • Esc закрыть • ${offset + 1}-${shownTo} из ${matches.length}`));
    }
  }

  renderAgentStatusBar(state);
  const renderedLines = [...menuLines, ...inputLines];
  output.write(renderedLines.join("\n"));
  if (output.isTTY) {
    const cursorColumn = visibleLength(inputLines[inputLines.length - 1]);
    output.write(`\x1b[${cursorColumn + 1}G`);
  }
  state.renderedInputLines = inputLines.length;
  state.renderedLines = renderedLines.length;
}

function clearAgentInputArea(state = null) {
  if (!output.isTTY) return;
  const renderedLines = Math.max(1, Number(state?.renderedLines || state?.renderedInputLines || 1));
  if (renderedLines > 1) output.write(`\x1b[${renderedLines - 1}A`);
  output.write("\r\x1b[0J");
  if (state) {
    state.renderedInputLines = 0;
    state.renderedLines = 0;
  }
}

function setupAgentStatusBar(state) {
  if (!output.isTTY) return;
  const rows = Number(output.rows || 0);
  if (rows < 4) return;
  state.statusBar = true;
  state.statusRows = rows;
  output.write(`\x1b[1;${rows - 1}r`);
  output.write(`\x1b[${rows - 1};1H`);
}

function renderAgentStatusBar(state) {
  if (!output.isTTY || !state.statusBar) return;
  const rows = Number(output.rows || state.statusRows || 0);
  if (rows < 4) return;
  if (rows !== state.statusRows) {
    state.statusRows = rows;
    output.write(`\x1b[1;${rows - 1}r`);
  }
  const statusLine = colorMuted(truncateTerminalLine(` ${buildAgentStatusLine(state)} `));
  output.write(`\x1b7\x1b[${rows};1H\x1b[2K${statusLine}\x1b8`);
}

function clearAgentStatusBar(state) {
  if (!output.isTTY || !state?.statusBar) return;
  const rows = Number(output.rows || state.statusRows || 0);
  output.write("\x1b[r");
  if (rows >= 1) output.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b8`);
  state.statusBar = false;
  state.statusRows = 0;
}

function startActivityIndicator(label = "работаю") {
  const doneLabel = "готово";
  if (!output.isTTY || process.env.NO_COLOR === "1") {
    output.write(`${formatActivityLine(label)}\n`);
    const started = Date.now();
    return () => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      output.write(`${formatActivityLine(doneLabel, seconds)}\n`);
    };
  }
  const started = Date.now();
  const render = () => {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    output.write(`\r\x1b[2K${colorMuted(formatActivityLine(label, seconds))}`);
  };
  render();
  const timer = setInterval(render, 120);
  return () => {
    clearInterval(timer);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    output.write(`\r\x1b[2K${colorMuted(formatActivityLine(doneLabel, seconds))}\n`);
  };
}

function formatActivityLine(label, seconds = null) {
  const columns = Math.max(60, Number(output.columns || 100));
  const middle = ` ${label}${seconds == null ? "" : ` ${seconds}s`} `;
  const leftWidth = Math.max(1, Math.floor((columns - visibleLength(middle)) / 3));
  const rightWidth = Math.max(1, columns - leftWidth - visibleLength(middle));
  return `${"─".repeat(leftWidth)}${middle}${"─".repeat(rightWidth)}`;
}

function suspendRawInputForCommand(stream) {
  if (!stream.isTTY || !stream.isRaw) return () => {};
  stream.setRawMode(false);
  stream.pause();
  return () => {
    activateRawInput(stream);
  };
}

function activateRawInput(stream) {
  if (!stream.isTTY) return;
  emitKeypressEvents(stream);
  stream.setRawMode(true);
  stream.resume();
}

function flushPendingAgentOutput(state) {
  const text = state.pendingOutput;
  state.pendingOutput = "";
  if (!text) return;
  console.log(text);
}

function colorSlashSelection(row) {
  if (!output.isTTY || process.env.NO_COLOR === "1") return row;
  return `\x1b[38;5;213m${row}\x1b[0m`;
}

function colorMuted(row) {
  if (!output.isTTY || process.env.NO_COLOR === "1") return row;
  return `\x1b[38;5;245m${row}\x1b[0m`;
}

function setTerminalTitle(title) {
  if (!output.isTTY) return;
  output.write(`\x1b]0;${String(title).replace(/[\x00-\x1f\x7f]/g, "")}\x07`);
}

function readKeypress() {
  return new Promise((resolve) => {
    const handler = (str, key) => {
      input.off("keypress", handler);
      resolve({ str, key });
    };
    input.on("keypress", handler);
  });
}

function isShiftEnter(str, key) {
  return (key?.name === "return" && key.shift)
    || (key?.name === "enter" && key.shift)
    || String(str || "").includes("[13;2")
    || String(str || "").includes("[27;2;13");
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

async function refreshAgentAiStatus(state) {
  try {
    const config = await loadConfig();
    const name = getActiveProfileName(config);
    const profile = config.ai.profiles?.[name] || {
      provider: config.ai.provider,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
    };
    state.aiStatus = { name, provider: profile.provider || "-", model: profile.model || "-" };
  } catch {
    state.aiStatus = null;
  }
}

function buildAgentStatusLine(state) {
  const cwd = process.cwd();
  const ai = state.aiStatus;
  if (!ai) return cwd;
  const kind = {
    iola: "IOLA local",
    ollama: "локальная",
    openai: "API",
    openrouter: "API",
    codex: "Codex",
  }[ai.provider] || ai.provider;
  const model = ai.model && ai.model !== "-" ? ` • ${ai.model}` : "";
  return `${cwd}  |  AI: ${kind}${model} (${ai.name})`;
}

function truncateTerminalLine(value) {
  const columns = Math.max(20, Number(output.columns || 100));
  const text = String(value).replace(/\r?\n/g, " ");
  if (visibleLength(text) <= columns) return text;
  return `${text.slice(0, Math.max(0, columns - 1))}…`;
}

function compactAgentHistory(history) {
  if (history.length <= 8) return history;
  const summary = history.slice(0, -6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n")
    .slice(0, 3000);
  return [
    { role: "system", content: `Сжатая история предыдущего диалога:\n${summary}` },
    ...history.slice(-6),
  ];
}

function printAgentUsage(history) {
  const chars = history.reduce((sum, item) => sum + String(item.content || "").length, 0);
  printKeyValue({
    messages: history.length,
    characters: chars,
    approximate_tokens: Math.ceil(chars / 4),
  });
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

function attachSlashSuggestions(rl) {
  if (!input.isTTY) return () => {};
  emitKeypressEvents(input, rl);
  let lastFilter = null;
  const onKeypress = () => {
    setTimeout(() => {
      const line = rl.line || "";
      if (!line.startsWith("/")) {
        lastFilter = null;
        return;
      }
      const filter = line.slice(1);
      if (filter === lastFilter) return;
      lastFilter = filter;
      output.write("\n");
      printSlashMenu(filter, { compact: true, limit: 10 });
      rl.prompt(true);
    }, 0);
  };
  input.on("keypress", onKeypress);
  return () => input.off("keypress", onKeypress);
}

async function showBanner(options = {}) {
  const version = getPackageVersion();
  const latest = options.skipUpdate ? null : await getLatestNpmVersion("@iola_adm/iola-cli");
  const updateAvailable = latest && compareVersions(latest, version) > 0;
  const versionLine = updateAvailable ? `v${version} -> v${latest} • npm install -g @iola_adm/iola-cli@latest` : `v${version} • iola help`;
  if (process.stdout.isTTY && process.env.NO_COLOR !== "1") {
    console.log(renderBanner(versionLine, true));
    if (updateAvailable) {
      console.log(`Доступно обновление: v${version} -> v${latest}`);
      console.log("Обновить: npm install -g @iola_adm/iola-cli@latest");
    }
    return;
  }

  console.log(`CLI-Йошкар-Ола ${updateAvailable ? `v${version} -> v${latest}` : `v${version}`}`);
  console.log("Йошкар-Ола • MCP • локальный AI");
  if (updateAvailable) console.log("Обновить: npm install -g @iola_adm/iola-cli@latest");
}

function renderBanner(versionLine, color = false) {
  const c = color ? {
    border: "\x1b[38;5;45m",
    title: "\x1b[38;5;213m",
    muted: "\x1b[38;5;250m",
    version: "\x1b[38;5;82m",
    reset: "\x1b[0m",
  } : { border: "", title: "", muted: "", version: "", reset: "" };
  const line = (text = "", style = "") => {
    const value = centerBannerText(text);
    return `${c.border}│${style}${value}${c.border}│`;
  };
  return [
    `${c.border}┌${"─".repeat(BANNER_WIDTH)}┐`,
    line(),
    line("CLI-Йошкар-Ола", c.title),
    line(),
    line("Йошкар-Ола • MCP • локальный AI", c.muted),
    line(),
    line(versionLine, c.version),
    `${c.border}└${"─".repeat(BANNER_WIDTH)}┘${c.reset}`,
  ].join("\n");
}

function centerBannerText(value) {
  const text = String(value || "");
  const length = bannerVisibleLength(text);
  if (length >= BANNER_WIDTH) return [...text].slice(0, BANNER_WIDTH).join("");
  const left = Math.floor((BANNER_WIDTH - length) / 2);
  const right = BANNER_WIDTH - length - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function bannerVisibleLength(value) {
  return [...String(value)].length;
}

function getPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
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
    config: {
      file: CONFIG_FILE,
      valid: validateConfig(config).length === 0 ? "yes" : "no",
      errors: validateConfig(config),
      lastGood: existsSync(LAST_GOOD_CONFIG_FILE) ? LAST_GOOD_CONFIG_FILE : "-",
    },
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
    skills: {
      enabled: config.skills?.enabled?.join(", ") || "-",
      found: listSkills(config).length,
    },
    toolsets: {
      enabled: config.toolsets?.enabled?.join(", ") || "-",
    },
    daemon: {
      endpoint: `http://${config.daemon?.host || "127.0.0.1"}:${config.daemon?.port || DAEMON_PORT}`,
      status: await probeEndpoint(`http://${config.daemon?.host || "127.0.0.1"}:${config.daemon?.port || DAEMON_PORT}/health`),
    },
    system: diagnostics,
  };

  if (options.fix) {
    initDatabase();
    const errors = validateConfig(config);
    if (errors.length > 0) {
      await writeConfig(mergeConfig(DEFAULT_AI_CONFIG, config));
    }
    await mkdir(USER_SKILLS_DIR, { recursive: true });
    console.log("Автоисправление выполнено: БД и пользовательская папка skills проверены.");
    return;
  }

  if (options.json) {
    printJson(report);
    return;
  }

  if (options.summary) {
    printTable([
      { group: "cli", status: report.cli.nodeStatus === "ok" && report.cli.update !== "available" ? "ok" : "check" },
      { group: "sqlite", status: report.db.status },
      { group: "config", status: report.config.valid === "yes" ? "ok" : "error" },
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
  console.log("Config");
  printKeyValue(report.config);
  console.log("");
  console.log("API/MCP");
  printKeyValue(report.api);
  console.log("");
  console.log("AI");
  printKeyValue(report.ai);
  console.log("");
  console.log("Skills/Toolsets/Daemon");
  printKeyValue({ ...report.skills, toolsets: report.toolsets.enabled, daemon: report.daemon.status });
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
  if (config.ai.provider === "iola") {
    return await hasUsableIolaModel() ? "installed" : "missing";
  }

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

  await showBanner();
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
    console.log("  iola ai setup iola --yes");
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
    await showBanner();
    console.log(`AI-команды:
  iola ai ask TEXT [--provider iola|ollama|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete openai|openrouter
  iola ai profiles
  iola ai profile add NAME --provider iola|ollama|openai|openrouter|codex --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models iola|ollama|openai|openrouter|codex [--search TEXT]
  iola ai doctor [--json]
  iola ai setup
  iola ai setup iola [--yes]
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

  if (action === "validate") {
    const config = await loadConfig();
    const errors = validateConfig(config);
    if (errors.length > 0) {
      printTable(errors.map((error) => ({ error })), [["error", "Ошибка"]]);
      throw new Error("Конфигурация содержит ошибки.");
    }
    console.log("Конфигурация корректна.");
    return;
  }

  if (action === "schema") {
    printJson(configSchema());
    return;
  }

  if (action === "reset") {
    await writeConfig(DEFAULT_AI_CONFIG);
    console.log(`Конфигурация сброшена: ${CONFIG_FILE}`);
    return;
  }

  throw new Error("Команды config: get, set, validate, schema, reset.");
}

async function handleUninstall(args = []) {
  const options = parseOptions(args);
  const targets = [
    {
      label: "user data",
      path: CONFIG_DIR,
      description: "config, secrets, SQLite-БД, модель IOLA, Python/browser runtime, cache, history",
    },
  ];

  if (options.project) {
    targets.push({
      label: "project data",
      path: PROJECT_IOLA_DIR,
      description: "локальная папка .iola текущего проекта",
    });
  }

  const safeTargets = targets.map((target) => ({
    ...target,
    path: path.resolve(target.path),
  }));
  const home = path.resolve(os.homedir());
  for (const target of safeTargets) {
    const isUserConfig = target.path === path.resolve(CONFIG_DIR) && target.path.startsWith(home);
    const isProjectConfig = target.path === path.resolve(PROJECT_IOLA_DIR) && target.path.startsWith(path.resolve(process.cwd()));
    if (!isUserConfig && !isProjectConfig) {
      throw new Error(`Небезопасный путь удаления: ${target.path}`);
    }
  }

  if (options["dry-run"] || options.json) {
    const payload = {
      willDelete: safeTargets.map((target) => ({
        label: target.label,
        path: target.path,
        exists: existsSync(target.path),
        description: target.description,
      })),
      willKeep: ["Codex CLI", "Codex auth/config", "npm package files"],
      reinstall: "npm install -g @iola_adm/iola-cli@latest",
    };
    if (options.json) printJson(payload);
    else printKeyValue(Object.fromEntries(payload.willDelete.map((item) => [item.label, `${item.path} (${item.exists ? "exists" : "missing"})`])));
    return;
  }

  if (!options.yes) {
    console.log("Будет удалено:");
    for (const target of safeTargets) {
      console.log(`- ${target.path}`);
      console.log(`  ${target.description}`);
    }
    console.log("");
    console.log("Codex CLI и его настройки не удаляются.");
    const confirmed = await confirm("Удалить локальные данные iola-cli? [y/N] ");
    if (!confirmed) {
      console.log("Удаление отменено.");
      return;
    }
  }

  for (const target of safeTargets) {
    await rm(target.path, { recursive: true, force: true });
  }

  console.log("Локальные данные iola-cli удалены.");
  console.log("Codex CLI не тронут.");
  console.log("Для полной переустановки npm-пакета:");
  console.log("  npm uninstall -g @iola_adm/iola-cli");
  console.log("  npm install -g @iola_adm/iola-cli@latest");
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

  if (action === "search") {
    const query = options._.slice(1).join(" ").trim() || options.query || options.search;
    if (!query) throw new Error('Пример: iola history search "Петрова"');
    const rows = searchHistory(query, Number(options.limit || 20));
    if (options.json) printJson(rows);
    else printTable(rows, [["id", "ID"], ["created_at", "Дата"], ["profile", "Профиль"], ["question", "Вопрос"], ["answer", "Ответ"]]);
    return;
  }

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

  if (action === "search") {
    const query = options._.slice(1).join(" ").trim() || options.query || options.search;
    if (!query) throw new Error('Пример: iola sessions search "Петрова"');
    const rows = searchSessions(query, Number(options.limit || 20));
    if (options.json) printJson(rows);
    else printTable(rows, [["session_id", "Сессия"], ["message_id", "Сообщ."], ["role", "Роль"], ["content", "Текст"]]);
    return;
  }

  if (action === "compact") {
    const sessionId = Number(args[1]);
    if (!sessionId) throw new Error("Пример: iola sessions compact 1");
    const result = compactSessionInDb(sessionId);
    printKeyValue(result);
    return;
  }

  if (action === "replay") {
    const sessionId = Number(args[1]);
    if (!sessionId) throw new Error("Пример: iola sessions replay 1");
    const rows = getSessionMessages(sessionId);
    for (const row of rows) {
      console.log(`\n[${row.role}] ${row.created_at}`);
      console.log(row.content);
    }
    return;
  }

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

async function handleSettings(args) {
  const [action = "list", key] = args;
  const layers = await loadConfigLayers();
  const effective = await loadConfig();

  if (action === "list" || action === "ls" || action === "doctor") {
    const rows = layers.map((layer) => ({
      scope: layer.scope,
      file: layer.file,
      exists: layer.exists ? "yes" : "no",
      valid: layer.errors.length ? "no" : "yes",
      errors: layer.errors.join("; ") || "-",
    }));
    printTable(rows, [["scope", "Слой"], ["exists", "Есть"], ["valid", "Валиден"], ["file", "Файл"], ["errors", "Ошибки"]]);
    return;
  }

  if (action === "get") {
    if (!key) {
      printJson(effective);
      return;
    }
    const value = getConfigValue(effective, key);
    if (typeof value === "object") printJson(value);
    else console.log(value ?? "-");
    return;
  }

  if (action === "validate") {
    const errors = validateConfig(effective);
    if (errors.length) {
      printTable(errors.map((error) => ({ error })), [["error", "Ошибка"]]);
      process.exitCode = 1;
      return;
    }
    console.log("Конфигурация валидна.");
    return;
  }

  if (action === "init") {
    await mkdir(PROJECT_IOLA_DIR, { recursive: true });
    if (!existsSync(PROJECT_CONFIG_FILE)) {
      await writeFile(PROJECT_CONFIG_FILE, `${JSON.stringify({ files: { workspaceRoot: "." } }, null, 2)}\n`, "utf8");
    }
    if (!existsSync(LOCAL_CONFIG_FILE)) {
      await writeFile(LOCAL_CONFIG_FILE, `${JSON.stringify({ local: true }, null, 2)}\n`, "utf8");
    }
    console.log(`Создан project config: ${PROJECT_CONFIG_FILE}`);
    console.log(`Создан local config: ${LOCAL_CONFIG_FILE}`);
    return;
  }

  throw new Error("Команды settings: list, get [KEY], validate, doctor, init.");
}

async function handleWiki(args) {
  const [action = "links"] = args;
  const base = "https://github.com/adm-iola/iola-cli/wiki";
  const links = [
    ["Главная", base],
    ["Установка", `${base}/Установка`],
    ["Первый запуск", `${base}/Первый-запуск`],
    ["Мастер настройки", `${base}/Мастер-настройки`],
    ["AI-профили", `${base}/AI-профили`],
    ["Локальный инструментальный агент", `${base}/Локальный-инструментальный-агент`],
    ["Skills и toolsets", `${base}/Skills-и-toolsets`],
    ["Локальные файлы", `${base}/Локальные-файлы`],
    ["Рабочая среда агента", `${base}/Рабочая-среда-агента`],
    ["Платформа агента", `${base}/Платформа-агента`],
    ["Браузерный агент", `${base}/Браузерный-агент`],
    ["Расширения и локальные данные", `${base}/Расширения-и-локальные-данные`],
    ["Архивы и мастер настройки", `${base}/Архивы-и-мастер-настройки`],
    ["Daemon, RPC и cron", `${base}/Daemon-RPC-и-cron`],
    ["Контекст и память", `${base}/Контекст-и-память`],
    ["Команды", `${base}/Команды`],
    ["Решение проблем", `${base}/Решение-проблем`],
  ].map(([title, url]) => ({ title, url }));

  if (action === "open") {
    await openUrl(base);
    return;
  }

  if (action === "links" || action === "list" || action === "ls") {
    printWikiLinks(links);
    return;
  }

  throw new Error("Команды wiki: links, open.");
}

function printWikiLinks(links) {
  if (links.length === 0) {
    console.log("Нет данных.");
    return;
  }
  const titleWidth = Math.max("Раздел".length, ...links.map((link) => visibleLength(link.title)));
  console.log(`${padCell("Раздел", titleWidth)}  Ссылка`);
  console.log(`${"-".repeat(titleWidth)}  ${"-".repeat(6)}`);
  for (const link of links) {
    console.log(`${padCell(link.title, titleWidth)}  ${link.url}`);
  }
}

async function handleContext(args) {
  const [action = "list"] = args;
  const files = await listContextFiles();

  if (action === "list" || action === "ls") {
    printTable(files, [
      ["scope", "Область"],
      ["file", "Файл"],
      ["exists", "Есть"],
      ["size", "Размер"],
    ]);
    return;
  }

  if (action === "show") {
    const text = await buildProjectContextText();
    console.log(text || "Контекстные файлы не найдены.");
    return;
  }

  if (action === "init") {
    await mkdir(path.dirname(PROJECT_CONTEXT_DIR_FILE), { recursive: true });
    if (!existsSync(PROJECT_CONTEXT_FILE)) {
      await writeFile(PROJECT_CONTEXT_FILE, [
        "# Контекст iola",
        "",
        "Проект работает с открытыми данными городского округа \"Город Йошкар-Ола\".",
        "Ответы должны опираться на публичный API, локальную SQLite-БД и подключенные skills.",
        "",
      ].join("\n"), "utf8");
    }
    if (!existsSync(PROJECT_CONTEXT_DIR_FILE)) {
      await writeFile(PROJECT_CONTEXT_DIR_FILE, [
        "# Рабочий контекст",
        "",
        "- Основные слои первого релиза: школы и детские сады.",
        "- Не выдумывать сведения, которых нет в источниках данных.",
        "",
      ].join("\n"), "utf8");
    }
    console.log(`Контекст создан: ${PROJECT_CONTEXT_FILE}`);
    console.log(`Контекст создан: ${PROJECT_CONTEXT_DIR_FILE}`);
    return;
  }

  throw new Error("Команды context: list, show, init.");
}

async function handleSkills(args) {
  const [action = "list", name] = args;
  const config = await loadConfig();

  if (action === "list" || action === "ls") {
    const rows = listSkills(config).map((skill) => ({
      enabled: isSkillEnabled(config, skill.name) ? "yes" : "no",
      name: skill.name,
      source: skill.source,
      description: skill.description,
      file: skill.file,
    }));
    printTable(rows, [
      ["enabled", "Вкл"],
      ["name", "Skill"],
      ["source", "Источник"],
      ["description", "Описание"],
      ["file", "Файл"],
    ]);
    return;
  }

  if (action === "paths") {
    printTable(skillRoots().map((root) => ({ root, exists: existsSync(root) ? "yes" : "no" })), [
      ["root", "Папка"],
      ["exists", "Есть"],
    ]);
    return;
  }

  if (action === "bundles") {
    const enabled = new Set(config.skills?.enabled || []);
    const rows = Object.entries(SKILL_BUNDLES).map(([bundle, meta]) => ({
      bundle,
      enabled: meta.skills.every((skill) => enabled.has(skill)) ? "yes" : "partial/no",
      skills: meta.skills.join(", "),
      description: meta.description,
    }));
    printTable(rows, [["bundle", "Bundle"], ["enabled", "Вкл"], ["skills", "Skills"], ["description", "Описание"]]);
    return;
  }

  if (action === "bundle") {
    const [operation, bundleName] = args.slice(1);
    if (operation !== "enable" || !SKILL_BUNDLES[bundleName]) {
      throw new Error(`Пример: iola skills bundle enable analyst. Доступно: ${Object.keys(SKILL_BUNDLES).join(", ")}`);
    }
    const enabled = new Set(config.skills?.enabled || []);
    for (const skill of SKILL_BUNDLES[bundleName].skills) enabled.add(skill);
    await saveConfig({ skills: { ...(config.skills || {}), enabled: [...enabled] } });
    console.log(`Skill bundle включен: ${bundleName}`);
    return;
  }

  if (action === "doctor") {
    const skills = listSkills(config);
    const enabled = new Set(config.skills?.enabled || []);
    const rows = [
      ...skills.map((skill) => ({ item: skill.name, type: "skill", status: enabled.has(skill.name) ? "enabled" : "available", detail: skill.file })),
      ...Object.entries(SKILL_BUNDLES).map(([bundle, meta]) => ({ item: bundle, type: "bundle", status: meta.skills.every((skill) => enabled.has(skill)) ? "enabled" : "not-complete", detail: meta.requirements.join(", ") })),
    ];
    printTable(rows, [["type", "Тип"], ["item", "Имя"], ["status", "Статус"], ["detail", "Детали"]]);
    return;
  }

  if (action === "show") {
    const skill = findSkill(name, config);
    if (!skill) throw new Error(`Skill не найден: ${name}`);
    console.log(await readFile(skill.file, "utf8"));
    return;
  }

  if (action === "enable" || action === "disable") {
    if (!name) throw new Error("Имя skill обязательно.");
    const enabled = new Set(config.skills?.enabled || []);
    if (action === "enable") enabled.add(name);
    else enabled.delete(name);
    await saveConfig({ skills: { ...(config.skills || {}), enabled: [...enabled] } });
    console.log(`${name}: ${action === "enable" ? "enabled" : "disabled"}`);
    return;
  }

  throw new Error("Команды skills: list, paths, show NAME, enable NAME, disable NAME, bundles, bundle enable NAME, doctor.");
}

async function handleTools(args) {
  const [action = "list", name] = args;
  const config = await loadConfig();

  if (action === "list" || action === "ls") {
    await handlePermissions(["tools"]);
    return;
  }

  if (action === "toolsets") {
    const enabled = new Set(config.toolsets?.enabled || []);
    printTable(Object.entries(TOOLSETS).map(([toolset, meta]) => ({
      enabled: enabled.has(toolset) ? "yes" : "no",
      toolset,
      description: meta.description,
    })), [
      ["enabled", "Вкл"],
      ["toolset", "Toolset"],
      ["description", "Описание"],
    ]);
    return;
  }

  if (action === "enable" || action === "disable") {
    if (!TOOLSETS[name]) throw new Error(`Toolset неизвестен. Доступно: ${Object.keys(TOOLSETS).join(", ")}`);
    const enabled = new Set(config.toolsets?.enabled || []);
    if (action === "enable") enabled.add(name);
    else enabled.delete(name);
    await saveConfig({ toolsets: { ...(config.toolsets || {}), enabled: [...enabled] } });
    console.log(`${name}: ${action === "enable" ? "enabled" : "disabled"}`);
    return;
  }

  if (action === "profile") {
    if (!TOOLSETS[name]) throw new Error(`Профиль неизвестен. Доступно: ${Object.keys(TOOLSETS).join(", ")}`);
    const permissions = applyToolsetPermissions(DEFAULT_AI_CONFIG.permissions, [name]);
    await saveConfig({ toolsets: { enabled: [name] }, permissions });
    console.log(`Toolset-профиль применен: ${name}`);
    return;
  }

  throw new Error("Команды tools: list, toolsets, enable NAME, disable NAME, profile NAME.");
}

async function handleFiles(args) {
  const [action = "status", target, ...rest] = args;
  const options = parseOptions(rest);
  const config = await loadConfig();

  if (action === "status") {
    printKeyValue({
      mode: config.files?.mode || "locked",
      approvals: config.files?.approvals || "on-write",
      workspaceRoot: resolveWorkspaceRoot(config),
      maxReadBytes: config.files?.maxReadBytes || 200000,
      readFiles: config.permissions?.readFiles ? "allow" : "deny",
      writeFiles: config.permissions?.writeFiles ? "allow" : "deny",
      editFiles: config.permissions?.editFiles ? "allow" : "deny",
    });
    return;
  }

  if (action === "mode") {
    if (!["locked", "read-only", "workspace-write", "full-access"].includes(target)) {
      throw new Error("Режимы файлов: locked, read-only, workspace-write, full-access.");
    }
    await setFilesMode(target, config);
    console.log(`Файловый режим: ${target}`);
    return;
  }

  if (action === "approvals") {
    if (!["never", "on-write", "on-danger", "always"].includes(target)) {
      throw new Error("Политики approvals: never, on-write, on-danger, always.");
    }
    await saveConfig({ files: { ...(config.files || {}), approvals: target } });
    console.log(`Файловые подтверждения: ${target}`);
    return;
  }

  if (action === "tree") {
    const rows = await filesTree(target || ".", options);
    if (options.json) printJson(rows);
    else printTable(rows, [["type", "Тип"], ["path", "Путь"], ["size", "Размер"]]);
    return;
  }

  if (action === "read") {
    if (!target) throw new Error("Пример: iola files read README.md");
    console.log(await filesRead(target, options));
    return;
  }

  if (action === "search") {
    const query = target;
    if (!query) throw new Error('Пример: iola files search "Петрова" --path .');
    const rows = await filesSearch(query, options);
    if (options.json) printJson(rows);
    else printTable(rows, [["file", "Файл"], ["line", "Строка"], ["text", "Текст"]]);
    return;
  }

  if (action === "write") {
    if (!target) throw new Error('Пример: iola files write report.md --text "..."');
    const text = options.text ?? rest.join(" ");
    if (!text) throw new Error('Для записи нужен --text "..." или текст после пути.');
    if (options.stage) {
      const id = await stageFileChange("write", target, text);
      console.log(`Изменение подготовлено: ${id}`);
    } else {
      await filesWrite(target, text, { append: Boolean(options.append) });
      console.log(`Файл записан: ${target}`);
    }
    return;
  }

  if (action === "patch") {
    if (!target) throw new Error('Пример: iola files patch README.md --search old --replace new');
    if (!options.search || options.replace === undefined) throw new Error("Для patch нужны --search и --replace.");
    if (options.stage) {
      const current = await filesRead(target);
      const next = current.split(options.search).join(options.replace);
      const id = await stageFileChange("patch", target, next, current);
      console.log(`Изменение подготовлено: ${id}`);
    } else {
      const result = await filesPatch(target, options.search, options.replace);
      printKeyValue(result);
    }
    return;
  }

  throw new Error("Команды files: status, mode MODE, approvals POLICY, tree [PATH], read FILE, search TEXT, write FILE --text TEXT, patch FILE --search OLD --replace NEW.");
}

async function handleArchive(args) {
  const [action = "doctor", target, ...rest] = args;
  const options = parseOptions(rest);
  if (action === "doctor") {
    const sevenZip = await ensureArchiveTool({ install: true });
    printKeyValue({ sevenZip, status: "ok", formats: "zip, 7z, rar, tar, gz, tgz, bz2, xz и др." });
    return;
  }
  if (action === "list") {
    if (!target) throw new Error("Пример: iola archive list docs.zip");
    const rows = await archiveList(target);
    printTable(rows, [["date", "Дата"], ["size", "Размер"], ["name", "Файл"]]);
    return;
  }
  if (action === "test") {
    if (!target) throw new Error("Пример: iola archive test docs.zip");
    await archiveRun(["t", target]);
    console.log("Архив проверен.");
    return;
  }
  if (action === "extract") {
    if (!target) throw new Error("Пример: iola archive extract docs.zip --output ./out");
    const outputDir = options.output || path.join(process.cwd(), path.basename(target, path.extname(target)));
    await archiveRun(["x", target, `-o${outputDir}`, "-y"]);
    console.log(`Архив распакован: ${outputDir}`);
    return;
  }
  if (action === "create") {
    const outputFile = target;
    const inputPath = rest[0] || options.path || ".";
    if (!outputFile) throw new Error("Пример: iola archive create docs.zip ./docs");
    await archiveRun(["a", outputFile, inputPath]);
    console.log(`Архив создан: ${outputFile}`);
    return;
  }
  if (action === "index") {
    if (!target) throw new Error("Пример: iola archive index docs.zip");
    const tempDir = path.join(os.tmpdir(), `iola-archive-${Date.now()}`);
    const previous = await loadConfig();
    await mkdir(tempDir, { recursive: true });
    try {
      await archiveRun(["x", target, `-o${tempDir}`, "-y"]);
      await saveConfig({ files: { ...(previous.files || {}), workspaceRoot: tempDir, mode: "read-only" } });
      await setFilesMode("read-only", await loadConfig());
      const count = await indexFolder(".", { depth: options.depth || 8, limit: options.limit || 2000 });
      console.log(`Проиндексировано файлов из архива: ${count}`);
    } finally {
      await saveConfig({ files: previous.files, permissions: previous.permissions, toolsets: previous.toolsets }).catch(() => {});
      await rm(tempDir, { recursive: true, force: true });
    }
    return;
  }
  throw new Error("Команды archive: doctor, list FILE, test FILE, extract FILE --output DIR, create OUT INPUT, index FILE.");
}

async function archiveRun(args) {
  const command = await ensureArchiveTool({ install: true });
  return runCommand(command, args, { inherit: true });
}

async function archiveList(target) {
  const command = await ensureArchiveTool({ install: true });
  const { stdout } = await runCommand(command, ["l", "-slt", target]);
  const rows = [];
  let current = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.Path && current.Path !== target) rows.push({
        date: current.Modified || current.Created || "-",
        size: current.Size || "-",
        name: current.Path,
      });
      current = {};
      continue;
    }
    const [key, ...parts] = line.split(" = ");
    if (key && parts.length) current[key.trim()] = parts.join(" = ").trim();
  }
  if (current.Path && current.Path !== target) rows.push({ date: current.Modified || current.Created || "-", size: current.Size || "-", name: current.Path });
  return rows;
}

async function handleChanges(args) {
  const [action = "list", id] = args;
  if (action === "list" || action === "ls") {
    printTable(listChanges(), [["id", "ID"], ["kind", "Тип"], ["target", "Файл"], ["status", "Статус"], ["created_at", "Дата"]]);
    return;
  }
  if (action === "show") {
    const change = getChange(Number(id));
    console.log(unifiedPreview(change.before_text || "", change.after_text || ""));
    return;
  }
  if (action === "apply") {
    await applyChange(Number(id));
    console.log(`Изменение применено: ${id}`);
    return;
  }
  if (action === "discard") {
    updateChangeStatus(Number(id), "discarded");
    console.log(`Изменение отклонено: ${id}`);
    return;
  }
  throw new Error("Команды changes: list, show ID, apply ID, discard ID.");
}

async function handleImport(args) {
  const [action, target, ...rest] = args;
  const options = parseOptions(rest);
  if (action === "file") {
    if (!target) throw new Error("Пример: iola import file data.csv --dataset custom");
    const dataset = options.dataset || path.basename(target, path.extname(target));
    const count = await importDataFile(target, dataset);
    console.log(`Импортировано записей: ${count}, dataset=${dataset}`);
    return;
  }
  if (action === "folder") {
    if (!target) throw new Error("Пример: iola import folder ./data");
    const rows = await filesTree(target, { depth: 1, limit: 200 });
    let total = 0;
    for (const row of rows.filter((item) => item.type === "file" && /\.(json|csv)$/i.test(item.path))) {
      total += await importDataFile(row.path, options.dataset || path.basename(row.path, path.extname(row.path)));
    }
    console.log(`Импортировано записей: ${total}`);
    return;
  }
  throw new Error("Команды import: file PATH --dataset NAME, folder PATH.");
}

async function handleIndex(args) {
  const [action = "status", target, ...rest] = args;
  const options = parseOptions(rest);
  if (action === "status") {
    printKeyValue(getIndexStatus());
    return;
  }
  if (action === "folder") {
    if (!target) throw new Error("Пример: iola index folder ./docs");
    const count = await indexFolder(target, options);
    console.log(`Проиндексировано документов: ${count}`);
    return;
  }
  if (action === "archive") {
    if (!target) throw new Error("Пример: iola index archive docs.zip");
    await handleArchive(["index", target, ...rest]);
    return;
  }
  if (action === "search") {
    const query = [target, ...rest].filter(Boolean).join(" ");
    if (!query) throw new Error('Пример: iola index search "школа 29"');
    printTable(searchDocs(query, Number(options.limit || 20)), [["file", "Файл"], ["title", "Название"], ["snippet", "Фрагмент"]]);
    return;
  }
  throw new Error("Команды index: status, folder PATH, archive FILE, search TEXT.");
}

async function handleReports(args) {
  const [action = "list", name, ...rest] = args;
  const packs = {
    "education-passport": ["education-contacts", "licenses"],
    "data-quality-pack": ["schools-summary", "missing-phones"],
  };
  if (action === "list") {
    printTable(Object.entries(packs).map(([pack, reports]) => ({ pack, reports: reports.join(", ") })), [["pack", "Пакет"], ["reports", "Отчеты"]]);
    return;
  }
  if (action === "run") {
    if (!packs[name]) throw new Error(`Пакет неизвестен: ${Object.keys(packs).join(", ")}`);
    const options = parseOptions(rest);
    const dir = options.output || path.join(process.cwd(), `iola-report-${name}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    for (const report of packs[name]) {
      await handleExport([report, "--format", "xlsx", "--output", path.join(dir, `${report}.xlsx`)]);
      await handleExport([report, "--format", "docx", "--output", path.join(dir, `${report}.docx`)]);
    }
    saveArtifact("report-pack", name, dir, { reports: packs[name] });
    console.log(`Пакет отчетов создан: ${dir}`);
    return;
  }
  throw new Error("Команды reports: list, run NAME [--output DIR].");
}

async function handlePlugins(args) {
  const [action = "list", name, ...rest] = args;
  if (action === "list" || action === "ls") {
    printTable(listPlugins(), [["name", "Plugin"], ["source", "Источник"], ["command", "Команда"]]);
    return;
  }
  if (action === "install") {
    const options = parseOptions(rest);
    if (!name) throw new Error("Пример: iola plugins install my-plugin --command \"iola quality\"");
    savePlugin(name, options.source || name, options.command || "");
    console.log(`Plugin установлен: ${name}`);
    return;
  }
  if (action === "run") {
    const plugin = getPlugin(name);
    if (!plugin.command) throw new Error("У plugin нет command.");
    await main(splitCommandLine(plugin.command));
    return;
  }
  if (action === "remove" || action === "delete") {
    deletePlugin(name);
    console.log(`Plugin удален: ${name}`);
    return;
  }
  throw new Error("Команды plugins: list, install NAME --command CMD, run NAME, remove NAME.");
}

async function handleBrowser(args) {
  const [action = "status", target, ...rest] = args;
  const options = parseOptions(rest);

  if (action === "status") {
    printKeyValue(await getBrowserStatus());
    return;
  }

  if (action === "install") {
    await installBrowserRuntime();
    printKeyValue(await getBrowserStatus());
    return;
  }

  if (action === "open") {
    const url = target || options.url;
    if (!url) throw new Error("Пример: iola browser open https://example.com");
    if (options.system) {
      await openUrl(url);
      return;
    }
    await runBrowserAutomation("open", { url, headed: options.headless ? false : true, waitMs: Number(options.wait || 600000) });
    return;
  }

  if (action === "text" || action === "html") {
    const url = target || options.url;
    if (!url) throw new Error(`Пример: iola browser ${action} https://example.com`);
    const result = await runBrowserAutomation(action, browserParams(url, options));
    if (options.output) {
      await writeFile(options.output, result, "utf8");
      console.log(`Файл сохранен: ${options.output}`);
    } else {
      console.log(result);
    }
    return;
  }

  if (action === "screenshot" || action === "pdf") {
    const url = target || options.url;
    if (!url) throw new Error(`Пример: iola browser ${action} https://example.com --output page.${action === "pdf" ? "pdf" : "png"}`);
    const output = options.output || path.join(process.cwd(), action === "pdf" ? "browser-page.pdf" : "browser-page.png");
    await runBrowserAutomation(action, { ...browserParams(url, options), output: path.resolve(output) });
    saveArtifact(action === "pdf" ? "browser-pdf" : "browser-screenshot", url, path.resolve(output), { url });
    console.log(`Файл сохранен: ${output}`);
    return;
  }

  if (action === "click") {
    const url = target || options.url;
    if (!url || !options.selector) throw new Error('Пример: iola browser click https://example.com --selector "button" --output after.png');
    const result = await runBrowserAutomation("click", { ...browserParams(url, options), selector: options.selector, output: options.output ? path.resolve(options.output) : "" });
    if (result) console.log(result);
    return;
  }

  if (action === "type") {
    const url = target || options.url;
    if (!url || !options.selector || options.text === undefined) throw new Error('Пример: iola browser type https://example.com --selector "#q" --text "школа 29"');
    const result = await runBrowserAutomation("type", { ...browserParams(url, options), selector: options.selector, text: options.text, press: options.press || "", output: options.output ? path.resolve(options.output) : "" });
    if (result) console.log(result);
    return;
  }

  if (action === "eval") {
    const url = target || options.url;
    const script = options.script || rest.join(" ");
    if (!url || !script) throw new Error('Пример: iola browser eval https://example.com --script "document.title"');
    const result = await runBrowserAutomation("eval", { ...browserParams(url, options), script });
    console.log(result);
    return;
  }

  throw new Error("Команды browser: status, install, open URL, text URL, html URL, screenshot URL --output FILE, pdf URL --output FILE, click URL --selector SEL, type URL --selector SEL --text TEXT, eval URL --script JS.");
}

function browserParams(url, options = {}) {
  return {
    url,
    headed: Boolean(options.headed),
    timeout: Number(options.timeout || 30000),
    waitMs: Number(options.wait || 0),
    selector: options.selector || "",
    viewport: options.viewport || "1366x768",
  };
}

async function handleWorkspace(args) {
  const [action = "status", nameOrPath] = args;
  const config = await loadConfig();
  if (action === "status") {
    printKeyValue({ root: resolveWorkspaceRoot(config), fileMode: config.files?.mode, approvals: config.files?.approvals });
    return;
  }
  if (action === "init") {
    await handleContext(["init"]);
    await mkdir(path.join(process.cwd(), ".iola", "skills"), { recursive: true });
    console.log(`Workspace готов: ${process.cwd()}`);
    return;
  }
  if (action === "list") {
    const rows = Object.entries(config.workspaces || {}).map(([name, value]) => ({ name, path: value.path }));
    printTable(rows, [["name", "Workspace"], ["path", "Путь"]]);
    return;
  }
  if (action === "use") {
    if (!nameOrPath) throw new Error("Пример: iola workspace use D:\\project");
    const root = path.resolve(nameOrPath);
    const name = path.basename(root);
    await saveConfig({ workspaces: { ...(config.workspaces || {}), [name]: { path: root } }, files: { ...(config.files || {}), workspaceRoot: root } });
    console.log(`Workspace выбран: ${root}`);
    return;
  }
  throw new Error("Команды workspace: init, status, list, use PATH.");
}

async function handleTasks(args) {
  const [action = "list", idOrText, ...rest] = args;
  if (action === "list" || action === "ls") {
    printTable(listTasks(), [["id", "ID"], ["status", "Статус"], ["title", "Задача"], ["command", "Команда"]]);
    return;
  }
  if (action === "add") {
    const title = [idOrText, ...rest].filter(Boolean).join(" ");
    if (!title) throw new Error('Пример: iola tasks add "проверить школы"');
    const id = addTask(title);
    console.log(`Задача добавлена: ${id}`);
    return;
  }
  if (action === "done") {
    updateTaskStatus(Number(idOrText), "done");
    console.log(`Задача выполнена: ${idOrText}`);
    return;
  }
  if (action === "run") {
    const task = getTask(Number(idOrText));
    if (!task.command) throw new Error("У задачи нет команды. Добавьте command через SQLite пока не реализовано редактирование.");
    await main(splitCommandLine(task.command));
    updateTaskStatus(task.id, "done");
    return;
  }
  throw new Error("Команды tasks: list, add TEXT, done ID, run ID.");
}

async function handleArtifacts(args) {
  const [action = "list", id] = args;
  if (action === "list" || action === "ls") {
    printTable(listArtifacts(), [["id", "ID"], ["kind", "Тип"], ["title", "Название"], ["file", "Файл"], ["created_at", "Дата"]]);
    return;
  }
  if (action === "show") {
    const artifact = getArtifact(Number(id));
    if (artifact.file && existsSync(artifact.file)) console.log(await readFile(artifact.file, "utf8"));
    else printJson(artifact);
    return;
  }
  if (action === "open") {
    const artifact = getArtifact(Number(id));
    if (!artifact.file) throw new Error("У artifact нет файла.");
    await openUrl(artifact.file);
    return;
  }
  throw new Error("Команды artifacts: list, show ID, open ID.");
}

async function handleSnapshot(args) {
  const [action = "list", id] = args;
  if (action === "create") {
    const result = await createSnapshot();
    printKeyValue(result);
    return;
  }
  if (action === "list" || action === "ls") {
    printTable(listSnapshots(), [["id", "ID"], ["workspace", "Workspace"], ["path", "Папка"], ["created_at", "Дата"]]);
    return;
  }
  if (action === "restore") {
    await restoreSnapshot(Number(id));
    console.log(`Snapshot восстановлен: ${id}`);
    return;
  }
  throw new Error("Команды snapshot: create, list, restore ID.");
}

async function handleSandbox(args) {
  const [action = "fork", ...rest] = args;
  if (action === "fork") {
    const result = await createSandboxCopy(rest[0]);
    printKeyValue(result);
    return;
  }
  if (action === "run") {
    const command = rest.join(" ").trim();
    if (!command) throw new Error('Пример: iola sandbox run "npm test"');
    const sandbox = await createSandboxCopy();
    const parts = splitCommandLine(command);
    console.log(`Sandbox: ${sandbox.path}`);
    await runCommand(parts[0], parts.slice(1), { inherit: true, cwd: sandbox.path });
    return;
  }
  if (action === "diff") {
    const sandboxPath = rest[0];
    if (!sandboxPath) throw new Error("Пример: iola sandbox diff PATH");
    await runCommand("git", ["diff", "--no-index", process.cwd(), sandboxPath], { inherit: true }).catch(() => {});
    return;
  }
  if (action === "apply") {
    const sandboxPath = rest[0];
    if (!sandboxPath) throw new Error("Пример: iola sandbox apply PATH");
    await cp(sandboxPath, process.cwd(), { recursive: true, force: true });
    console.log(`Sandbox применен: ${sandboxPath}`);
    return;
  }
  throw new Error("Команды sandbox: fork [NAME], run COMMAND, diff PATH, apply PATH.");
}

async function handleTrace(args) {
  const [action = "last", id] = args;
  if (action === "last") {
    printTable(listTrace(Number(id || 20)), [["id", "ID"], ["run_id", "Run"], ["tool", "Tool"], ["status", "Статус"], ["summary", "Сводка"]]);
    return;
  }
  if (action === "show") {
    printJson(getTraceRun(id));
    return;
  }
  throw new Error("Команды trace: last [LIMIT], show RUN_ID.");
}

async function handleTrajectory(args) {
  const [action = "export", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "last") {
    const rows = buildTrajectoryRows(Number(options.limit || rest[0] || 20));
    if (options.json) printJson(rows);
    else printTable(rows, [["type", "Тип"], ["id", "ID"], ["created_at", "Дата"], ["summary", "Сводка"]]);
    return;
  }
  if (action === "export") {
    const format = options.format || "jsonl";
    const output = options.output || path.join(process.cwd(), `iola-trajectory-${Date.now()}.${format}`);
    const rows = buildTrajectoryRows(Number(options.limit || 500));
    const text = format === "json" ? `${JSON.stringify(rows, null, 2)}\n` : rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await writeFile(output, text, "utf8");
    saveArtifact("trajectory", path.basename(output), output, { format, rows: rows.length });
    console.log(`Trajectory экспортирована: ${output}`);
    return;
  }
  throw new Error("Команды trajectory: last [--limit N], export [--format jsonl|json] [--output FILE].");
}

async function handleUsage(args) {
  const [action = "summary"] = args;
  if (action === "summary") {
    printKeyValue(getUsageSummary());
    return;
  }
  if (action === "models") {
    printTable(getUsageByModel(), [["provider", "Провайдер"], ["model", "Модель"], ["requests", "Запросы"], ["tokens", "Токены"], ["cost", "USD"]]);
    return;
  }
  if (action === "sessions") {
    printTable(getUsageBySession(), [["session_id", "Сессия"], ["requests", "Запросы"], ["tokens", "Токены"], ["cost", "USD"]]);
    return;
  }
  throw new Error("Команды usage: summary, models, sessions.");
}

async function handleBudget(args) {
  const [action = "status", scope = "daily", amount] = args;
  if (action === "status") {
    printTable(listBudgets(), [["scope", "Область"], ["amount_usd", "Лимит USD"], ["spent_usd", "Потрачено"], ["updated_at", "Обновлено"]]);
    return;
  }
  if (action === "set") {
    const value = Number(amount || args[2]);
    if (!value || value < 0) throw new Error("Пример: iola budget set daily 5");
    setBudget(scope, value);
    console.log(`Budget сохранен: ${scope}=${value} USD`);
    return;
  }
  throw new Error("Команды budget: status, set daily AMOUNT.");
}

async function handlePolicy(args) {
  const [action = "list", name] = args;
  const policies = {
    safe: { fileMode: "read-only", approvals: "always", toolProfile: "safe" },
    analyst: { fileMode: "read-only", approvals: "on-danger", toolsets: ["data-read", "reports", "sync", "ai", "local-files-read"] },
    developer: { fileMode: "workspace-write", approvals: "on-write", toolsets: ["data-read", "reports", "sync", "ai", "local-files-read", "local-files-write"] },
    full: { fileMode: "full-access", approvals: "on-danger", toolProfile: "full" },
  };
  if (action === "list") {
    printTable(Object.entries(policies).map(([policy, value]) => ({ policy, ...value, toolsets: value.toolsets?.join(", ") || value.toolProfile })), [["policy", "Policy"], ["fileMode", "Files"], ["approvals", "Approvals"], ["toolsets", "Toolsets"]]);
    return;
  }
  if (action === "use") {
    const policy = policies[name];
    if (!policy) throw new Error(`Policy неизвестна: ${Object.keys(policies).join(", ")}`);
    const config = await loadConfig();
    if (policy.toolProfile) {
      await handleTools(["profile", policy.toolProfile]);
    } else {
      await saveConfig({ toolsets: { ...(config.toolsets || {}), enabled: policy.toolsets } });
    }
    const next = await loadConfig();
    await saveConfig({ files: { ...(next.files || {}), mode: policy.fileMode, approvals: policy.approvals } });
    await setFilesMode(policy.fileMode, await loadConfig());
    console.log(`Policy применена: ${name}`);
    return;
  }
  throw new Error("Команды policy: list, use NAME.");
}

async function handleExport(args) {
  const [name] = args;
  const options = parseOptions(args.slice(1));
  const format = options.format || "xlsx";
  const output = options.output || `${name || "iola-export"}.${format}`;
  await ensureLocalData();
  const rows = buildReportRows(name || "education-contacts");
  if (format === "xlsx") {
    await writeFile(output, toSpreadsheetXml(rows), "utf8");
  } else if (format === "docx" || format === "doc") {
    await writeFile(output, toWordHtml(name || "Отчет", rows), "utf8");
  } else {
    await outputData(rows, { output }, format);
  }
  saveArtifact("export", name || "export", output, { format, rows: rows.length });
  console.log(`Экспорт создан: ${output}`);
}

async function handleCron(args) {
  const [action = "list", ...rest] = args;
  const options = parseOptions(rest);

  if (action === "list" || action === "ls") {
    const rows = listCronJobs();
    if (options.json) printJson(rows);
    else printTable(rows, [["id", "ID"], ["enabled", "Вкл"], ["schedule_text", "Расписание"], ["command", "Команда"], ["last_run_at", "Последний запуск"]]);
    return;
  }

  if (action === "add") {
    const text = rest.join(" ").trim();
    const separator = text.includes(" -- ") ? " -- " : " :: ";
    const [scheduleText, command] = text.split(separator).map((part) => part?.trim());
    if (!scheduleText || !command) {
      throw new Error('Пример: iola cron add "каждый день 09:00 -- quality"');
    }
    const id = addCronJob(scheduleText, command);
    console.log(`Cron-задача добавлена: ${id}`);
    return;
  }

  if (action === "delete" || action === "remove" || action === "rm") {
    const id = Number(rest[0]);
    if (!id) throw new Error("Пример: iola cron delete 1");
    deleteCronJob(id);
    console.log(`Cron-задача удалена: ${id}`);
    return;
  }

  if (action === "run") {
    const id = Number(rest[0]);
    if (!id) throw new Error("Пример: iola cron run 1");
    await runCronJob(id);
    return;
  }

  if (action === "tick") {
    const rows = dueCronJobs();
    for (const row of rows) await runCronJob(row.id);
    console.log(`Выполнено cron-задач: ${rows.length}`);
    return;
  }

  throw new Error('Команды cron: list, add "каждый день 09:00 -- quality", delete ID, run ID, tick.');
}

async function handleDaemon(args) {
  const [action = "status"] = args;
  const config = await loadConfig();
  const host = config.daemon?.host || "127.0.0.1";
  const port = Number(config.daemon?.port || DAEMON_PORT);

  if (action === "status") {
    try {
      const payload = await fetchJson(`http://${host}:${port}/health`);
      printKeyValue(payload);
    } catch {
      printKeyValue({ status: "stopped", endpoint: `http://${host}:${port}` });
    }
    return;
  }

  if (action === "start" || action === "run") {
    await startDaemon(host, port);
    return;
  }

  throw new Error("Команды daemon: status, start.");
}

async function handleRpc(args) {
  const [action = "call", method, ...rest] = args;
  if (action !== "call" || !method) {
    throw new Error("Пример: iola rpc call search --query Петрова --dataset schools");
  }
  const result = await executeRpc(method, parseOptions(rest));
  printJson(result);
}

async function openUrl(url) {
  if (process.platform === "win32") {
    await runCommand("rundll32", ["url.dll,FileProtocolHandler", url], { inherit: false });
    return;
  }
  if (process.platform === "darwin") {
    await runCommand("open", [url], { inherit: false });
    return;
  }
  await runCommand("xdg-open", [url], { inherit: false });
}

function maskSecret(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? "***" : "-";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function flattenObjectForPrint(value, prefix = "") {
  const rows = {};
  for (const [key, item] of Object.entries(value || {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(rows, flattenObjectForPrint(item, name));
    } else {
      rows[name] = Array.isArray(item) ? item.join(", ") : item;
    }
  }
  return rows;
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
      ...FILE_TOOLS.map((tool) => ({
        permission: `localTools.${tool}`,
        value: permissions.localTools?.[tool] === true ? "allow" : "deny",
        scope: "file-tool",
      })),
      { permission: "readFiles", value: permissions.readFiles === true ? "allow" : "deny", scope: "filesystem" },
      { permission: "editFiles", value: permissions.editFiles === true ? "allow" : "deny", scope: "filesystem" },
      { permission: "deleteFiles", value: permissions.deleteFiles === true ? "allow" : "deny", scope: "filesystem" },
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
      throw new Error("Пример: iola permissions deny export_report");
    }
    const allow = action === "allow";
    const next = { ...(config.permissions || DEFAULT_AI_CONFIG.permissions) };
    next.localTools = { ...(next.localTools || {}) };
    if (ALL_TOOL_ALIASES.includes(name)) {
      next.localTools[name] = allow;
    } else if (name in DEFAULT_AI_CONFIG.permissions) {
      next[name] = allow;
    } else {
      throw new Error(`Неизвестное разрешение: ${name}. Доступно: ${[...ALL_LOCAL_TOOLS, "readFiles", "writeFiles", "editFiles", "deleteFiles", "sync", "externalApi", "externalAi", "codex"].join(", ")}`);
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

  if (action === "suggest" || action === "suggestions") {
    const rows = listMemorySuggestions(rest[0] || "pending");
    if (options.json) printJson(rows);
    else printTable(rows, [["id", "ID"], ["status", "Статус"], ["content", "Предложение"], ["reason", "Причина"], ["created_at", "Дата"]]);
    return;
  }

  if (action === "approve") {
    const id = Number(rest[0]);
    if (!id) throw new Error("Пример: iola memory approve 1");
    const memoryId = approveMemorySuggestion(id);
    console.log(`Предложение принято. Память сохранена: ${memoryId}`);
    return;
  }

  if (action === "reject") {
    const id = Number(rest[0]);
    if (!id) throw new Error("Пример: iola memory reject 1");
    resolveMemorySuggestion(id, "rejected");
    console.log(`Предложение отклонено: ${id}`);
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

  if (action === "duplicates" || action === "curate") {
    const rows = findMemoryDuplicates();
    if (options.json) printJson(rows);
    else printTable(rows, [["keeper_id", "Оставить"], ["duplicate_id", "Дубликат"], ["content", "Текст"]]);
    return;
  }

  if (action === "prune") {
    const rows = findMemoryDuplicates();
    if (!options.yes) {
      printTable(rows, [["keeper_id", "Оставить"], ["duplicate_id", "Удалить"], ["content", "Текст"]]);
      console.log("Для удаления дубликатов запустите: iola memory prune --yes");
      return;
    }
    for (const row of rows) deleteMemory(row.duplicate_id);
    console.log(`Удалено дубликатов памяти: ${rows.length}`);
    return;
  }

  throw new Error("Команды memory: show, add TEXT, suggest, approve ID, reject ID, delete ID, clear, export [FILE], curate, duplicates, prune --yes.");
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

  if (action === "trust") {
    await saveConfig({ hooksTrusted: true });
    console.log("Hooks помечены как доверенные для текущего пользователя.");
    return;
  }

  if (action === "audit") {
    const rows = Object.entries(config.hooks || {}).map(([hookEvent, commands]) => ({
      event: hookEvent,
      commands: commands.length,
      trusted: config.hooksTrusted ? "yes" : "no",
    }));
    printTable(rows, [["event", "Событие"], ["commands", "Команд"], ["trusted", "Доверено"]]);
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

  throw new Error("Команды hooks: list, events, add EVENT COMMAND, delete EVENT INDEX, run EVENT, trust, audit.");
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

async function handleSubagents(args) {
  const [action = "list", name, ...rest] = args;
  const config = await loadConfig();
  const custom = config.subagents || {};
  const agents = { ...AGENTS, ...custom };

  if (action === "list" || action === "ls") {
    const rows = Object.entries(agents).map(([agent, meta]) => ({
      agent,
      profile: meta.profile || "active",
      tools: meta.tools ? "yes" : "no",
      source: AGENTS[agent] ? "builtin" : "user",
      description: meta.description || "-",
    }));
    printTable(rows, [["agent", "Subagent"], ["profile", "Профиль"], ["tools", "Tools"], ["source", "Источник"], ["description", "Описание"]]);
    return;
  }

  if (action === "add") {
    const options = parseOptions(rest);
    if (!name) throw new Error("Пример: iola subagents add culture --profile local --prompt \"...\"");
    const prompt = options.prompt || options.command || options._.join(" ");
    const next = {
      ...custom,
      [name]: {
        profile: options.profile || null,
        tools: Boolean(options.tools),
        prefix: prompt ? `${prompt} ` : "",
        description: options.description || prompt || "Пользовательский subagent",
      },
    };
    await saveConfig({ subagents: next });
    console.log(`Subagent добавлен: ${name}`);
    return;
  }

  if (action === "run") {
    if (!agents[name]) throw new Error(`Subagent неизвестен: ${name}. Доступно: ${Object.keys(agents).join(", ")}`);
    await runSubagent(name, agents[name], rest);
    return;
  }

  if (action === "parallel") {
    const names = String(name || "").split(",").map((item) => item.trim()).filter(Boolean);
    const question = rest.join(" ").trim();
    if (!names.length || !question) throw new Error('Пример: iola subagents parallel data-analyst,reviewer "проверь школы"');
    for (const agentName of names) {
      if (!agents[agentName]) throw new Error(`Subagent неизвестен: ${agentName}`);
      console.log(`\n## ${agentName}`);
      await runSubagent(agentName, agents[agentName], [question, "--no-history"]);
    }
    return;
  }

  throw new Error("Команды subagents: list, add NAME --profile PROFILE --prompt TEXT, run NAME TEXT, parallel a,b TEXT.");
}

async function runSubagent(name, agent, rest) {
  const options = parseOptions(rest);
  const question = options._.join(" ").trim();
  if (!question) throw new Error(`Пример: iola subagents run ${name} "найди школы"`);
  const askArgs = [agent.prefix ? `${agent.prefix}${question}` : question, "--agent", name];
  if (agent.profile || options.profile) askArgs.push("--profile", options.profile || agent.profile);
  if (agent.tools || options.tools) askArgs.push("--tools");
  if (agent.reasoning || options.reasoning) askArgs.push("--reasoning", options.reasoning || agent.reasoning);
  if (options.files) askArgs.push("--files");
  if (options.events) askArgs.push("--events");
  if (options["no-history"]) askArgs.push("--no-history");
  await aiAsk(askArgs);
}

async function handleReview(args) {
  const [action = "config", target, ...rest] = args;
  const options = parseOptions([target, ...rest].filter(Boolean));
  const actualTarget = options._[0];
  if (action === "config") {
    const errors = validateConfig(await loadConfig());
    const rows = errors.length ? errors.map((error) => ({ level: "error", message: error })) : [{ level: "ok", message: "Конфигурация валидна" }];
    printTable(rows, [["level", "Уровень"], ["message", "Сообщение"]]);
    return;
  }
  if (action === "data") {
    await ensureLocalData();
    const rows = runQuality(actualTarget || "all");
    if (options.json) printJson(rows);
    else printTable(rows, [["check", "Проверка"], ["count", "Кол-во"], ["sample", "Пример"]]);
    return;
  }
  if (action === "docs") {
    const rows = actualTarget ? await reviewDocumentFolder(actualTarget, options) : searchDocs(options.query || "", Number(options.limit || 20));
    if (options.json) printJson(rows);
    else printTable(rows, [["file", "Файл"], ["issue", "Замечание"], ["detail", "Детали"]]);
    return;
  }
  if (action === "report") {
    if (!actualTarget) throw new Error("Пример: iola review report отчет.docx");
    const text = await extractReadableText(path.resolve(actualTarget));
    const rows = [
      { file: actualTarget, issue: text.trim() ? "ok" : "empty", detail: text.trim() ? "Текст извлечен" : "Не удалось извлечь текст" },
      { file: actualTarget, issue: /источник|данн/i.test(text) ? "ok" : "missing-source", detail: "Проверьте указание источника данных" },
    ];
    printTable(rows, [["file", "Файл"], ["issue", "Замечание"], ["detail", "Детали"]]);
    return;
  }
  throw new Error("Команды review: config, data [scope], docs [PATH], report FILE.");
}

async function reviewDocumentFolder(target, options = {}) {
  const previous = await loadConfig();
  const rows = [];
  try {
    await saveConfig({ files: { ...(previous.files || {}), workspaceRoot: path.resolve(target), mode: "read-only" } });
    await setFilesMode("read-only", await loadConfig());
    const files = await filesTree(".", { depth: Number(options.depth || 5), limit: Number(options.limit || 200) });
    for (const file of files.filter((item) => item.type === "file" && INDEXABLE_EXTENSIONS.test(item.path))) {
      rows.push({ file: file.path, issue: "indexable", detail: "Документ можно читать и индексировать" });
    }
  } finally {
    await saveConfig({ files: previous.files, permissions: previous.permissions, toolsets: previous.toolsets }).catch(() => {});
  }
  return rows;
}

async function handleMcp(args) {
  const [action = "status", target = "codex", ...rest] = args;
  const options = parseOptions([target, ...rest]);

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

  if (action === "serve") {
    const config = await loadConfig();
    if (options.stdio || target === "--stdio" || target === "stdio") {
      await startMcpStdio();
      return;
    }
    await startMcpServer(config.daemon?.host || "127.0.0.1", Number(config.daemon?.port || DAEMON_PORT) + 1);
    return;
  }

  throw new Error("Команды mcp: status, list, install codex, remove codex, serve.");
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
  const options = parseOptions(args.slice(1));
  if (options.format === "docx" || options.format === "xlsx") {
    await handleExport([name || "education-contacts", "--format", options.format, "--output", options.output || `${name || "report"}.${options.format}`]);
    return;
  }
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

function buildReportRows(name) {
  const reportName = name || "education-contacts";
  if (reportName === "schools-summary") return getLocalSummaryRows("schools");
  if (reportName === "missing-phones") return searchLocalRecords("", { dataset: "all", limit: 500 }).filter((item) => !item.phone || item.phone === "-");
  if (reportName === "licenses") return searchLocalRecords("", { dataset: "all", limit: 500 }).map((item) => ({ name: item.name, license_number: item.license_number, license_status: item.license_status }));
  return searchLocalRecords("", { dataset: "all", limit: 500 });
}

function toSpreadsheetXml(rows) {
  const columns = Object.keys(rows[0] || { empty: "" });
  const cell = (value) => `<Cell><Data ss:Type="String">${escapeXml(value ?? "")}</Data></Cell>`;
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="IOLA"><Table>
<Row>${columns.map(cell).join("")}</Row>
${rows.map((row) => `<Row>${columns.map((column) => cell(row[column])).join("")}</Row>`).join("\n")}
</Table></Worksheet></Workbook>`;
}

function toWordHtml(title, rows) {
  const columns = Object.keys(rows[0] || { empty: "" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>
<h1>${escapeHtml(title)}</h1>
<table border="1" cellspacing="0" cellpadding="4">
<thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("\n")}</tbody>
</table></body></html>`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return escapeXml(value);
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
    await showBanner();
    const selected = await chooseAiProvider();
    await aiSetup([selected]);
    return;
  }

  if (provider === "iola") {
    await setupIolaLocal(args.slice(1));
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

  if (!["iola", "ollama", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер обязателен: iola ai models iola|ollama|openai|openrouter|codex");
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
  if (provider === "iola") {
    const state = readConfigLayerSync(getIolaModelStateFile(IOLA_MODEL_DIR)) || {};
    const remote = await getRemoteIolaModelRevision().catch(() => null);
    return [{
      id: IOLA_LOCAL_MODEL,
      provider: "iola",
      note: state.revision
        ? `installed ${state.revision.slice(0, 12)}${remote?.sha && remote.sha !== state.revision ? ", update available" : ""}`
        : "not installed",
    }];
  }

  if (provider === "ollama") {
    try {
      const config = await loadConfig();
      const response = await fetch(`${config.ai.profiles?.local?.baseUrl || "http://127.0.0.1:11434"}/api/tags`);

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      const installed = (payload.models || []).map((model) => ({
        id: model.name,
        provider: "ollama",
        note: model.modified_at ? `updated ${model.modified_at}` : "local",
      }));
      const installedIds = new Set(installed.map((model) => model.id));
      const recommended = getRecommendedOllamaModels("not installed")
        .filter((model) => !installedIds.has(model.id));
      return [...installed, ...recommended];
    } catch {
      return getRecommendedOllamaModels("recommended");
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

function getRecommendedOllamaModels(notePrefix = "recommended") {
  return [
    { id: IOLA_LOCAL_OLLAMA_MODEL, provider: "ollama", note: `${notePrefix} IOLA default low RAM` },
    { id: "qwen3:1.7b", provider: "ollama", note: `${notePrefix} recommended low RAM` },
    { id: "qwen3:4b", provider: "ollama", note: `${notePrefix} recommended balanced` },
    { id: "gemma3:4b", provider: "ollama", note: `${notePrefix} Gemma balanced` },
    { id: "llama3.2:3b", provider: "ollama", note: `${notePrefix} legacy fallback` },
    { id: "llama3.2:1b", provider: "ollama", note: `${notePrefix} minimal fallback only` },
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

  if (!["iola", "ollama", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер должен быть iola, ollama, openai, openrouter или codex.");
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

  await setActiveAiProfile(name, profile, config);

  console.log(`Активный AI-профиль: ${name} (${profile.provider}, ${profile.model || "-"})`);
}

async function setActiveAiProfile(name, profile, loadedConfig = null) {
  const config = loadedConfig || await loadConfig();
  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: name,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl || config.ai.baseUrl,
    },
  });
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
  const defaults = DEFAULT_AI_CONFIG.ai.profiles[provider === "ollama" || provider === "iola" ? "local" : provider];
  const profile = {
    ...defaults,
    provider,
    model: options.model || defaults.model,
  };

  if (options["base-url"]) {
    profile.baseUrl = options["base-url"];
  }

  if (provider === "iola") {
    profile.repo = options.repo || defaults.repo || IOLA_ROUTER_HF_REPO;
    profile.modelDir = options["model-dir"] || defaults.modelDir || IOLA_MODEL_DIR;
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

  if (provider !== "iola" && provider !== "ollama" && provider !== "openai" && provider !== "openrouter" && provider !== "codex") {
    throw new Error("Провайдер должен быть iola, ollama, openai, openrouter, codex или именем AI-профиля.");
  }

  const defaultModel = {
    iola: IOLA_LOCAL_MODEL,
    ollama: config.ai.provider === "ollama" ? config.ai.model : IOLA_LOCAL_OLLAMA_MODEL,
    openai: config.ai.provider === "openai" ? config.ai.model : "gpt-4.1-mini",
    openrouter: config.ai.provider === "openrouter" ? config.ai.model : "openai/gpt-4.1-mini",
    codex: config.ai.provider === "codex" ? config.ai.model : "gpt-5.5",
  }[provider];
  const profileName = provider === "ollama" || provider === "iola" ? "local" : provider;
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

async function slashModelMenu(args = []) {
  const [target, maybeModel] = args;
  const normalizedTarget = normalizeModelMenuTarget(target);

  if (normalizedTarget && maybeModel) {
    const directTarget = normalizedTarget === "api" ? await getDefaultApiProviderForModelSwitch() : normalizedTarget;
    await switchModelTarget(directTarget, maybeModel);
    return;
  }

  const selectedTarget = normalizedTarget || await chooseModelTarget();
  if (!selectedTarget) return;

  await openModelTargetMenu(selectedTarget);
}

function normalizeModelMenuTarget(value = "") {
  const normalized = String(value || "").trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return "";
  if (["local", "локальная", "локально", "iola", "иола", "ollama"].includes(normalized)) return "local";
  if (["api", "апи"].includes(normalized)) return "api";
  if (normalized === "openai") return "openai";
  if (normalized === "openrouter" || normalized === "router") return "openrouter";
  if (["codex", "кодекс"].includes(normalized)) return "codex";
  return "";
}

async function chooseModelTarget() {
  console.log("Выберите AI-подключение:");
  console.log("  1. Локальная модель IOLA");
  console.log("  2. API (OpenAI/OpenRouter)");
  console.log("  3. Codex CLI");
  console.log("  0. Отмена");

  const answer = await askText("Номер: ");
  return { 1: "local", 2: "api", 3: "codex" }[answer.trim()] || "";
}

async function openModelTargetMenu(target) {
  if (target === "local") {
    const model = await chooseAiModel("iola");
    if (model) await switchModelTarget("local", model);
    return;
  }

  if (target === "codex") {
    const model = await chooseAiModel("codex");
    if (model) await switchModelTarget("codex", model);
    return;
  }

  if (target === "openai" || target === "openrouter") {
    const model = await chooseAiModel(target);
    if (model) await switchModelTarget(target, model);
    return;
  }

  const provider = await chooseApiProvider();
  if (!provider) return;
  const model = await chooseAiModel(provider);
  if (model) await switchModelTarget(provider, model);
}

async function chooseApiProvider() {
  const config = await loadConfig();
  const apiProfiles = Object.entries(config.ai.profiles || {})
    .filter(([, profile]) => profile.provider === "openai" || profile.provider === "openrouter")
    .map(([name, profile]) => ({ id: profile.provider, label: `${name}: ${profile.provider} (${profile.model || "-"})` }));
  const choices = [
    ...apiProfiles,
    { id: "openai", label: "OpenAI API" },
    { id: "openrouter", label: "OpenRouter API" },
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);

  console.log("Выберите API-подключение:");
  choices.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}`));
  console.log("  0. Отмена");

  const answer = Number(await askText("Номер: "));
  return choices[answer - 1]?.id || "";
}

async function getDefaultApiProviderForModelSwitch() {
  const config = await loadConfig();
  const activeProfile = config.ai.profiles?.[getActiveProfileName(config)];
  if (activeProfile?.provider === "openai" || activeProfile?.provider === "openrouter") return activeProfile.provider;
  const apiProfile = Object.values(config.ai.profiles || {}).find((profile) => profile.provider === "openai" || profile.provider === "openrouter");
  return apiProfile?.provider || "openai";
}

async function chooseAiModel(provider) {
  let search = "";
  if (provider === "openrouter" || provider === "openai") {
    search = (await askText("Фильтр моделей (Enter - без фильтра): ")).trim();
  }

  let models;
  try {
    models = await listAiModels(provider);
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    return "";
  }

  let filtered = search
    ? models.filter((model) => model.id.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU")))
    : models;

  if (filtered.length === 0) {
    console.log("Модели не найдены.");
    return "";
  }

  const limit = 25;
  if (filtered.length > limit) {
    filtered = filtered.slice(0, limit);
    console.log(`Показаны первые ${limit} моделей. Для точного выбора запустите /model и задайте фильтр.`);
  }

  console.log("Выберите модель:");
  filtered.forEach((model, index) => console.log(`  ${index + 1}. ${model.id}${model.note ? ` - ${model.note}` : ""}`));
  console.log("  0. Отмена");

  const answer = Number(await askText("Номер: "));
  return filtered[answer - 1]?.id || "";
}

async function switchModelTarget(target, model) {
  const config = await loadConfig();
  const provider = target === "local" ? "iola" : target;
  if (provider === "iola") {
    await ensureIolaModelFresh({ quiet: false });
  }
  if (provider === "ollama") {
    const ready = await ensureOllamaModelAvailable(model, config);
    if (!ready) return;
  }
  const profileName = provider === "ollama" || provider === "iola" ? "local" : provider;
  const currentProfile = config.ai.profiles?.[profileName] || buildProfileFromOptions(provider, { model });
  const profile = {
    ...currentProfile,
    provider,
    model,
  };

  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: profileName,
      provider,
      model,
      baseUrl: profile.baseUrl || config.ai.baseUrl,
      profiles: {
        ...(config.ai.profiles || {}),
        [profileName]: profile,
      },
    },
  });

  console.log(`Активная модель: ${profileName} (${provider}, ${model})`);
}

async function ensureOllamaModelAvailable(model, config = null) {
  if (await isOllamaModelInstalled(model, config)) return true;

  const command = await resolveOllamaCommand();
  if (!command) {
    console.log("Ollama CLI не найден в PATH, хотя локальный API может отвечать.");
    console.log("Откройте новый PowerShell или запустите мастер: iola ai setup ollama");
    return false;
  }

  const shouldInstall = await confirm(`Локальная модель ${model} не скачана. Скачать через "ollama pull ${model}"? [Y/n] `);
  if (!shouldInstall) {
    console.log("Переключение на локальную модель отменено.");
    return false;
  }

  await runCommand(command, ["pull", model], { inherit: true });
  return true;
}

async function isOllamaModelInstalled(model, loadedConfig = null) {
  try {
    const config = loadedConfig || await loadConfig();
    const response = await fetch(`${config.ai.profiles?.local?.baseUrl || "http://127.0.0.1:11434"}/api/tags`);
    if (!response.ok) return false;
    const payload = await response.json();
    return (payload.models || []).some((entry) => entry.name === model);
  } catch {
    return false;
  }
}

async function askText(question) {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
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
      DROP TABLE IF EXISTS ask_history_fts;
      CREATE VIRTUAL TABLE IF NOT EXISTS ask_history_fts USING fts5(question, answer);
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
      DROP TABLE IF EXISTS session_messages_fts;
      CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(session_id UNINDEXED, role, content);
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
      CREATE TABLE IF NOT EXISTS memory_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_suggestions_status ON memory_suggestions(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_text TEXT NOT NULL,
        command TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled, last_run_at);
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        command TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        file TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tool_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args_json TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tool_traces_run_id ON tool_traces(run_id, id);
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS pending_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        before_text TEXT,
        after_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT
      );
      CREATE TABLE IF NOT EXISTS custom_records (
        dataset TEXT NOT NULL,
        record_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(dataset, record_key)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS custom_records_fts USING fts5(dataset, record_key, searchable_text);
      CREATE TABLE IF NOT EXISTS doc_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_index_fts USING fts5(file, title, content);
      CREATE TABLE IF NOT EXISTS plugins (
        name TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        command TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        provider TEXT,
        model TEXT,
        profile TEXT,
        input_chars INTEGER NOT NULL DEFAULT 0,
        output_chars INTEGER NOT NULL DEFAULT 0,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        session_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS budgets (
        scope TEXT PRIMARY KEY,
        amount_usd REAL NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    rebuildFtsIfEmpty(db);
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

function rebuildFtsIfEmpty(db) {
  try {
    const askCount = db.prepare("SELECT COUNT(*) AS count FROM ask_history_fts").get()?.count || 0;
    if (askCount === 0) {
      const rows = db.prepare("SELECT id, question, answer FROM ask_history ORDER BY id ASC").all();
      const insert = db.prepare("INSERT INTO ask_history_fts(rowid, question, answer) VALUES (?, ?, ?)");
      for (const row of rows) insert.run(row.id, row.question || "", row.answer || "");
    }
    const sessionCount = db.prepare("SELECT COUNT(*) AS count FROM session_messages_fts").get()?.count || 0;
    if (sessionCount === 0) {
      const rows = db.prepare("SELECT id, session_id, role, content FROM session_messages ORDER BY id ASC").all();
      const insert = db.prepare("INSERT INTO session_messages_fts(rowid, session_id, role, content) VALUES (?, ?, ?, ?)");
      for (const row of rows) insert.run(row.id, row.session_id, row.role || "", row.content || "");
    }
  } catch {
    // FTS rebuild is best-effort and must not block startup.
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
      const memorySuggestions = db.prepare("SELECT COUNT(*) AS count FROM memory_suggestions WHERE status = 'pending'").get();
      const cron = db.prepare("SELECT COUNT(*) AS count FROM cron_jobs").get();
      const tasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'").get();
      const artifacts = db.prepare("SELECT COUNT(*) AS count FROM artifacts").get();
      const docs = db.prepare("SELECT COUNT(*) AS count FROM doc_index").get();
      const custom = db.prepare("SELECT COUNT(*) AS count FROM custom_records").get();
      const usage = db.prepare("SELECT COUNT(*) AS count FROM usage_events").get();
      return {
        status: "ok",
        file: DB_FILE,
        schema: schema?.value || "-",
        history: history?.count ?? 0,
        sessions: sessions?.count ?? 0,
        local_records: local?.count ?? 0,
        cache: cache?.count ?? 0,
        memory: memory?.count ?? 0,
        memory_suggestions: memorySuggestions?.count ?? 0,
        cron_jobs: cron?.count ?? 0,
        open_tasks: tasks?.count ?? 0,
        artifacts: artifacts?.count ?? 0,
        indexed_docs: docs?.count ?? 0,
        custom_records: custom?.count ?? 0,
        usage_events: usage?.count ?? 0,
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

function getMetaValue(key) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value || null;
  } finally {
    db.close();
  }
}

function setMetaValue(key, value) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  } finally {
    db.close();
  }
}

function isFirstRunCompleted() {
  return getMetaValue("first_run_completed") === "1";
}

function markFirstRunCompleted() {
  setMetaValue("first_run_completed", "1");
}

function recordAskHistory({ question, answer, providerConfig, dataContext, error, sessionId }) {
  try {
    initDatabase();
    const db = openDatabase();
    try {
      const result = db.prepare(`
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
      db.prepare("INSERT INTO ask_history_fts(rowid, question, answer) VALUES (?, ?, ?)").run(Number(result.lastInsertRowid), question, answer || error || "");
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
    db.exec("DELETE FROM ask_history; DELETE FROM ask_history_fts;");
  } finally {
    db.close();
  }
}

function clearSessions() {
  initDatabase();
  const db = openDatabase();
  try {
    db.exec("DELETE FROM session_messages; DELETE FROM session_messages_fts; DELETE FROM sessions;");
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
    const userResult = db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, 'user', ?, ?)")
      .run(sessionId, question, JSON.stringify(dataContext));
    const assistantContent = error || answer || "";
    const assistantResult = db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, 'assistant', ?, ?)")
      .run(sessionId, assistantContent, JSON.stringify({ error: error || "" }));
    db.prepare("INSERT INTO session_messages_fts(rowid, session_id, role, content) VALUES (?, ?, ?, ?)")
      .run(Number(userResult.lastInsertRowid), sessionId, "user", question);
    db.prepare("INSERT INTO session_messages_fts(rowid, session_id, role, content) VALUES (?, ?, ?, ?)")
      .run(Number(assistantResult.lastInsertRowid), sessionId, "assistant", assistantContent);
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

function getSessionMessages(sessionId) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, role, content, created_at FROM session_messages WHERE session_id = ? ORDER BY id ASC").all(sessionId);
  } finally {
    db.close();
  }
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

function searchHistory(query, limit = 20) {
  initDatabase();
  const db = openDatabase();
  try {
    const ftsQuery = toFtsQuery(query);
    return db.prepare(`
      SELECT h.id, h.created_at, h.profile, h.provider, h.model, h.question, h.answer
      FROM ask_history_fts f
      JOIN ask_history h ON h.id = f.rowid
      WHERE ask_history_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
  } finally {
    db.close();
  }
}

function searchSessions(query, limit = 20) {
  initDatabase();
  const db = openDatabase();
  try {
    const ftsQuery = toFtsQuery(query);
    return db.prepare(`
      SELECT f.session_id, f.rowid AS message_id, f.role, f.content
      FROM session_messages_fts f
      WHERE session_messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
  } finally {
    db.close();
  }
}

function compactSessionInDb(sessionId) {
  const messages = getSessionAiHistory(sessionId);
  if (messages.length <= 8) {
    return { session_id: sessionId, before: messages.length, after: messages.length, status: "skip" };
  }
  const keep = messages.slice(-6);
  const summary = messages.slice(0, -6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(0, 4000);
  const compacted = [
    { role: "system", content: `Сжатая история предыдущей части сессии:\n${summary}` },
    ...keep,
  ];
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_messages_fts WHERE session_id = ?").run(sessionId);
    const insert = db.prepare("INSERT INTO session_messages(session_id, role, content, context_json) VALUES (?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO session_messages_fts(rowid, session_id, role, content) VALUES (?, ?, ?, ?)");
    for (const message of compacted) {
      const result = insert.run(sessionId, message.role, message.content, "{}");
      insertFts.run(Number(result.lastInsertRowid), sessionId, message.role, message.content);
    }
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
    return { session_id: sessionId, before: messages.length, after: compacted.length, status: "ok" };
  } finally {
    db.close();
  }
}

function toFtsQuery(query) {
  const terms = String(query).split(/\s+/).map((term) => term.replace(/["*]/g, "").trim()).filter(Boolean);
  return terms.length > 0 ? terms.map((term) => `"${term}"`).join(" OR ") : '""';
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

function findMemoryDuplicates() {
  const rows = listMemory(1000).reverse();
  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    const normalized = row.content.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      duplicates.push({ keeper_id: seen.get(normalized).id, duplicate_id: row.id, content: row.content });
    } else {
      seen.set(normalized, row);
    }
  }
  return duplicates;
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

function listCronJobs() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, schedule_text, command, enabled, COALESCE(last_run_at, '-') AS last_run_at, created_at FROM cron_jobs ORDER BY id DESC").all()
      .map((row) => ({ ...row, enabled: row.enabled ? "yes" : "no" }));
  } finally {
    db.close();
  }
}

function addCronJob(scheduleText, command) {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO cron_jobs(schedule_text, command) VALUES (?, ?)").run(scheduleText, command);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function deleteCronJob(id) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

function dueCronJobs() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY id ASC").all()
      .filter((job) => isCronDue(job));
  } finally {
    db.close();
  }
}

function isCronDue(job) {
  const normalized = job.schedule_text.toLocaleLowerCase("ru-RU");
  const lastRun = job.last_run_at ? new Date(`${job.last_run_at}Z`) : null;
  const now = new Date();
  if (lastRun && now.getTime() - lastRun.getTime() < 60_000) return false;
  if (normalized.includes("каждый час") || normalized.includes("hourly")) {
    return !lastRun || now.getTime() - lastRun.getTime() >= 60 * 60 * 1000;
  }
  const everyMinutes = normalized.match(/кажд(?:ые|ую)\s+(\d+)\s*(?:мин|минут)/u) || normalized.match(/every\s+(\d+)\s*(?:m|min|minutes)/u);
  if (everyMinutes) {
    return !lastRun || now.getTime() - lastRun.getTime() >= Number(everyMinutes[1]) * 60 * 1000;
  }
  if (normalized.includes("каждый день") || normalized.includes("daily")) {
    return !lastRun || now.toISOString().slice(0, 10) !== lastRun.toISOString().slice(0, 10);
  }
  if (normalized.includes("каждую неделю") || normalized.includes("weekly")) {
    return !lastRun || now.getTime() - lastRun.getTime() >= 7 * 24 * 60 * 60 * 1000;
  }
  return !lastRun;
}

async function runCronJob(id) {
  initDatabase();
  const db = openDatabase();
  let job;
  try {
    job = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id);
  } finally {
    db.close();
  }
  if (!job) throw new Error(`Cron-задача не найдена: ${id}`);
  console.log(`> iola ${job.command}`);
  await main(splitCommandLine(job.command));
  const updateDb = openDatabase();
  try {
    updateDb.prepare("UPDATE cron_jobs SET last_run_at = datetime('now') WHERE id = ?").run(id);
  } finally {
    updateDb.close();
  }
}

function buildMemoryText(limit = 20) {
  const rows = listMemory(limit).reverse();
  return rows.map((row) => `- ${row.content}`).join("\n");
}

function addMemorySuggestion(content, reason, scope = "user") {
  initDatabase();
  const db = openDatabase();
  try {
    const existing = db.prepare("SELECT id FROM memory_suggestions WHERE status = 'pending' AND content = ?").get(content);
    if (existing) return Number(existing.id);
    const result = db.prepare("INSERT INTO memory_suggestions(scope, content, reason) VALUES (?, ?, ?)").run(scope, content, reason || "");
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function listMemorySuggestions(status = "pending") {
  initDatabase();
  const db = openDatabase();
  try {
    if (status === "all") {
      return db.prepare("SELECT id, scope, content, reason, status, created_at FROM memory_suggestions ORDER BY id DESC LIMIT 100").all();
    }
    return db.prepare("SELECT id, scope, content, reason, status, created_at FROM memory_suggestions WHERE status = ? ORDER BY id DESC LIMIT 100").all(status);
  } finally {
    db.close();
  }
}

function approveMemorySuggestion(id) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM memory_suggestions WHERE id = ?").get(id);
    if (!row) throw new Error(`Предложение памяти не найдено: ${id}`);
    const result = db.prepare("INSERT INTO memory(scope, content) VALUES (?, ?)").run(row.scope || "user", row.content);
    db.prepare("UPDATE memory_suggestions SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(id);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function resolveMemorySuggestion(id, status) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("UPDATE memory_suggestions SET status = ?, resolved_at = datetime('now') WHERE id = ?").run(status, id);
  } finally {
    db.close();
  }
}

async function maybeSuggestMemory(question, answer, providerConfig) {
  const config = await loadConfig();
  if (config.memory?.suggestions === false) return;
  const normalized = `${question}\n${answer}`.toLocaleLowerCase("ru-RU");
  const suggestions = [];
  if (normalized.includes("кратко") || normalized.includes("коротко")) {
    suggestions.push(["Пользователь предпочитает краткие ответы.", "В запросе или ответе упоминался краткий формат."]);
  }
  if (normalized.includes("word") || normalized.includes("docx")) {
    suggestions.push(["Пользователь часто работает с документами Word/DOCX.", "В сессии упоминался формат Word/DOCX."]);
  }
  if (providerConfig?.name) {
    suggestions.push([`Последний активный AI-профиль: ${providerConfig.name}.`, "Зафиксирован используемый профиль AI."]);
  }
  for (const [content, reason] of suggestions.slice(0, 2)) {
    addMemorySuggestion(content, reason);
  }
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
  console.log("1. Локальная модель IOLA");
  console.log("2. OpenAI API");
  console.log("3. OpenRouter API");
  console.log("4. Codex/MCP");
  console.log("5. Ollama");

  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("Введите номер [1]: ")).trim() || "1";
    return {
      1: "iola",
      2: "openai",
      3: "openrouter",
      4: "codex",
      5: "ollama",
    }[answer] || "iola";
  } finally {
    rl.close();
  }
}

async function setupOllama(args) {
  const options = parseOptions(args);
  const diagnostics = await getLocalDiagnostics();
  const recommendation = recommendOllamaModel(diagnostics);
  const model = options.model || recommendation.model;
  const ollamaCommand = await resolveOllamaCommand();

  printDiagnostics(diagnostics, { ...recommendation, model });

  if (!ollamaCommand) {
    console.log("");
    console.log("Ollama не найден или команда пока недоступна в текущем терминале.");
    console.log("Если Ollama только что установлена, откройте новый PowerShell или повторите после обновления PATH:");
    console.log("  iola master");
    console.log("");
    console.log("Windows:");
    console.log("  $env:Path += ';' + \"$env:LOCALAPPDATA\\Programs\\Ollama\"");
    console.log("macOS:");
    console.log("  перезапустите терминал после brew install --cask ollama");
    console.log("Linux:");
    console.log("  проверьте /usr/local/bin/ollama");
    return;
  }

  const shouldInstall = options.yes || (await confirm(`Установить модель ${model} через "ollama pull ${model}"? [Y/n] `));

  if (shouldInstall) {
    await runCommand(ollamaCommand, ["pull", model], { inherit: true });
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

async function setupIolaLocal(args) {
  const options = parseOptions(args);
  const repo = options.repo || IOLA_ROUTER_HF_REPO;
  const modelDir = options["model-dir"] || IOLA_MODEL_DIR;
  const profileName = options.name || "local";
  const optional = Boolean(options.optional);

  if (optional && process.env.CI === "true") {
    return;
  }

  try {
    await ensureIolaModelFresh({ repo, modelDir, force: true, quiet: Boolean(options.quiet) });
  } catch (error) {
    if (!optional) throw error;
    console.warn(`IOLA local model не установлена: ${error instanceof Error ? error.message : String(error)}`);
  }

  const config = await loadConfig();
  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: profileName,
      provider: "iola",
      model: IOLA_LOCAL_MODEL,
      profiles: {
        ...(config.ai.profiles || {}),
        [profileName]: {
          provider: "iola",
          model: IOLA_LOCAL_MODEL,
          repo,
          modelDir,
        },
      },
    },
  });

  if (options.quiet) return;
  console.log("");
  console.log("IOLA local mode готов:");
  console.log(`  runtime: Python transformers/peft`);
  console.log(`  model: ${IOLA_LOCAL_MODEL}`);
  console.log(`  Hugging Face: ${repo}`);
  console.log(`  cache: ${modelDir}`);
  console.log("  точные данные: https://apiiola.yasg.ru/api/v1/resolve-entity-field");
}

async function aiAsk(args, context = {}) {
  const options = parseOptions(args);
  const question = options._.join(" ").trim();

  if (!question) {
    throw new Error('Текст вопроса обязателен. Пример: iola ai ask "Какие школы есть на улице Петрова?"');
  }

  const config = await loadConfig();
  const providerConfig = await resolveUsableAiProfile(config, options);
  if (providerConfig.provider === "codex") await assertPermission("codex");
  if (providerConfig.provider !== "ollama" && providerConfig.provider !== "iola") await assertPermission("externalAi");
  if (options["stream-json"]) options.events = true;
  if (providerConfig.provider === "iola" || (options.tools && providerConfig.provider === "ollama")) {
    return localToolAsk(question, providerConfig, options);
  }
  applyRuntimeConfig(providerConfig, options.config);
  const useDataContext = !options.bare && shouldUseDataContext(question, options);
  const dataContext = useDataContext ? await buildDataContext(question) : emptyDataContext(question);
  emitEvent(options, "context_loaded", { schools: dataContext.schools.length, kindergartens: dataContext.kindergartens.length });
  const historyEnabled = !options.bare && !options["no-history"] && isFeatureEnabled("sqlite-history");
  const sessionId = historyEnabled && isFeatureEnabled("sessions") ? ensureSessionForAsk(options, providerConfig, question) : null;
  const history = context.history || (sessionId ? getSessionAiHistory(sessionId) : []);
  const directAnswer = buildDirectDataAnswer(question, dataContext);
  if (directAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: directAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, directAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: directAnswer.length, sessionId, direct: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, directAnswer, "utf8");
    }
    if (!options.quiet) console.log(directAnswer);
    return directAnswer;
  }
  const messages = await buildAiMessages(question, dataContext, history, options, config);
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
  recordUsage({
    providerConfig,
    question,
    answer,
    sessionId,
    profile: providerConfig.name,
  });
  await maybeSuggestMemory(question, answer, providerConfig);

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

function buildDirectDataAnswer(question, dataContext) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const requestedFields = detectDirectDataFields(normalized);
  if (requestedFields.length === 0) return "";
  const rows = [
    ...dataContext.schools.map((item) => ({ layer: "schools", layerName: "школы", ...item })),
    ...dataContext.kindergartens.map((item) => ({ layer: "kindergartens", layerName: "детские сады", ...item })),
  ];
  const item = pickDirectDataItem(question, dataContext, rows);
  if (!item) return "";
  const lines = requestedFields
    .map((field) => formatDirectDataField(field, item))
    .filter(Boolean);
  if (lines.length === 0) return "";
  const name = getDirectDataItemName(item);
  return [
    ...lines,
    `Источник: слой ${item.layer}, ${name}, ИНН ${item.inn || "-"}.`,
  ].join("\n");
}

function detectDirectDataFields(normalizedQuestion) {
  const fields = [];
  if (/(директор|руководител|заведующ|кто возглавляет)/iu.test(normalizedQuestion)) fields.push("head");
  if (/(сайт|website|url|ссылка)/iu.test(normalizedQuestion)) fields.push("website");
  if (/(телефон|номер телефона|позвонить)/iu.test(normalizedQuestion)) fields.push("phone");
  if (/(почт|email|e-mail|имейл|электронн)/iu.test(normalizedQuestion)) fields.push("email");
  if (/(адрес|где находится|расположен)/iu.test(normalizedQuestion)) fields.push("address");
  if (/(инн)/iu.test(normalizedQuestion)) fields.push("inn");
  if (/(лиценз)/iu.test(normalizedQuestion)) fields.push("license");
  return [...new Set(fields)];
}

function pickDirectDataItem(question, dataContext, rows) {
  const patterns = dataContext.query?.patterns || extractStructuredPatterns(question);
  const targetLayers = patterns.targetLayers || [];
  const scopedRows = targetLayers.length > 0 ? rows.filter((item) => targetLayers.includes(item.layer)) : rows;

  for (const inn of patterns.inns || []) {
    const match = scopedRows.find((item) => String(item.inn || "") === inn);
    if (match) return match;
  }

  for (const number of patterns.numbers || []) {
    const exact = scopedRows.find((item) => itemNameHasNumber(item, number));
    if (exact) return exact;
  }

  const terms = extractSearchTerms(question).filter((term) => !/^\d+$/.test(term));
  if (terms.length > 0) {
    const personMatches = scopedRows.filter((item) => {
      const head = String(item.head || item.fns_head_name || "").toLocaleLowerCase("ru-RU");
      return terms.every((term) => head.includes(term.toLocaleLowerCase("ru-RU")));
    });
    if (personMatches.length === 1) return personMatches[0];
  }

  const confidentRows = scopedRows.filter((item) => {
    const confidence = Number(item._match?.confidence ?? item.match?.confidence ?? 0);
    const score = Number(item._match?.score ?? item.match?.score ?? 0);
    return confidence >= 0.8 || score >= 30;
  });
  if (confidentRows.length === 1) return confidentRows[0];

  return null;
}

function itemNameHasNumber(item, number) {
  const name = String(item.name || item.title || item.fns_full_name || item.fns_short_name || "").toLocaleLowerCase("ru-RU");
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:№\\s*${escaped}(?!\\d)|\\b(?:школа|сош|лицей|гимназия|сад|детский сад)\\s*№?\\s*${escaped}\\b)`, "iu").test(name);
}

function formatDirectDataField(field, item) {
  const name = getDirectDataItemName(item);
  if (field === "head") {
    const head = item.head || item.fns_head_name;
    if (!head) return "";
    const position = capitalizeFirst(item.fns_head_position || (item.layer === "kindergartens" ? "заведующий" : "директор"));
    return `${position}: ${head} (${name}).`;
  }
  if (field === "website") return item.website ? `Сайт: ${item.website}` : `Сайт для ${name} в открытых данных не указан.`;
  if (field === "phone") return item.phone ? `Телефон: ${item.phone}` : `Телефон для ${name} в открытых данных не указан.`;
  if (field === "email") return item.email ? `Email: ${item.email}` : `Email для ${name} в открытых данных не указан.`;
  if (field === "address") return item.address || item.legal_address ? `Адрес: ${item.address || item.legal_address}` : `Адрес для ${name} в открытых данных не указан.`;
  if (field === "inn") return item.inn ? `ИНН: ${item.inn}` : `ИНН для ${name} в открытых данных не указан.`;
  if (field === "license") {
    const parts = [
      item.license_number ? `номер ${item.license_number}` : "",
      item.license_status ? `статус: ${item.license_status}` : "",
      item.license_date ? `дата: ${item.license_date}` : "",
    ].filter(Boolean);
    return parts.length > 0 ? `Лицензия: ${parts.join(", ")}.` : `Лицензия для ${name} в открытых данных не указана.`;
  }
  return "";
}

function getDirectDataItemName(item) {
  return item.name || item.title || item.fns_short_name || item.fns_full_name || "организация";
}

function capitalizeFirst(value) {
  const text = String(value || "");
  return text ? `${text[0].toLocaleUpperCase("ru-RU")}${text.slice(1)}` : text;
}

async function resolveUsableAiProfile(config, options = {}) {
  const explicit = Boolean(options.profile || options.provider);
  const providerConfig = resolveAiProfile(config, options);
  if (explicit) return providerConfig;

  const readiness = await getAiReadiness();
  if (isProviderReady(providerConfig.provider, readiness)) return providerConfig;

  const fallback = getFallbackAiProfile(readiness);
  if (!fallback) return providerConfig;

  if (!options.quiet) {
    console.log(`Активный AI-профиль ${providerConfig.name} (${providerConfig.provider}) недоступен. Использую ${fallback.name} (${fallback.provider}).`);
  }

  return {
    name: fallback.name,
    ...fallback,
    model: fallback.model || providerConfig.model,
    baseUrl: fallback.baseUrl || providerConfig.baseUrl,
  };
}

function isProviderReady(provider, readiness) {
  return Boolean(readiness?.[provider]);
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
    repo: options.repo || activeProfile.repo,
    modelDir: options["model-dir"] || activeProfile.modelDir,
    temperature: options.temperature || activeProfile.temperature,
  };
}

async function localToolAsk(question, providerConfig, options) {
  if (options["stream-json"]) options.events = true;
  const guarded = guardNonPublicQuestion(question);
  if (guarded) {
    if (!options.quiet) console.log(guarded);
    return guarded;
  }
  await ensureLocalData();
  const plan = await buildLocalToolPlan(question, providerConfig, options);
  if (plan.directAnswer) {
    if (!options.quiet) console.log(plan.directAnswer);
    return plan.directAnswer;
  }
  const validated = validateToolPlan(plan, options);
  if (options.plan) {
    printToolPlan(validated);
    const shouldRun = await confirm("Выполнить план? [y/N] ");
    if (!shouldRun) {
      saveArtifact("plan", question.slice(0, 80), "", { plan: validated });
      return "План построен, выполнение отменено.";
    }
  }
  const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await executeToolPlan(validated, { ...options, runId });
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
  recordUsage({ providerConfig, question, answer, sessionId: null, profile: providerConfig.name });

  emitEvent(options, "tool_plan", { plan: validated, runId });
  saveArtifact("tool-result", question.slice(0, 80), "", { runId, plan: validated, outputs: result.outputs });
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

function guardNonPublicQuestion(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  if (/(зарплат|получа[ею]т|доход|домашн|паспорт|снилс|личн|персональн)/iu.test(normalized)) {
    return "Это поле не входит в открытые публичные данные.";
  }
  return "";
}

function printToolPlan(plan) {
  console.log("План выполнения:");
  plan.steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.tool} ${JSON.stringify(step.args || {})}`);
  });
}

async function buildLocalToolPlan(question, providerConfig, options) {
  const mode = options.reasoning || "verify";

  if (providerConfig.provider === "iola") {
    await ensureIolaModelFresh({
      repo: providerConfig.repo || IOLA_ROUTER_HF_REPO,
      modelDir: providerConfig.modelDir || IOLA_MODEL_DIR,
      quiet: true,
    });
    const raw = await callIolaLocal(providerConfig, [{ role: "user", content: question }]);
    return normalizeIolaRouterPlan(raw, question, options);
  }

  const prompt = [
    "Ты планировщик CLI iola. Верни только JSON.",
    `Доступные tools: ${availableToolNames(options).join(", ")}.`,
    "Схема: {\"steps\":[{\"tool\":\"search_data\",\"args\":{\"dataset\":\"schools|kindergartens|all\",\"query\":\"text\",\"limit\":10}}]}",
    "Минимальные tools: search_data {dataset,query,limit}, get_card {query}, export_report {name,format,output}, file_read {path}, browser_open {url}.",
    "MCP tools доступны как mcp:SERVER:TOOL, например mcp:iola-local:search.",
    "Для выгрузки CSV добавь export_report с format=csv и output, если пользователь назвал файл.",
    `Вопрос: ${question}`,
  ].join("\n");

  try {
    const raw = await callOllama(providerConfig, [{ role: "user", content: prompt }]);
    const parsed = parseJsonObject(raw);
    if (mode === "vote") {
      return chooseBestPlan([parsed, inferToolPlan(question, options)], options);
    }
    return parsed;
  } catch {
    return inferToolPlan(question, options);
  }
}

function normalizeIolaRouterPlan(raw, question, options = {}) {
  const payload = typeof raw === "string" ? parseJsonObject(raw) : raw;
  if (payload.action === "tool_call") {
    const tool = payload.tool === "get_entity_field" ? "resolve_entity_field" : payload.tool;
    return { steps: [{ tool, args: payload.args || {} }] };
  }
  if (payload.action === "direct_answer") {
    return { directAnswer: payload.answer || "" };
  }
  if (payload.action === "clarify") {
    return { directAnswer: payload.question || "Уточните запрос." };
  }
  if (payload.action === "refuse") {
    return { directAnswer: payload.reason === "field_not_public" ? "Это поле не входит в открытые публичные данные." : "Не могу выполнить этот запрос." };
  }
  if (options.reasoning === "vote") {
    return inferToolPlan(question, options);
  }
  throw new Error(`IOLA router вернул неподдерживаемое действие: ${payload.action || "unknown"}`);
}

function parseJsonObject(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON-план не найден.");
  return JSON.parse(match[0]);
}

function inferToolPlan(question, options = {}) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const dataset = normalized.includes("сад") ? "kindergartens" : normalized.includes("школ") || normalized.includes("лицей") ? "schools" : "all";
  const steps = [];
  if (normalized.includes("без телефона")) {
    steps.push({ tool: "export_report", args: { name: "missing-phones" } });
  } else {
    const query = normalized.match(/петрова|школ[а-яё ]*\d+|сад[а-яё ]*\d+|лицей[а-яё ]*\d+/iu)?.[0] || question;
    steps.push({ tool: "search_data", args: { dataset, query, limit: 20 } });
  }
  if (normalized.includes("csv") || normalized.includes("выгруз")) {
    steps.push({ tool: "export_report", args: { format: "csv", output: normalized.match(/([a-z0-9_-]+\.csv)/i)?.[1] || "iola-export.csv" } });
  }
  if (options.files || normalized.includes("файл") || normalized.includes("папк") || normalized.includes("readme")) {
    if (normalized.includes("найди") || normalized.includes("поиск")) {
      steps.unshift({ tool: "mcp:iola-local:index.search", args: { query: question, limit: 20 } });
    } else {
      steps.unshift({ tool: "file_read", args: { path: "." } });
    }
  }
  return { steps };
}

function chooseBestPlan(plans, options = {}) {
  return plans.find((plan) => {
    try {
      validateToolPlan(plan, options);
      return true;
    } catch {
      return false;
    }
  }) || plans.at(-1);
}

function validateToolPlan(plan, options = {}) {
  const allowed = new Set(availableToolNames(options));
  if (!plan || !Array.isArray(plan.steps)) throw new Error("Некорректный tool-plan.");
  for (const step of plan.steps) {
    if (!allowed.has(step.tool) && !String(step.tool || "").startsWith("mcp:")) throw new Error(`Недопустимый tool: ${step.tool}`);
  }
  return plan;
}

async function searchPublicEntities(args = {}) {
  const payload = await postJson(`${await getApiBaseUrl()}/search-entities`, {
    layer: normalizeEntityLayer(args.layer),
    query: args.query || args.entity_name || args.name || "",
    limit: Number(args.limit || 10),
    filters: args.filters || undefined,
  });
  return normalizeItems(payload).map((item) => ({
    ...(item.entity || item),
    score: item.score,
    layer: payload.layer || normalizeEntityLayer(args.layer),
  }));
}

async function resolvePublicEntityField(args = {}) {
  const payload = await postJson(`${await getApiBaseUrl()}/resolve-entity-field`, {
    layer: normalizeEntityLayer(args.layer),
    entity_number: args.entity_number ?? args.number,
    entity_name: args.entity_name || args.name,
    inn: args.inn,
    field: normalizeEntityField(args.field),
    must_refute_user_value: args.must_refute_user_value,
  });
  return payload;
}

function normalizeEntityLayer(layer) {
  const value = String(layer || "").toLocaleLowerCase("ru-RU");
  if (value === "school" || value === "schools" || value.includes("школ")) return "schools";
  if (value === "kindergarten" || value === "kindergartens" || value.includes("сад")) return "kindergartens";
  return value || "schools";
}

function normalizeEntityField(field) {
  const value = String(field || "").toLocaleLowerCase("ru-RU");
  if (value === "director" || value === "head" || value.includes("директор") || value.includes("руковод")) return "head";
  if (value === "site" || value === "url" || value === "website" || value.includes("сайт")) return "website";
  if (value === "mail" || value === "email" || value.includes("почт")) return "email";
  if (value === "phone" || value.includes("тел")) return "phone";
  if (value === "address" || value.includes("адрес")) return "address";
  if (value === "license") return "license_status";
  return value || "name";
}

function availableToolNames(options = {}) {
  const names = new Set(LOCAL_TOOLS);
  for (const tool of getLocalMcpToolNames()) names.add(tool);
  return [...names];
}

async function executeToolPlan(plan, options = {}) {
  let current = [];
  const outputs = [];
  for (const step of plan.steps) {
    let status = "ok";
    let summary = "";
    await assertPermission(step.tool);
    await runHooks("PreToolUse", { tool: step.tool, args: step.args || {} });
    await runHooks("BeforeTool", { tool: step.tool, args: step.args || {} });
    try {
      if (step.tool === "search_data" || step.tool === "search_local") {
        current = searchLocalRecords(step.args?.query || "", { dataset: step.args?.dataset || "all", limit: step.args?.limit || 20, fts: true });
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "search_entities") {
        current = await searchPublicEntities(step.args || {});
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "resolve_entity_field") {
        const resolved = await resolvePublicEntityField(step.args || {});
        current = Array.isArray(resolved) ? resolved : [resolved];
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "get_card") {
        const card = findCard(step.args?.query || "");
        current = card ? [card] : [];
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "export_report" || step.tool === "run_report") {
        current = runQuality(step.args?.name || "all");
        outputs.push({ tool: step.tool, rows: current.length });
        if (step.args?.output || step.args?.format) {
          await assertPermission("writeFiles");
          const output = step.args?.output || `${step.args?.name || "report"}.${step.args?.format || "csv"}`;
          const text = step.args?.format === "json" ? JSON.stringify(current, null, 2) : toCsv(current);
          await writeFile(output, text, "utf8");
          saveArtifact("export", output, output, { rows: current.length });
          outputs.push({ tool: step.tool, output, rows: current.length });
        }
      } else if (step.tool === "save_view") {
        saveView(step.args?.name, step.args?.dataset || "all", step.args?.args || []);
        outputs.push({ tool: step.tool, saved: step.args?.name });
      } else if (step.tool === "export_data") {
        await assertPermission("writeFiles");
        await runHooks("BeforeExport", { output: step.args?.output || "iola-export.csv", format: step.args?.format || "csv", rows: current.length });
        const text = step.args?.format === "json" ? JSON.stringify(current, null, 2) : toCsv(current);
        await writeFile(step.args?.output || "iola-export.csv", text, "utf8");
        saveArtifact("export", step.args?.output || "iola-export.csv", step.args?.output || "iola-export.csv", { rows: current.length });
        outputs.push({ tool: step.tool, output: step.args?.output || "iola-export.csv", rows: current.length });
      } else if (step.tool === "file_read") {
        const text = await filesRead(step.args?.path || step.args?.file || ".", step.args || {});
        current = [{ path: step.args?.path || step.args?.file || ".", text }];
        outputs.push({ tool: step.tool, bytes: text.length });
      } else if (step.tool === "browser_open") {
        const text = await runBrowserAutomation("text", { url: step.args?.url, waitMs: Number(step.args?.waitMs || 0), timeout: Number(step.args?.timeout || 30000), viewport: step.args?.viewport || "1366x768" });
        current = [{ url: step.args?.url, text }];
        outputs.push({ tool: step.tool, rows: 1 });
      } else if (String(step.tool || "").startsWith("mcp:")) {
        const result = await callConfiguredMcpTool(step.tool, step.args || {});
        current = Array.isArray(result) ? result : [result];
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "files_tree") {
        current = await filesTree(step.args?.path || ".", step.args || {});
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "files_read") {
        const text = await filesRead(step.args?.path || step.args?.file || ".", step.args || {});
        current = [{ path: step.args?.path || step.args?.file || ".", text }];
        outputs.push({ tool: step.tool, bytes: text.length });
      } else if (step.tool === "files_search") {
        current = await filesSearch(step.args?.query || "", { path: step.args?.path || ".", limit: step.args?.limit || 50 });
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (step.tool === "files_write") {
        await filesWrite(step.args?.path || step.args?.file, step.args?.text || "", { append: Boolean(step.args?.append) });
        current = [{ path: step.args?.path || step.args?.file, status: "written" }];
        outputs.push({ tool: step.tool, output: step.args?.path || step.args?.file, rows: 1 });
      } else if (step.tool === "files_patch") {
        const result = await filesPatch(step.args?.path || step.args?.file, step.args?.search || "", step.args?.replace || "");
        current = [result];
        outputs.push({ tool: step.tool, output: result.path, replacements: result.replacements });
      }
      summary = `rows=${current.length}`;
    } catch (error) {
      status = "error";
      summary = error instanceof Error ? error.message : String(error);
      recordToolTrace(options.runId || "manual", step.tool, step.args || {}, status, summary);
      await runHooks("OnError", { tool: step.tool, args: step.args || {}, error: summary });
      throw error;
    }
    recordToolTrace(options.runId || "manual", step.tool, step.args || {}, status, summary);
    await runHooks("AfterTool", { tool: step.tool, rows: current.length });
    await runHooks("PostToolUse", { tool: step.tool, rows: current.length });
  }
  return { rows: current, outputs };
}

function getLocalMcpToolNames() {
  return mcpTools().map((tool) => `mcp:iola-local:${tool.name}`);
}

async function callConfiguredMcpTool(toolId, args = {}) {
  const [, serverName, ...toolParts] = String(toolId).split(":");
  const toolName = toolParts.join(":");
  if (!serverName || !toolName) throw new Error(`Некорректный MCP tool id: ${toolId}`);
  const server = getConfiguredMcpServers()[serverName];
  if (!server) throw new Error(`MCP server не настроен: ${serverName}`);
  return callStdioMcpTool(server, toolName, args);
}

function getConfiguredMcpServers() {
  const userConfig = readConfigLayerSync(CONFIG_FILE);
  const configured = userConfig?.mcp?.servers && typeof userConfig.mcp.servers === "object" ? userConfig.mcp.servers : {};
  return {
    "iola-local": {
      command: process.execPath,
      args: [path.resolve(__dirname, "..", "bin", "iola.js"), "mcp", "serve", "--stdio"],
    },
    ...configured,
  };
}

async function callStdioMcpTool(server, toolName, args = {}) {
  const child = spawn(server.command, server.args || [], {
    cwd: server.cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } };
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify(request)}\n`);
  child.stdin.end();
  await waitForProcess(child, 15000);
  const responses = stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const response = responses.find((item) => item.id === 2) || responses.at(-1);
  if (!response) throw new Error(`MCP server ${server.command} не вернул ответ. ${stderr}`.trim());
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error));
  const content = response.result?.content || [];
  const text = content.map((item) => item.text || "").join("\n").trim();
  try {
    return JSON.parse(text);
  } catch {
    return text || response.result;
  }
}

function waitForProcess(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP call timeout"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function formatToolResult(result, options) {
  if (options.schema === "json") return JSON.stringify(result, null, 2);
  const exported = result.outputs.find((item) => item.output);
  if (exported) return `Готово. Файл сохранен: ${exported.output}. Записей: ${exported.rows}`;
  if (!result.rows.length) return "Данных не найдено.";
  return result.rows.slice(0, 10).map((row) => {
    if (row.ok && row.entity && row.field) {
      const name = row.entity.name || row.entity.inn || "организация";
      return `${name}: ${row.field} = ${row.value ?? "не указано"}`;
    }
    return `${row.name || row.check || row.inn || "строка"}: ${row.address || row.phone || row.email || row.website || row.count || ""}`;
  }).join("\n");
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
    const [maybeFilter, ...rest] = String(command).split(":");
    const commandText = payload.tool && rest.length > 0 && ALL_TOOL_ALIASES.includes(maybeFilter.trim())
      ? (maybeFilter.trim() === payload.tool ? rest.join(":").trim() : "")
      : command;
    if (!commandText) continue;
    const parts = splitCommandLine(commandText);
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
  const permissions = applyToolsetPermissions(config.permissions || DEFAULT_AI_CONFIG.permissions, config.toolsets?.enabled || []);
  if (ALL_TOOL_ALIASES.includes(name)) {
    if (permissions.localTools?.[name] === false) {
      throw new Error(`Tool запрещен политикой permissions: ${name}`);
    }
    return;
  }
  if (permissions[name] === false) {
    throw new Error(`Действие запрещено политикой permissions: ${name}`);
  }
}

function applyToolsetPermissions(basePermissions, enabledToolsets) {
  const next = {
    ...basePermissions,
    localTools: { ...(basePermissions.localTools || {}) },
  };
  for (const name of enabledToolsets || []) {
    const toolset = TOOLSETS[name];
    if (!toolset) continue;
    Object.assign(next, toolset.permissions || {});
    next.localTools = {
      ...(next.localTools || {}),
      ...(toolset.permissions?.localTools || {}),
    };
  }
  return next;
}

function emitEvent(options, type, data) {
  if (!options.events) {
    return;
  }
  printJson({ type, at: new Date().toISOString(), ...data });
}

async function buildDataContext(question) {
  await assertPermission("externalApi");
  const queryTerms = extractSearchTerms(question);
  const patterns = extractStructuredPatterns(question);
  try {
    const context = await callPublicMcpTool("layer_answer_context", { question, limit: 8 });
    const layerMap = Object.fromEntries((context.results || []).map((result) => [result.layer?.id || result.layer, result.items || []]));
    await enrichLayerMapWithExactMatches(layerMap, question, queryTerms, patterns);
    return {
      source: "remote-mcp",
      contract_version: context.contract_version,
      layers: context.layers || [],
      facts: context.facts || [],
      sources: context.sources || [],
      answer_guidance: context.answer_guidance || "",
      query: {
        text: question,
        terms: queryTerms,
        patterns,
      },
      schools: layerMap.schools || [],
      kindergartens: layerMap.kindergartens || [],
    };
  } catch (error) {
    const layers = await callMcpTool("layer.list", { category: "Образование" });
    const targetLayerIds = resolveTargetLayerIds(patterns);
    const layerResults = await Promise.all(targetLayerIds.map((layer) =>
      callMcpTool("layer.query", { layer, query: question, terms: queryTerms, patterns, limit: 8 })));
    const layerMap = Object.fromEntries(layerResults.map((result) => [result.layer, result.items || []]));

    return {
      source: "local-fallback",
      fallback_error: error instanceof Error ? error.message : String(error),
      layers,
      query: {
        text: question,
        terms: queryTerms,
        patterns,
      },
      schools: layerMap.schools || [],
      kindergartens: layerMap.kindergartens || [],
    };
  }
}

async function enrichLayerMapWithExactMatches(layerMap, question, queryTerms, patterns) {
  if (!patterns.numbers?.length) return;
  const targetLayerIds = resolveTargetLayerIds(patterns);
  await Promise.all(targetLayerIds.map(async (layer) => {
    try {
      const result = await queryLayer(layer, { query: question, terms: queryTerms, patterns, limit: 8 });
      const existing = layerMap[layer] || [];
      const existingKeys = new Set(existing.map((item) => item.inn || item.name || item.fns_short_name).filter(Boolean));
      const exact = (result.items || []).filter((item) =>
        patterns.numbers.some((number) => itemNameHasNumber(item, number)));
      layerMap[layer] = [
        ...exact.filter((item) => {
          const key = item.inn || item.name || item.fns_short_name;
          if (!key || existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        }),
        ...existing,
      ];
    } catch {
      // Remote MCP remains the primary source; exact local/API enrichment is best effort.
    }
  }));
}

function resolveTargetLayerIds(patterns = {}) {
  const knownLayers = Object.keys(DATASETS);
  if (patterns.targetLayers?.length) return patterns.targetLayers.filter((layer) => DATASETS[layer]);
  return knownLayers;
}

async function fetchAllApiItems(endpoint, limit = 500, maxItems = 5000) {
  const all = [];
  for (let offset = 0; offset < maxItems; offset += limit) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const payload = await fetchJson(`${endpoint}${separator}limit=${limit}&offset=${offset}`);
    const items = normalizeItems(payload);
    all.push(...items);
    if (items.length < limit) break;
  }
  return all;
}

async function queryLayer(layer, args = {}) {
  const meta = DATASETS[layer];
  if (!meta) throw new Error(`Неизвестный слой: ${layer}`);
  const endpoint = `${await getApiBaseUrl()}/${meta.endpoint}`;
  const items = await fetchAllApiItems(endpoint);
  const terms = args.terms || extractSearchTerms(args.query || "");
  const patterns = args.patterns || extractStructuredPatterns(args.query || "");
  const limit = Number(args.limit || 20);
  return {
    layer,
    schema: layerSchema(layer),
    items: findRelevantItems(normalizeItems(items), terms, patterns, layer).slice(0, limit).map(selectPublicSummary),
  };
}

function layerSchema(layer) {
  const meta = DATASETS[layer];
  if (!meta) throw new Error(`Неизвестный слой: ${layer}`);
  return {
    id: layer,
    title: meta.title,
    category: meta.category,
    endpoint: meta.endpoint,
    aliases: meta.aliases || [],
    searchFields: meta.searchFields || [],
    personFields: meta.personFields || [],
    sourceFields: ["layer", "name", "inn"],
  };
}

function emptyDataContext(question) {
  return {
    enabled: false,
    layers: [],
    query: {
      text: question,
      terms: [],
      patterns: { numbers: [], inns: [], streets: [], targetLayers: [] },
    },
    schools: [],
    kindergartens: [],
  };
}

function shouldUseDataContext(question, options = {}) {
  if (options.tools || options.files || options.schema || options.output) return true;
  const normalized = question.toLocaleLowerCase("ru-RU").trim();
  if (/^(привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер|hi|hello|hey)[!.?\s]*$/iu.test(normalized)) return false;
  if (/^(спасибо|благодарю|ок|окей|понял|поняла|ясно|хорошо|да|нет)[!.?\s]*$/iu.test(normalized)) return false;
  if (normalized.length <= 24 && /^(как дела|что нового|ты тут|ты здесь|кто ты)[?.!\s]*$/iu.test(normalized)) return false;
  const dataKeywords = [
    "школ", "сад", "детсад", "детский сад", "лицей", "гимнази", "инн", "адрес", "телефон",
    "почт", "email", "сайт", "лиценз", "руководител", "директор", "слой", "слои", "данн",
    "отчет", "отчёт", "выгруз", "csv", "json", "найди", "покажи", "список", "карточк",
    "организац", "учрежден", "йошкар", "ола", "петрова", "строител", "советск", "первомайск",
  ];
  return dataKeywords.some((keyword) => normalized.includes(keyword));
}

function extractSearchTerms(question) {
  const normalized = question
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => ![
      "в", "во", "на", "по", "и", "а", "ну", "так", "слушай", "скажи", "подскажи",
      "какие", "какая", "какой", "каком", "какой", "есть", "найди", "покажи",
      "контакты", "адрес", "телефон", "школы", "школа", "школе", "сад", "детский",
      "детские", "сады", "улица", "ул", "директор", "руководитель",
    ].includes(term))
    .filter((term) => term.length > 2 || /^\d+$/.test(term));

  return normalized.length > 0 ? normalized : [question];
}

function extractStructuredPatterns(question) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const numbers = [...new Set([
    ...[...normalized.matchAll(/\b\d{1,3}\b/g)].map((match) => match[0]),
    ...extractOrdinalNumbers(normalized),
  ])];
  const inns = [...new Set([...normalized.matchAll(/\b\d{10,12}\b/g)].map((match) => match[0]))];
  const targetLayers = [];
  if (/(школ|сош|лице|гимнази)/iu.test(normalized)) {
    targetLayers.push("schools");
  }
  if (/(детсад|детск|сад|сады|доу|мбдоу)/iu.test(normalized)) {
    targetLayers.push("kindergartens");
  }
  const streetMatches = [
    ...normalized.matchAll(/(?:улица|ул\.?)\s+([а-яёa-z0-9 .-]+)/giu),
    ...normalized.matchAll(/([а-яёa-z0-9 .-]+)\s+(?:улица|ул\.?)/giu),
  ];
  const streets = [...new Set(streetMatches.map((match) => cleanupPattern(match[1])).filter(Boolean))];

  return { numbers, inns, streets, targetLayers: [...new Set(targetLayers)] };
}

function extractOrdinalNumbers(normalizedQuestion) {
  const ordinals = [
    ["1", "(?:перв(?:ая|ой|ую|ое|ого|ом|ым|ых)?|первую)"],
    ["2", "(?:втор(?:ая|ой|ую|ое|ого|ом|ым|ых)?|вторую)"],
    ["3", "(?:трет(?:ья|ий|ью|ье|ьего|ьем|ьим|ьих)?|третью)"],
    ["4", "четверт(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["5", "пят(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["6", "шест(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["7", "седьм(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["8", "восьм(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["9", "девят(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
    ["10", "десят(?:ая|ой|ую|ое|ого|ом|ым|ых)?"],
  ];
  return ordinals
    .filter(([, pattern]) => new RegExp(`(^|[^а-яёa-z])${pattern}(?=$|[^а-яёa-z])`, "iu").test(normalizedQuestion))
    .map(([number]) => number);
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
  const head = String(summary.head || "").toLocaleLowerCase("ru-RU");
  const generalTerms = terms.filter((term) => !/^\d+$/.test(term));
  let score = generalTerms.reduce((value, term) => value + (text.includes(term.toLocaleLowerCase("ru-RU")) ? 1 : 0), 0);
  score += generalTerms.reduce((value, term) => value + (head.includes(term.toLocaleLowerCase("ru-RU")) ? 5 : 0), 0);

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

async function buildAiMessages(question, dataContext, history, options = {}, config = DEFAULT_AI_CONFIG) {
  const sourceLines = buildSourceLines(dataContext);
  const memoryText = options.bare ? "" : buildMemoryText();
  const projectContext = options.bare ? "" : await buildProjectContextText();
  const skillsText = options.bare ? "" : await buildSkillsText(config, question, options);
  const hasDataContext = dataContext.enabled !== false;
  const system = [
    "Ты терминальный AI-агент городского округа Йошкар-Ола.",
    "Отвечай на русском языке естественно и по смыслу запроса пользователя.",
    "Не смешивай языки. Не выдумывай факты, географию и числа.",
    "Если пользователь просто здоровается, ответь коротким приветствием и спроси, чем помочь.",
    hasDataContext ? "Используй только данные из переданного контекста открытых данных." : "Для обычного диалога отвечай как полноценный AI-ассистент, не перечисляй слои и возможности без запроса пользователя.",
    hasDataContext ? "" : "Не рассказывай сведения о Йошкар-Оле, школах или детских садах без прямого запроса и контекста данных.",
    hasDataContext ? "Если в контексте нет нужных сведений, прямо напиши, что данных недостаточно." : "",
    hasDataContext ? "Не выдумывай адреса, телефоны, лицензии и руководителей." : "",
    hasDataContext ? "Если отвечаешь по конкретным организациям, укажи источник в конце: слой, название и ИНН." : "",
    options.schema === "json" ? "Верни валидный JSON без markdown-обертки." : "",
    options.schema === "table" ? "Если уместно, верни ответ в виде markdown-таблицы." : "",
    memoryText ? `Учитывай пользовательскую память:\n${memoryText}` : "",
    projectContext ? `Учитывай локальный контекст проекта:\n${projectContext}` : "",
    skillsText ? `Подключенные skills:\n${skillsText}` : "",
    "Отвечай кратко и по делу.",
  ].filter(Boolean).join(" ");
  const contextText = JSON.stringify(dataContext, null, 2);
  const recentHistory = history.slice(-6);
  const userContent = hasDataContext
    ? `Контекст открытых данных городского округа "Город Йошкар-Ола":\n${contextText}\n\nКраткие источники контекста:\n${sourceLines}\n\nВопрос пользователя: ${question}`
    : question;

  return [
    { role: "system", content: system },
    ...recentHistory,
    { role: "user", content: userContent },
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
  if (config.provider === "iola") {
    return callIolaLocal(config, messages);
  }

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

async function callIolaLocal(config, messages) {
  const runtime = await ensureIolaModelRuntime({ quiet: true });
  const repo = config.repo || IOLA_ROUTER_HF_REPO;
  const modelDir = config.modelDir || IOLA_MODEL_DIR;
  const payload = {
    repo,
    cache_dir: modelDir,
    messages,
    max_new_tokens: Number(config.maxNewTokens || 180),
    temperature: Number(config.temperature ?? 0),
  };
  const { stdout, stderr } = await runCommand(runtime.python, [IOLA_MODEL_RUNNER], {
    input: JSON.stringify(payload),
    env: {
      IOLA_ROUTER_HF_REPO: repo,
      IOLA_MODEL_DIR: modelDir,
    },
  });
  const text = stdout.trim();
  if (!text) {
    throw new Error(`IOLA local model вернула пустой ответ.${stderr ? `\n${stderr}` : ""}`);
  }
  return text;
}

async function hasUsableIolaModel() {
  const state = readConfigLayerSync(getIolaModelStateFile(IOLA_MODEL_DIR));
  return Boolean(state?.repo && state?.revision && existsSync(IOLA_MODEL_DIR));
}

async function ensureIolaModelFresh(options = {}) {
  const repo = options.repo || IOLA_ROUTER_HF_REPO;
  const modelDir = options.modelDir || IOLA_MODEL_DIR;
  await mkdir(modelDir, { recursive: true });
  const stateFile = getIolaModelStateFile(modelDir);
  const state = readConfigLayerSync(stateFile) || {};
  const remote = await getRemoteIolaModelRevision(repo).catch(() => null);
  const stale = options.force || state.repo !== repo || !state.revision || (remote?.sha && remote.sha !== state.revision);
  if (!stale) return state;

  if (!options.quiet) {
    const reason = state.revision ? "обновляю" : "устанавливаю";
    console.log(`IOLA local model: ${reason} ${repo}`);
    console.log("Загрузка первой установки может занять несколько минут.");
  }

  const runtime = await ensureIolaModelRuntime({ quiet: options.quiet });
  const { stdout } = await runCommand(runtime.python, [IOLA_MODEL_RUNNER, "--ensure"], {
    input: JSON.stringify({ repo, cache_dir: modelDir }),
    env: {
      IOLA_ROUTER_HF_REPO: repo,
      IOLA_MODEL_DIR: modelDir,
    },
  });
  const installed = parseJsonObject(stdout || "{}");
  const nextState = {
    repo,
    revision: installed.revision || remote?.sha || state.revision || `local-${Date.now()}`,
    installedAt: new Date().toISOString(),
    runtime: "transformers",
  };
  await mkdir(modelDir, { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

function getIolaModelStateFile(modelDir = IOLA_MODEL_DIR) {
  return path.join(modelDir, "manifest.json");
}

async function ensureIolaModelRuntime(options = {}) {
  const python = await getIolaRuntimePython();
  if (python && await checkIolaPythonDeps(python)) return { python };

  const basePython = await findPythonCommand();
  if (!basePython) {
    throw new Error("Python не найден. Установите Python 3.11+ и повторите: iola ai setup iola --yes");
  }

  await mkdir(IOLA_MODEL_RUNTIME_DIR, { recursive: true });
  if (!python) {
    if (!options.quiet) console.log(`Создаю Python runtime: ${IOLA_MODEL_RUNTIME_DIR}`);
    await runCommand(basePython.command, [...basePython.args, "-m", "venv", IOLA_MODEL_RUNTIME_DIR], { inherit: !options.quiet });
  }

  const runtimePython = await getIolaRuntimePython();
  if (!runtimePython) {
    throw new Error("Не удалось создать Python runtime для локальной модели.");
  }

  if (!options.quiet) console.log("Устанавливаю зависимости локальной модели: torch, transformers, peft.");
  await runCommand(runtimePython, ["-m", "pip", "install", "--upgrade", "pip"], { inherit: !options.quiet });
  await runCommand(runtimePython, ["-m", "pip", "install", "torch>=2.6.0", "transformers>=4.57.0,<5.0", "peft>=0.15.0", "accelerate>=1.8.0", "huggingface_hub>=0.34.0,<1.0", "hf_xet>=1.1.0", "safetensors>=0.4.0"], { inherit: !options.quiet });

  if (!await checkIolaPythonDeps(runtimePython)) {
    throw new Error("Python-зависимости локальной модели не установились.");
  }
  return { python: runtimePython };
}

async function getIolaRuntimePython() {
  const candidate = process.platform === "win32"
    ? path.join(IOLA_MODEL_RUNTIME_DIR, "Scripts", "python.exe")
    : path.join(IOLA_MODEL_RUNTIME_DIR, "bin", "python");
  return existsSync(candidate) ? candidate : null;
}

async function checkIolaPythonDeps(python) {
  try {
    await runCommand(python, [IOLA_MODEL_RUNNER, "--check-deps"]);
    return true;
  } catch {
    return false;
  }
}

async function findPythonCommand() {
  const candidates = [
    { command: process.env.IOLA_PYTHON, args: [] },
    { command: "python", args: [] },
    { command: "python3", args: [] },
    { command: "py", args: ["-3"] },
  ].filter((item) => item.command);

  for (const candidate of candidates) {
    try {
      await runCommand(candidate.command, [...candidate.args, "--version"]);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function getRemoteIolaModelRevision(repo = IOLA_ROUTER_HF_REPO) {
  const repoPath = String(repo).split("/").map((part) => encodeURIComponent(part)).join("/");
  const response = await fetch(`https://huggingface.co/api/models/${repoPath}`, {
    headers: {
      accept: "application/json",
      "user-agent": "@iola_adm/iola-cli",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Hugging Face model metadata failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return { sha: payload.sha || payload.lastModified || "", lastModified: payload.lastModified || "" };
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
        options: {
          temperature: Number(config.temperature ?? 0.1),
        },
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
    contract_version: info.contract_version || "-",
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
    : await listDatasetViaRemoteMcp(dataset, options, params);
  const items = data;
  const filtered = applyDatasetFilters(items, options.local ? options : { ...options, search: "" });
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

async function listDatasetViaRemoteMcp(dataset, options, params) {
  try {
    const limit = Number(options.limit || 20);
    const offset = Number(options.offset || 0);
    const query = options.search || options._.join(" ") || "";
    const result = await callPublicMcpTool("layer_query", {
      layer: dataset,
      query,
      limit: offset + limit,
    });
    return normalizeItems(result.items || []).slice(offset, offset + limit);
  } catch (error) {
    if (options.debug) {
      console.error(`remote MCP fallback to API: ${error instanceof Error ? error.message : String(error)}`);
    }
    return normalizeItems(await fetchJsonMaybeCached(`${await getApiBaseUrl()}/${DATASETS[dataset].endpoint}?${params}`, options));
  }
}

async function getDatasetItem(dataset, options) {
  if (!options.inn) {
    throw new Error(`INN is required. Example: iola ${dataset} get --inn 1215067180`);
  }

  const result = options.local
    ? { found: true, item: searchLocalRecords(options.inn, { dataset, limit: 1, fts: false })[0] }
    : await callPublicMcpTool("layer_get", { layer: dataset, inn: options.inn });
  const item = result?.item;

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
        callPublicMcpTool("layer_query", { layer: "schools", query, limit }),
        callPublicMcpTool("layer_query", { layer: "kindergartens", query, limit }),
      ]);

  const result = {
    schools: projectColumns((options.local ? filterItems(normalizeItems(schools.items || schools), query) : normalizeItems(schools.items || schools)).slice(0, limit).map(selectPublicSummary), options.columns),
    kindergartens: projectColumns((options.local ? filterItems(normalizeItems(kindergartens.items || kindergartens), query) : normalizeItems(kindergartens.items || kindergartens)).slice(0, limit).map(selectPublicSummary), options.columns),
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
  const [client, ...rest] = args;

  if (client === "wizard" || client === "onboard") {
    await onboard(rest);
    return;
  }

  if (client !== "codex") {
    throw new Error('Доступно: iola setup codex, iola setup wizard.');
  }

  await runCommand("codex", ["mcp", "add", "yoshkarOlaPublicData", "--url", `${await getMcpBaseUrl()}/mcp`], { inherit: true });
  await runCommand("npx", ["-y", "@iola_adm/yoshkar-ola-public-mcp", "install-skill", "codex"], { inherit: true });
  console.log("Codex MCP и skill установлены.");
}

async function onboard(args = []) {
  onboardRanThisProcess = true;
  const options = parseOptions(args);
  await showBanner();
  console.log("Мастер настройки iola-cli.");
  console.log("Повторный запуск обновляет только выбранные разделы и не сбрасывает остальные настройки.");
  console.log("");
  initDatabase();
  await handleConfig(["validate"]);
  await doctor(["--summary"]);
  if (options.full || options.install) {
    await ensureArchiveTool({ install: true });
  } else {
    const archiveTool = await findCommand(["7z", "7zz", "7za"], ["--help"]);
    if (!archiveTool) {
      console.log("7-Zip не найден. Для архивов можно позже запустить: iola archive doctor");
    }
  }

  const componentStatus = await getOnboardComponentStatus();
  const components = options.yes ? defaultOnboardComponents(componentStatus) : await chooseOnboardComponents(componentStatus);
  if (components.includes("workspace")) await handleWorkspace(["init"]);
  if (components.includes("policy")) await handlePolicy(["use", "analyst"]);
  if (components.includes("archive")) await ensureArchiveTool({ install: true });
  if (components.includes("iola")) {
    await setupIolaLocal(["--yes"]);
  }
  if (components.includes("ollama")) {
    await installOllamaIfMissing();
    await setupOllama(["--yes"]);
  }
  if (components.includes("openai")) {
    await aiSetup(["openai"]);
    if (process.stdin.isTTY) await setAiKey("openai");
  }
  if (components.includes("openrouter")) {
    await aiSetup(["openrouter"]);
    if (process.stdin.isTTY) await setAiKey("openrouter");
  }
  if (components.includes("codex")) {
    await installCodexIfMissing();
    await aiSetup(["codex"]);
  }
  if (components.includes("codex-mcp")) await setupClient(["codex"]);
  if (components.includes("browser")) {
    const status = await getBrowserStatus();
    if (status.installed === "yes") console.log("Browser runtime уже установлен.");
    else await installBrowserRuntime();
  }
  if (components.includes("index")) {
    await setFilesMode("read-only", await loadConfig());
    console.log("Индекс документов можно запустить командой: iola index folder ./docs");
  }
  markFirstRunCompleted();
  console.log("Onboard завершен.");
}

async function chooseOnboardComponents(status = null) {
  if (!process.stdin.isTTY) return ["workspace", "policy"];
  const componentStatus = status || await getOnboardComponentStatus();
  console.log("");
  console.log("Выберите компоненты через запятую:");
  for (const item of onboardComponentRows(componentStatus)) {
    console.log(`${item.number}. ${item.title} [${item.status}] - ${item.hint}`);
  }
  console.log("");
  const rl = readline.createInterface({ input, output });
  try {
    const defaults = defaultOnboardSelection(componentStatus);
    const answer = (await rl.question(`Компоненты [${defaults.join(",")}]: `)).trim() || defaults.join(",");
    const selected = new Set(answer.split(/[,\s]+/).filter(Boolean));
    const map = {
      1: "workspace",
      2: "policy",
      3: "iola",
      4: "openai",
      5: "openrouter",
      6: "codex",
      7: "codex-mcp",
      8: "archive",
      9: "index",
      10: "browser",
      11: "ollama",
    };
    return [...selected].map((item) => map[item] || item).filter(Boolean);
  } finally {
    rl.close();
  }
}

async function getOnboardComponentStatus() {
  const [config, readiness, browser, archive, codexVersion, ollamaVersion] = await Promise.all([
    loadConfig(),
    getAiReadiness(),
    getBrowserStatus(),
    findCommand(["7z", "7zz", "7za"], ["--help"]).catch(() => null),
    getCommandVersion("codex", ["--version"]),
    getOllamaVersion(),
  ]);
  const workspaceReady = existsSync(PROJECT_CONTEXT_FILE) || existsSync(PROJECT_CONTEXT_DIR_FILE) || existsSync(PROJECT_IOLA_DIR);
  const policyReady = (config.toolsets?.enabled || []).includes("analyst");
  return {
    workspace: workspaceReady,
    policy: policyReady,
    iola: Boolean(readiness.iola),
    ollama: Boolean(ollamaVersion && readiness.ollama),
    openai: Boolean(readiness.openai),
    openrouter: Boolean(readiness.openrouter),
    codex: Boolean(codexVersion !== "не найден" && readiness.codex),
    "codex-mcp": false,
    archive: Boolean(archive),
    index: false,
    browser: browser.installed === "yes",
  };
}

function onboardComponentRows(status) {
  const rows = [
    ["1", "workspace", "workspace и контекст", "рабочая папка, IOLA.md и .iola/context.md"],
    ["2", "policy", "policy analyst", "разрешения и профиль аналитика"],
    ["3", "iola", "IOLA локальная модель", "локальная модель найдена"],
    ["4", "openai", "OpenAI API", "API-ключ сохранен или есть в env"],
    ["5", "openrouter", "OpenRouter API", "API-ключ сохранен или есть в env"],
    ["6", "codex", "Codex CLI", "CLI установлен и авторизация найдена"],
    ["7", "codex-mcp", "MCP для Codex", "можно переустановить/обновить"],
    ["8", "archive", "7-Zip / архивы", "архиватор найден"],
    ["9", "index", "Индекс локальных документов", "настраивается под выбранную папку"],
    ["10", "browser", "Browser runtime", "Playwright/Chromium установлен"],
    ["11", "ollama", "Ollama", "опциональный локальный runtime"],
  ];
  return rows.map(([number, key, title, hint]) => ({ number, key, title, hint, status: status[key] ? "готово" : "не настроено" }));
}

function defaultOnboardSelection(status) {
  const defaults = [];
  if (!status.workspace) defaults.push("1");
  if (!status.policy) defaults.push("2");
  if (!status.iola) defaults.push("3");
  if (!status.archive) defaults.push("8");
  return defaults.length ? defaults : ["1", "2"];
}

function defaultOnboardComponents(status) {
  const map = { 1: "workspace", 2: "policy", 3: "iola", 4: "openai", 5: "openrouter", 6: "codex", 7: "codex-mcp", 8: "archive", 9: "index", 10: "browser", 11: "ollama" };
  return defaultOnboardSelection(status).map((item) => map[item]).filter(Boolean);
}

function parseOptions(args) {
  const result = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--yes" || arg === "--silent" || arg === "--events" || arg === "--stream-json" || arg === "--stdio" || arg === "--system" || arg === "--headed" || arg === "--headless" || arg === "--no-history" || arg === "--summary" || arg === "--all" || arg === "--full" || arg === "--unread" || arg === "--once" || arg === "--local" || arg === "--cache" || arg === "--tools" || arg === "--files" || arg === "--plan" || arg === "--trace" || arg === "--diff" || arg === "--stage" || arg === "--fts" || arg === "--bare" || arg === "--quiet" || arg === "--optional" || arg === "--project" || arg === "--dry-run" || arg === "--no-color" || arg === "--fail-on-empty" || arg === "--debug" || arg === "--fix" || arg === "--append") {
      result[arg.slice(2)] = true;
    } else if (arg === "--check" || arg === "--upgrade-node") {
      result.check = true;
      result[arg.slice(2)] = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--replace" || arg === "--text" || arg === "--path" || arg === "--depth" || arg === "--max-bytes" || arg === "--query" || arg === "--where" || arg === "--columns" || arg === "--inn" || arg === "--model" || arg === "--provider" || arg === "--profile" || arg === "--name" || arg === "--source" || arg === "--command" || arg === "--prompt" || arg === "--description" || arg === "--base-url" || arg === "--repo" || arg === "--model-dir" || arg === "--sandbox" || arg === "--approval" || arg === "--cwd" || arg === "--codex-profile" || arg === "--format" || arg === "--output" || arg === "--schema" || arg === "--session" || arg === "--temperature" || arg === "--config" || arg === "--dataset" || arg === "--save" || arg === "--reasoning" || arg === "--agent" || arg === "--scope" || arg === "--selector" || arg === "--url" || arg === "--timeout" || arg === "--wait" || arg === "--viewport" || arg === "--press" || arg === "--script" || arg === "--auth-url" || arg === "--token-url" || arg === "--userinfo-url" || arg === "--client-id" || arg === "--client-secret" || arg === "--redirect-host" || arg === "--redirect-port" || arg === "--redirect-path" || arg === "--debug-file") {
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

async function listContextFiles() {
  const files = [
    { scope: "project", file: PROJECT_CONTEXT_FILE },
    { scope: "project-dir", file: PROJECT_CONTEXT_DIR_FILE },
  ];
  const rows = [];
  for (const item of files) {
    try {
      const info = await stat(item.file);
      rows.push({ ...item, exists: "yes", size: info.size });
    } catch {
      rows.push({ ...item, exists: "no", size: "-" });
    }
  }
  return rows;
}

async function buildProjectContextText() {
  const chunks = [];
  for (const item of await listContextFiles()) {
    if (item.exists !== "yes") continue;
    const text = await readFile(item.file, "utf8");
    chunks.push(`# ${item.scope}: ${item.file}\n${text.trim()}`);
  }
  return chunks.join("\n\n");
}

function skillRoots() {
  return [BUILTIN_SKILLS_DIR, USER_SKILLS_DIR, path.join(process.cwd(), ".iola", "skills")];
}

function listSkills(config = DEFAULT_AI_CONFIG) {
  const rows = [];
  for (const root of skillRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = entry.isDirectory() ? path.join(root, entry.name, "SKILL.md") : entry.name.endsWith(".md") ? path.join(root, entry.name) : null;
      if (!file || !existsSync(file)) continue;
      const meta = readSkillMeta(file);
      rows.push({
        name: meta.name || path.basename(entry.name, ".md"),
        description: meta.description || "-",
        source: root === BUILTIN_SKILLS_DIR ? "builtin" : root === USER_SKILLS_DIR ? "user" : "project",
        file,
        enabled: isSkillEnabled(config, meta.name || path.basename(entry.name, ".md")),
      });
    }
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

function findSkill(name, config) {
  if (!name) return null;
  return listSkills(config).find((skill) => skill.name === name);
}

function readSkillMeta(file) {
  try {
    const text = readFileSyncUtf8(file);
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    const meta = {};
    if (frontmatter) {
      for (const line of frontmatter[1].split(/\r?\n/)) {
        const [key, ...parts] = line.split(":");
        if (key && parts.length > 0) meta[key.trim()] = parts.join(":").trim().replace(/^["']|["']$/g, "");
      }
    }
    return meta;
  } catch {
    return {};
  }
}

function readFileSyncUtf8(file) {
  return readFileSync(file, "utf8");
}

function isSkillEnabled(config, name) {
  return (config.skills?.enabled || []).includes(name);
}

async function buildSkillsText(config, question = "", options = {}) {
  const chunks = [];
  const selected = selectSkillsForPrompt(config, question, options);
  for (const skill of listSkills(config)) {
    if (!skill.enabled || !selected.has(skill.name)) continue;
    const text = await readFile(skill.file, "utf8");
    chunks.push(`## Skill: ${skill.name}\n${stripFrontmatter(text).trim()}`);
  }
  return chunks.join("\n\n").slice(0, 12000);
}

function selectSkillsForPrompt(config, question = "", options = {}) {
  const enabled = new Set(config.skills?.enabled || []);
  const selected = new Set();
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  if (enabled.has("local-model")) selected.add("local-model");
  if (enabled.has("open-data") && shouldUseDataContext(question, options)) selected.add("open-data");
  if (enabled.has("reports") && /(отчет|отчёт|выгруз|csv|xlsx|качество|провер)/iu.test(normalized)) selected.add("reports");
  if (enabled.has("local-files") && (options.files || /(файл|папк|readme|документ|архив)/iu.test(normalized))) selected.add("local-files");
  if (enabled.has("browser-agent") && /(браузер|сайт|страниц|url|https?:\/\/)/iu.test(normalized)) selected.add("browser-agent");
  return selected;
}

function stripFrontmatter(text) {
  return String(text).replace(/^---\n[\s\S]*?\n---\n?/, "");
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
  const command = await resolveOllamaCommand();
  if (!command) return null;
  try {
    const { stdout } = await runCommand(command, ["--version"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function resolveOllamaCommand() {
  const candidates = ["ollama"];
  if (process.platform === "win32") {
    candidates.push(
      path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/usr/bin/ollama");
  }
  for (const command of [...new Set(candidates.filter(Boolean))]) {
    try {
      if (command !== "ollama" && !existsSync(command)) continue;
      await runCommand(command, ["--version"]);
      return command;
    } catch {
      // Try next candidate.
    }
  }
  return null;
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

async function findCommand(candidates, versionArgs = ["--version"]) {
  for (const command of candidates) {
    const version = await getCommandVersion(command, versionArgs);
    if (version !== "не найден") return { command, version };
  }
  return null;
}

async function ensureArchiveTool(options = {}) {
  const found = await findCommand(["7z", "7zz", "7za"], ["--help"]);
  if (found) return found.command;
  if (options.install === false) throw new Error("7-Zip не найден.");
  await installSevenZip();
  const installed = await findCommand(["7z", "7zz", "7za"], ["--help"]);
  if (!installed) throw new Error("7-Zip не найден после установки. Перезапустите терминал и проверьте: 7z");
  return installed.command;
}

async function installSevenZip() {
  console.log("7-Zip не найден. Устанавливаю архиватор для работы со всеми типами архивов.");
  if (process.platform === "win32") {
    await runCommand("winget", ["install", "7zip.7zip", "--accept-package-agreements", "--accept-source-agreements"], { inherit: true });
    return;
  }
  if (process.platform === "darwin") {
    try {
      await runCommand("brew", ["install", "sevenzip"], { inherit: true });
    } catch {
      await runCommand("brew", ["install", "p7zip"], { inherit: true });
    }
    return;
  }
  try {
    await runCommand("sh", ["-c", "sudo apt-get update && sudo apt-get install -y p7zip-full p7zip-rar"], { inherit: true });
  } catch {
    await runCommand("sh", ["-c", "sudo apt-get update && sudo apt-get install -y 7zip"], { inherit: true });
  }
}

async function installOllamaIfMissing() {
  if (await getOllamaVersion()) return;
  console.log("Ollama не найден. Устанавливаю Ollama.");
  if (process.platform === "win32") {
    await runCommand("winget", ["install", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements"], { inherit: true });
    return;
  }
  if (process.platform === "darwin") {
    await runCommand("brew", ["install", "--cask", "ollama"], { inherit: true });
    return;
  }
  await runCommand("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { inherit: true });
  if (!(await getOllamaVersion())) {
    console.log("Ollama установлен, но текущий терминал может еще не видеть команду. CLI попробует стандартный путь установки.");
  }
}

async function installCodexIfMissing() {
  const version = await getCommandVersion("codex", ["--version"]);
  if (version !== "не найден") return;
  console.log("Codex CLI не найден. Устанавливаю через npm.");
  await runCommand("npm", ["install", "-g", "@openai/codex"], { inherit: true });
}

async function getBrowserStatus() {
  const installed = existsSync(BROWSER_RUNTIME_PACKAGE);
  let playwright = "не установлен";
  if (installed) {
    try {
      playwright = JSON.parse(await readFile(BROWSER_RUNTIME_PACKAGE, "utf8")).version || "installed";
    } catch {
      playwright = "installed";
    }
  }
  return {
    runtime: BROWSER_RUNTIME_DIR,
    playwright,
    installed: installed ? "yes" : "no",
    install_command: "iola browser install",
    chromium: installed ? "managed by Playwright" : "not installed",
  };
}

async function installBrowserRuntime() {
  if (existsSync(BROWSER_RUNTIME_PACKAGE)) {
    console.log(`Browser runtime уже установлен: ${BROWSER_RUNTIME_DIR}`);
    return;
  }
  await mkdir(BROWSER_RUNTIME_DIR, { recursive: true });
  const packageFile = path.join(BROWSER_RUNTIME_DIR, "package.json");
  if (!existsSync(packageFile)) {
    await writeFile(packageFile, `${JSON.stringify({ private: true, type: "module", dependencies: {} }, null, 2)}\n`, "utf8");
  }
  console.log(`Устанавливаю Playwright runtime: ${BROWSER_RUNTIME_DIR}`);
  await runPackageManager("npm", ["install", "playwright@latest"], { inherit: true, cwd: BROWSER_RUNTIME_DIR });
  await runPackageManager("npx", ["playwright", "install", "chromium"], { inherit: true, cwd: BROWSER_RUNTIME_DIR });
}

function runPackageManager(command, args, options = {}) {
  if (process.platform === "win32") {
    return runCommand(process.env.ComSpec || "cmd.exe", ["/d", "/c", [command, ...args].join(" ")], options);
  }
  return runCommand(command, args, options);
}

async function ensureBrowserRuntime() {
  if (existsSync(BROWSER_RUNTIME_PACKAGE)) return;
  throw new Error("Browser runtime не установлен. Запустите: iola browser install");
}

async function runBrowserAutomation(action, params) {
  await ensureBrowserRuntime();
  const scriptFile = path.join(BROWSER_RUNTIME_DIR, `iola-browser-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(scriptFile, browserAutomationScript(action, params), "utf8");
  try {
    const { stdout } = await runCommand(process.execPath, [scriptFile], { cwd: BROWSER_RUNTIME_DIR });
    return stdout.trim();
  } finally {
    await rm(scriptFile, { force: true }).catch(() => {});
  }
}

function browserAutomationScript(action, params) {
  return `
import { chromium } from "playwright";
const action = ${JSON.stringify(action)};
const params = ${JSON.stringify(params)};
const [width, height] = String(params.viewport || "1366x768").split("x").map(Number);
const browser = await chromium.launch({ headless: !params.headed });
const page = await browser.newPage({ viewport: { width: width || 1366, height: height || 768 } });
page.setDefaultTimeout(params.timeout || 30000);
try {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: params.timeout || 30000 });
  if (params.waitMs) await page.waitForTimeout(params.waitMs);
  if (action === "open") {
    if (params.waitMs > 0) await page.waitForTimeout(params.waitMs);
    else if (!page.context().browser()?.isConnected()) {}
  } else if (action === "text") {
    console.log((await page.locator("body").innerText()).trim());
  } else if (action === "html") {
    console.log(await page.content());
  } else if (action === "screenshot") {
    await page.screenshot({ path: params.output, fullPage: true });
  } else if (action === "pdf") {
    await page.pdf({ path: params.output, format: "A4", printBackground: true });
  } else if (action === "click") {
    await page.locator(params.selector).first().click();
    if (params.waitMs) await page.waitForTimeout(params.waitMs);
    if (params.output) await page.screenshot({ path: params.output, fullPage: true });
    console.log((await page.locator("body").innerText()).trim().slice(0, 4000));
  } else if (action === "type") {
    const locator = page.locator(params.selector).first();
    await locator.fill(params.text || "");
    if (params.press) await locator.press(params.press);
    if (params.waitMs) await page.waitForTimeout(params.waitMs);
    if (params.output) await page.screenshot({ path: params.output, fullPage: true });
    console.log((await page.locator("body").innerText()).trim().slice(0, 4000));
  } else if (action === "eval") {
    const value = await page.evaluate(new Function("return (" + params.script + ")"));
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
} finally {
  await browser.close();
}
`;
}

async function probeEndpoint(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    return response.ok ? "доступен" : `${response.status} ${response.statusText}`;
  } catch {
    return "недоступен";
  }
}

async function startDaemon(host, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderDaemonDashboard(host, port));
        return;
      }

      res.setHeader("content-type", "application/json; charset=utf-8");

      if (req.method === "GET" && url.pathname === "/health") {
        res.end(JSON.stringify({ status: "running", endpoint: `http://${host}:${port}`, db: getDbStatus().status }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        res.end(JSON.stringify({ status: "running", db: getDbStatus(), sync: getSyncStatus() }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        res.end(JSON.stringify({ db: getDbStatus(), sync: getSyncStatus(), usage: getUsageSummary() }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/tasks") {
        res.end(JSON.stringify(listTasks()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/artifacts") {
        res.end(JSON.stringify(listArtifacts()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/trace") {
        res.end(JSON.stringify(listTrace(50)));
        return;
      }

      if (req.method === "POST" && url.pathname === "/rpc") {
        const body = await readRequestBody(req);
        const payload = body ? JSON.parse(body) : {};
        const result = await executeRpc(payload.method, { ...(payload.params || {}), _: [] });
        res.end(JSON.stringify({ ok: true, result }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`iola daemon запущен: http://${host}:${port}`);
  console.log("Остановить: Ctrl+C");
  await new Promise(() => {});
}

async function startMcpServer(host, port) {
  const server = createServer(async (req, res) => {
    let payload = {};
    try {
      res.setHeader("content-type", "application/json; charset=utf-8");
      if (req.method !== "POST") {
        res.end(JSON.stringify({ name: "iola-local-mcp", protocol: "2024-11-05", tools: mcpTools().map((tool) => tool.name) }));
        return;
      }
      payload = JSON.parse(await readRequestBody(req) || "{}");
      const result = await handleMcpMessage(payload);
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id || null, result }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id || null, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`iola local MCP запущен: http://${host}:${port}`);
  await new Promise(() => {});
}

function renderDaemonDashboard(host, port) {
  const status = getDbStatus();
  const sync = getSyncStatus();
  const usage = getUsageSummary();
  return `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<title>iola daemon</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:32px;background:#f8fafc;color:#0f172a}
h1{margin:0 0 8px;font-size:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:20px}
.card{background:white;border:1px solid #dbe3ef;border-radius:8px;padding:16px}
.k{color:#64748b;font-size:12px;text-transform:uppercase}.v{font-size:24px;font-weight:700;margin-top:4px}
a{color:#0b62d6}
code{background:#eef2f7;padding:2px 5px;border-radius:4px}
</style>
<h1>iola daemon</h1>
<div>Локальная панель CLI-проекта Йошкар-Олы: <code>http://${host}:${port}</code></div>
<div class="grid">
<div class="card"><div class="k">DB</div><div class="v">${status.status}</div><p>schema ${status.schema}, records ${status.local_records}</p></div>
<div class="card"><div class="k">Sync</div><div class="v">${sync.last_status || "none"}</div><p>${sync.last_dataset || "-"} ${sync.last_records || 0}</p></div>
<div class="card"><div class="k">Usage</div><div class="v">${usage.requests}</div><p>${usage.estimated_tokens} tokens</p></div>
<div class="card"><div class="k">API</div><p><a href="/api/status">/api/status</a></p><p><a href="/api/tasks">/api/tasks</a></p><p><a href="/api/artifacts">/api/artifacts</a></p><p><a href="/api/trace">/api/trace</a></p></div>
</div>
</html>`;
}

async function startMcpStdio() {
  const rl = readline.createInterface({ input, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let payload = {};
    try {
      payload = JSON.parse(line);
      const result = await handleMcpMessage(payload);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: payload.id || null, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: payload.id || null, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
}

async function handleMcpMessage(payload) {
  const method = payload.method;
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "iola-local-mcp", version: getPackageVersion() },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    };
  }
  if (method === "tools/list") return { tools: mcpTools() };
  if (method === "tools/call") {
    const result = await callMcpTool(payload.params?.name, payload.params?.arguments || {});
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
  }
  if (method === "resources/list") return { resources: mcpResources() };
  if (method === "resources/read") {
    const text = await readMcpResource(payload.params?.uri);
    return { contents: [{ uri: payload.params?.uri, mimeType: "application/json", text }] };
  }
  if (method === "prompts/list") return { prompts: mcpPrompts() };
  if (method === "prompts/get") return getMcpPrompt(payload.params?.name, payload.params?.arguments || {});
  if (method === "notifications/initialized") return {};
  throw new Error(`MCP method неизвестен: ${method}`);
}

function mcpTools() {
  const schema = (properties = {}) => ({ type: "object", properties, additionalProperties: false });
  return [
    { name: "status", description: "Статус локальной БД, sync и активного AI-профиля.", inputSchema: schema() },
    { name: "layer.list", description: "Список слоев данных и их схем.", inputSchema: schema({ category: { type: "string" } }) },
    { name: "layer.schema", description: "Схема слоя данных.", inputSchema: schema({ layer: { type: "string" } }) },
    { name: "layer.suggest", description: "Подобрать слой данных по вопросу пользователя через публичный MCP.", inputSchema: schema({ query: { type: "string" }, limit: { type: "number" } }) },
    { name: "layer.query", description: "Поиск по слою данных через общий retrieval.", inputSchema: schema({ layer: { type: "string" }, query: { type: "string" }, terms: { type: "array" }, patterns: { type: "object" }, limit: { type: "number" } }) },
    { name: "layer.get", description: "Получить запись слоя по ИНН или названию.", inputSchema: schema({ layer: { type: "string" }, query: { type: "string" }, inn: { type: "string" } }) },
    { name: "layer.answer_context", description: "RAG-контекст с фактами и источниками через публичный MCP.", inputSchema: schema({ question: { type: "string" }, layer: { type: "string" }, limit: { type: "number" } }) },
    { name: "search", description: "Поиск по локальным открытым данным Йошкар-Олы.", inputSchema: schema({ query: { type: "string" }, dataset: { type: "string" }, limit: { type: "number" } }) },
    { name: "card", description: "Карточка объекта по названию или ИНН.", inputSchema: schema({ query: { type: "string" } }) },
    { name: "quality", description: "Проверки качества данных.", inputSchema: schema({ scope: { type: "string" } }) },
    { name: "sync", description: "Обновление локальной копии слоя.", inputSchema: schema({ dataset: { type: "string" } }) },
    { name: "files.tree", description: "Дерево файлов разрешенного workspace.", inputSchema: schema({ path: { type: "string" }, depth: { type: "number" }, limit: { type: "number" } }) },
    { name: "files.read", description: "Чтение файла разрешенного workspace.", inputSchema: schema({ path: { type: "string" }, maxBytes: { type: "number" } }) },
    { name: "files.search", description: "Поиск текста в файлах workspace.", inputSchema: schema({ query: { type: "string" }, path: { type: "string" }, limit: { type: "number" } }) },
    { name: "index.search", description: "Поиск по индексу локальных документов.", inputSchema: schema({ query: { type: "string" }, limit: { type: "number" } }) },
    { name: "report", description: "Запуск встроенного отчета.", inputSchema: schema({ name: { type: "string" }, format: { type: "string" }, output: { type: "string" } }) },
    { name: "browser.text", description: "Открыть страницу в headless Chromium и вернуть видимый текст.", inputSchema: schema({ url: { type: "string" }, waitMs: { type: "number" } }) },
    { name: "browser.screenshot", description: "Сделать скриншот страницы через Chromium.", inputSchema: schema({ url: { type: "string" }, output: { type: "string" }, waitMs: { type: "number" } }) },
  ];
}

function mcpResources() {
  return [
    { uri: "iola://status", name: "Статус CLI", mimeType: "application/json" },
    { uri: "iola://layers", name: "Слои данных", mimeType: "application/json" },
    { uri: "iola://sync", name: "Статус синхронизации", mimeType: "application/json" },
    { uri: "iola://settings", name: "Эффективные настройки", mimeType: "application/json" },
    { uri: "iola://skills", name: "Skills", mimeType: "application/json" },
    { uri: "iola://memory", name: "Память агента", mimeType: "application/json" },
    { uri: "iola://artifacts", name: "Artifacts", mimeType: "application/json" },
  ];
}

function mcpPrompts() {
  return [
    { name: "data-question", description: "Ответить строго по открытым данным Йошкар-Олы.", arguments: [{ name: "question", required: true }] },
    { name: "document-review", description: "Проверить документ на полноту и источники.", arguments: [{ name: "file", required: true }] },
    { name: "report-build", description: "Собрать отчет по выбранному слою.", arguments: [{ name: "dataset", required: true }] },
  ];
}

async function callMcpTool(name, args = {}) {
  if (name === "layer.list") {
    try {
      const result = await callPublicMcpTool("layer_list", { category: args.category || undefined });
      return result.items || result;
    } catch {
      return Object.entries(DATASETS)
        .map(([id, meta]) => layerSchema(id))
        .filter((layer) => !args.category || layer.category === args.category);
    }
  }
  if (name === "layer.schema") {
    try {
      return await callPublicMcpTool("layer_schema", { layer: args.layer });
    } catch {
      return layerSchema(args.layer);
    }
  }
  if (name === "layer.suggest") return callPublicMcpTool("layer_suggest", { query: args.query || "", limit: Number(args.limit || 5) });
  if (name === "layer.query") {
    try {
      const result = await callPublicMcpTool("layer_query", { layer: args.layer, query: args.query || "", limit: Number(args.limit || 20) });
      return { layer: result.layer?.id || args.layer, schema: result.layer, items: result.items || [] };
    } catch {
      return queryLayer(args.layer, args);
    }
  }
  if (name === "layer.get") {
    try {
      return await callPublicMcpTool("layer_get", { layer: args.layer, query: args.query || "", inn: args.inn || "" });
    } catch {
      const result = await queryLayer(args.layer, { query: args.inn || args.query || "", terms: [args.inn || args.query || ""], limit: 1 });
      return result.items[0] || null;
    }
  }
  if (name === "layer.answer_context") return callPublicMcpTool("layer_answer_context", { question: args.question || "", layer: args.layer || "", limit: Number(args.limit || 5) });
  if (name === "index.search") return searchDocs(args.query || "", Number(args.limit || 20));
  if (name === "report") {
    const output = args.output || `${args.name || "education-contacts"}.${args.format || "xlsx"}`;
    await handleExport([args.name || "education-contacts", "--format", args.format || "xlsx", "--output", output]);
    return { output };
  }
  if (name === "browser.text") {
    return runBrowserAutomation("text", { url: args.url, waitMs: Number(args.waitMs || 0), timeout: Number(args.timeout || 30000), viewport: args.viewport || "1366x768" });
  }
  if (name === "browser.screenshot") {
    const output = path.resolve(args.output || "browser-page.png");
    await runBrowserAutomation("screenshot", { url: args.url, output, waitMs: Number(args.waitMs || 0), timeout: Number(args.timeout || 30000), viewport: args.viewport || "1366x768" });
    return { output };
  }
  return executeRpc(name, { ...args, _: [] });
}

async function readMcpResource(uri) {
  if (uri === "iola://status") return JSON.stringify({ db: getDbStatus(), sync: getSyncStatus() }, null, 2);
  if (uri === "iola://layers") return JSON.stringify(Object.fromEntries(Object.keys(DATASETS).map((id) => [id, layerSchema(id)])), null, 2);
  if (uri === "iola://sync") return JSON.stringify(getSyncStatus(), null, 2);
  if (uri === "iola://settings") return JSON.stringify(await loadConfig(), null, 2);
  if (uri === "iola://skills") return JSON.stringify(listSkills(await loadConfig()), null, 2);
  if (uri === "iola://memory") return JSON.stringify(listMemory(100), null, 2);
  if (uri === "iola://artifacts") return JSON.stringify(listArtifacts(), null, 2);
  throw new Error(`MCP resource неизвестен: ${uri}`);
}

function getMcpPrompt(name, args = {}) {
  if (name === "data-question") {
    return { messages: [{ role: "user", content: { type: "text", text: `Ответь по открытым данным городского округа "Город Йошкар-Ола", не выдумывая сведения: ${args.question || ""}` } }] };
  }
  if (name === "document-review") {
    return { messages: [{ role: "user", content: { type: "text", text: `Проверь документ ${args.file || ""}: полнота, источники, противоречия, ошибки оформления.` } }] };
  }
  if (name === "report-build") {
    return { messages: [{ role: "user", content: { type: "text", text: `Собери практичный отчет по слою ${args.dataset || "schools"} с выводами и источником данных.` } }] };
  }
  throw new Error(`MCP prompt неизвестен: ${name}`);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function setFilesMode(mode, config = null) {
  const current = config || await loadConfig();
  const localTools = { ...(current.permissions?.localTools || {}) };
  for (const tool of FILE_TOOLS) localTools[tool] = false;
  const permissions = {
    ...(current.permissions || DEFAULT_AI_CONFIG.permissions),
    localTools,
    readFiles: false,
    editFiles: false,
    deleteFiles: false,
  };
  const enabled = new Set(current.toolsets?.enabled || []);
  enabled.delete("local-files-read");
  enabled.delete("local-files-write");

  if (mode === "read-only") {
    permissions.readFiles = true;
    for (const tool of ["files_tree", "files_read", "files_search"]) permissions.localTools[tool] = true;
    enabled.add("local-files-read");
  } else if (mode === "workspace-write") {
    permissions.readFiles = true;
    permissions.writeFiles = true;
    permissions.editFiles = true;
    for (const tool of FILE_TOOLS) permissions.localTools[tool] = true;
    enabled.add("local-files-read");
    enabled.add("local-files-write");
  } else if (mode === "full-access") {
    permissions.readFiles = true;
    permissions.writeFiles = true;
    permissions.editFiles = true;
    permissions.deleteFiles = false;
    for (const tool of FILE_TOOLS) permissions.localTools[tool] = true;
    enabled.add("local-files-read");
    enabled.add("local-files-write");
  }

  await saveConfig({
    permissions,
    toolsets: { ...(current.toolsets || {}), enabled: [...enabled] },
    files: { ...(current.files || {}), mode },
  });
}

function resolveWorkspaceRoot(config) {
  return path.resolve(process.cwd(), config.files?.workspaceRoot || ".");
}

async function resolveFileTarget(target, operation) {
  if (!target) throw new Error("Путь к файлу обязателен.");
  const config = await loadConfig();
  const mode = config.files?.mode || "locked";
  if (mode === "locked") throw new Error("Файловые операции заблокированы. Включите: iola files mode read-only");
  const workspaceRoot = resolveWorkspaceRoot(config);
  const resolved = path.resolve(workspaceRoot, target);
  const relative = path.relative(workspaceRoot, resolved);
  const insideWorkspace = relative && !relative.startsWith("..") && !path.isAbsolute(relative);

  if ((mode === "read-only" || mode === "workspace-write") && !insideWorkspace && resolved !== workspaceRoot) {
    throw new Error(`Путь вне workspace запрещен режимом ${mode}: ${resolved}`);
  }

  const blocked = config.files?.blockedGlobs || [];
  const normalized = resolved.toLocaleLowerCase("ru-RU");
  if (blocked.some((pattern) => filePatternMatches(normalized, pattern))) {
    throw new Error(`Путь заблокирован политикой безопасности: ${target}`);
  }

  if (operation === "read") await assertPermission("readFiles");
  if (operation === "write") await assertPermission("writeFiles");
  if (operation === "edit") await assertPermission("editFiles");
  if (operation === "delete") await assertPermission("deleteFiles");

  return { config, resolved, workspaceRoot, relative: resolved === workspaceRoot ? "." : relative, insideWorkspace };
}

function filePatternMatches(normalizedPath, pattern) {
  const normalizedPattern = String(pattern).toLocaleLowerCase("ru-RU").replace(/\*/g, "");
  if (!normalizedPattern) return false;
  return normalizedPath.split(/[\\/]/).includes(normalizedPattern) || normalizedPath.includes(normalizedPattern);
}

function isBlockedPathForConfig(fullPath, config) {
  const normalized = fullPath.toLocaleLowerCase("ru-RU");
  return (config.files?.blockedGlobs || []).some((pattern) => filePatternMatches(normalized, pattern));
}

async function filesTree(target = ".", options = {}) {
  await assertPermission("files_tree");
  const { resolved, workspaceRoot } = await resolveFileTarget(target, "read");
  const depth = Number(options.depth || 2);
  const limit = Number(options.limit || 100);
  const rows = [];
  await walkFiles(resolved, workspaceRoot, rows, depth, limit, (await loadConfig()));
  return rows;
}

async function walkFiles(directory, workspaceRoot, rows, depth, limit, config) {
  if (rows.length >= limit || depth < 0) return;
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (rows.length >= limit) break;
    const full = path.join(directory, entry.name);
    if (isBlockedPathForConfig(full, config)) continue;
    const relative = path.relative(workspaceRoot, full) || ".";
    let size = "-";
    try {
      size = entry.isFile() ? (await stat(full)).size : "-";
    } catch {
      size = "-";
    }
    rows.push({ type: entry.isDirectory() ? "dir" : "file", path: relative, size });
    if (entry.isDirectory()) await walkFiles(full, workspaceRoot, rows, depth - 1, limit, config);
  }
}

async function filesRead(target, options = {}) {
  await assertPermission("files_read");
  const { config, resolved } = await resolveFileTarget(target, "read");
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Это не файл: ${target}`);
  const maxBytes = Number(options.maxBytes || config.files?.maxReadBytes || 200000);
  if (info.size > maxBytes) throw new Error(`Файл слишком большой: ${info.size} байт. Лимит: ${maxBytes}`);
  return extractReadableText(resolved);
}

async function filesSearch(query, options = {}) {
  await assertPermission("files_search");
  if (!query) throw new Error("Строка поиска обязательна.");
  const rows = await filesTree(options.path || ".", { depth: Number(options.depth || 4), limit: Number(options.limit || 200) });
  const results = [];
  for (const row of rows.filter((item) => item.type === "file")) {
    if (results.length >= Number(options.limit || 50)) break;
    try {
      const text = await filesRead(row.path, { maxBytes: 500000 });
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length < Number(options.limit || 50) && line.toLocaleLowerCase("ru-RU").includes(String(query).toLocaleLowerCase("ru-RU"))) {
          results.push({ file: row.path, line: index + 1, text: line.trim().slice(0, 240) });
        }
      });
    } catch {
      // Binary, blocked or oversized files are skipped.
    }
  }
  return results;
}

async function filesWrite(target, text, options = {}) {
  await assertPermission("files_write");
  const { resolved, relative } = await resolveFileTarget(target, "write");
  await maybeConfirmFileOperation("write", relative, text);
  await mkdir(path.dirname(resolved), { recursive: true });
  if (options.append) {
    await appendFile(resolved, text, "utf8");
  } else {
    await writeFile(resolved, text, "utf8");
  }
}

async function filesPatch(target, search, replace) {
  await assertPermission("files_patch");
  const { resolved, relative } = await resolveFileTarget(target, "edit");
  const current = await readFile(resolved, "utf8");
  if (!current.includes(search)) throw new Error("Искомый фрагмент не найден.");
  const next = current.split(search).join(replace);
  const replacements = current.split(search).length - 1;
  await maybeConfirmFileOperation("patch", relative, unifiedPreview(current, next));
  await writeFile(resolved, next, "utf8");
  return { path: relative, replacements };
}

async function extractReadableText(file) {
  const ext = path.extname(file).toLocaleLowerCase("ru-RU");
  if (ext === ".docx") return extractDocxText(await readFile(file));
  if (ext === ".xlsx") return extractXlsxText(await readFile(file));
  if (ext === ".pptx") return extractPptxText(await readFile(file));
  if (ext === ".pdf") return extractPdfText(await readFile(file));
  return readFile(file, "utf8");
}

function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const documentXml = entries.get("word/document.xml") || "";
  const footnotes = [...entries.entries()].filter(([name]) => name.startsWith("word/") && /footnotes|endnotes|comments/.test(name)).map(([, text]) => text).join("\n");
  return xmlToText(`${documentXml}\n${footnotes}`);
}

function extractXlsxText(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const chunks = [];
  for (const [name, xml] of entries.entries()) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) continue;
    chunks.push(name);
    const resolved = xml.replace(/<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g, (_, index) => ` ${sharedStrings[Number(index)] || ""} `);
    chunks.push(xmlToText(resolved));
  }
  return normalizeExtractedText(chunks.join("\n"));
}

function extractPptxText(buffer) {
  const entries = readZipEntries(buffer);
  const slides = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  return normalizeExtractedText(slides.map(([name, xml]) => `${name}\n${xmlToText(xml)}`).join("\n\n"));
}

function extractPdfText(buffer) {
  const latin = buffer.toString("latin1");
  const chunks = [];
  const streamPattern = /<<(?:.|\r|\n)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamPattern.exec(latin))) {
    const dictionary = latin.slice(Math.max(0, match.index - 500), match.index + 500);
    let data = Buffer.from(match[1], "latin1");
    if (/FlateDecode/.test(dictionary)) {
      try {
        data = inflateSync(data);
      } catch {
        try {
          data = inflateRawSync(data);
        } catch {
          // Leave compressed stream unreadable.
        }
      }
    }
    chunks.push(extractPdfStrings(data.toString("latin1")));
  }
  chunks.push(extractPdfStrings(latin));
  return normalizeExtractedText(chunks.join("\n"));
}

function extractPdfStrings(text) {
  const strings = [];
  for (const match of text.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*T[jJ]?/g)) {
    strings.push(unescapePdfString(match[1]));
  }
  for (const match of text.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const item of match[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)) {
      strings.push(unescapePdfString(item[1]));
    }
  }
  return strings.join(" ");
}

function unescapePdfString(value) {
  const unescaped = value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  return decodePossiblyUtf8(unescaped);
}

function decodePossiblyUtf8(value) {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset < buffer.length - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.subarray(dataStart, dataEnd);
    try {
      const data = method === 8 ? inflateRawSync(compressed) : compressed;
      entries.set(name.replace(/\\/g, "/"), data.toString("utf8"));
    } catch {
      // Skip unreadable ZIP entry.
    }
    offset = dataEnd;
  }
  return entries;
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => xmlToText(match[0]));
}

function xmlToText(xml) {
  return normalizeExtractedText(String(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>|<a:br\/>|<\/w:p>|<\/a:p>|<\/row>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"));
}

function normalizeExtractedText(text) {
  return String(text)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function maybeConfirmFileOperation(operation, target, preview) {
  const config = await loadConfig();
  const approvals = config.files?.approvals || "on-write";
  const needsApproval = approvals === "always" || approvals === "on-write" || (approvals === "on-danger" && operation !== "write");
  if (!needsApproval) return;
  console.log(`Файловая операция: ${operation} ${target}`);
  if (preview) console.log(String(preview).slice(0, 2000));
  const ok = await confirm("Продолжить? [y/N] ");
  if (!ok) throw new Error("Файловая операция отменена.");
}

function listTasks() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, title, COALESCE(command, '-') AS command, status FROM tasks ORDER BY status, id DESC LIMIT 100").all();
  } finally {
    db.close();
  }
}

function addTask(title, command = "") {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO tasks(title, command) VALUES (?, ?)").run(title, command);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function getTask(id) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!row) throw new Error(`Задача не найдена: ${id}`);
    return row;
  } finally {
    db.close();
  }
}

function updateTaskStatus(id, status) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  } finally {
    db.close();
  }
}

function saveArtifact(kind, title, file = "", meta = {}) {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO artifacts(kind, title, file, meta_json) VALUES (?, ?, ?, ?)").run(kind, title || kind, file || "", JSON.stringify(meta));
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function listArtifacts() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, kind, title, file, created_at FROM artifacts ORDER BY id DESC LIMIT 100").all();
  } finally {
    db.close();
  }
}

function getArtifact(id) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
    if (!row) throw new Error(`Artifact не найден: ${id}`);
    return row;
  } finally {
    db.close();
  }
}

function recordToolTrace(runId, tool, args, status, summary) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO tool_traces(run_id, tool, args_json, status, summary) VALUES (?, ?, ?, ?, ?)").run(runId, tool, JSON.stringify(args), status, summary || "");
  } finally {
    db.close();
  }
}

function recordUsage({ providerConfig, question, answer, sessionId, profile }) {
  try {
    initDatabase();
    const inputChars = String(question || "").length;
    const outputChars = String(answer || "").length;
    const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);
    const estimatedCostUsd = estimateCost(providerConfig, estimatedTokens);
    const db = openDatabase();
    try {
      db.prepare(`
        INSERT INTO usage_events(provider, model, profile, input_chars, output_chars, estimated_tokens, estimated_cost_usd, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        providerConfig.provider || "",
        providerConfig.model || "",
        profile || providerConfig.name || "",
        inputChars,
        outputChars,
        estimatedTokens,
        estimatedCostUsd,
        sessionId || null,
      );
    } finally {
      db.close();
    }
  } catch {
    // Usage accounting must not break the main answer path.
  }
}

function estimateCost(providerConfig, tokens) {
  if (!providerConfig || providerConfig.provider === "iola" || providerConfig.provider === "ollama" || providerConfig.provider === "codex") return 0;
  const perMillion = providerConfig.provider === "openrouter" ? 0.25 : 0.4;
  return Math.round((tokens / 1_000_000) * perMillion * 1_000_000) / 1_000_000;
}

function getUsageSummary() {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT COUNT(*) AS requests, COALESCE(SUM(estimated_tokens),0) AS tokens, COALESCE(SUM(estimated_cost_usd),0) AS cost FROM usage_events").get();
    return { requests: row.requests || 0, estimated_tokens: row.tokens || 0, estimated_cost_usd: Number(row.cost || 0).toFixed(6) };
  } finally {
    db.close();
  }
}

function getUsageByModel() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT provider, model, COUNT(*) AS requests, COALESCE(SUM(estimated_tokens),0) AS tokens, printf('%.6f', COALESCE(SUM(estimated_cost_usd),0)) AS cost
      FROM usage_events GROUP BY provider, model ORDER BY requests DESC
    `).all();
  } finally {
    db.close();
  }
}

function getUsageBySession() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT COALESCE(session_id, 0) AS session_id, COUNT(*) AS requests, COALESCE(SUM(estimated_tokens),0) AS tokens, printf('%.6f', COALESCE(SUM(estimated_cost_usd),0)) AS cost
      FROM usage_events GROUP BY session_id ORDER BY requests DESC LIMIT 100
    `).all();
  } finally {
    db.close();
  }
}

function listBudgets() {
  initDatabase();
  const db = openDatabase();
  try {
    const spent = Number(db.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) AS spent FROM usage_events WHERE created_at >= datetime('now','-1 day')").get()?.spent || 0);
    return db.prepare("SELECT scope, amount_usd, updated_at FROM budgets ORDER BY scope").all()
      .map((row) => ({ ...row, spent_usd: row.scope === "daily" ? spent.toFixed(6) : "-" }));
  } finally {
    db.close();
  }
}

function setBudget(scope, amountUsd) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO budgets(scope, amount_usd) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET amount_usd = excluded.amount_usd, updated_at = datetime('now')").run(scope, amountUsd);
  } finally {
    db.close();
  }
}

function listTrace(limit = 20) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, run_id, tool, status, summary, created_at FROM tool_traces ORDER BY id DESC LIMIT ?").all(limit);
  } finally {
    db.close();
  }
}

function buildTrajectoryRows(limit = 500) {
  initDatabase();
  const db = openDatabase();
  try {
    const history = db.prepare("SELECT id, created_at, 'ask' AS type, question AS summary, provider, model FROM ask_history ORDER BY id DESC LIMIT ?").all(limit);
    const traces = db.prepare("SELECT id, created_at, 'tool' AS type, tool || ': ' || COALESCE(summary,'') AS summary, status, run_id FROM tool_traces ORDER BY id DESC LIMIT ?").all(limit);
    return [...history, ...traces]
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
      .slice(0, limit);
  } finally {
    db.close();
  }
}

function getTraceRun(runId) {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM tool_traces WHERE run_id = ? ORDER BY id ASC").all(runId);
  } finally {
    db.close();
  }
}

async function createSnapshot() {
  const config = await loadConfig();
  const workspace = resolveWorkspaceRoot(config);
  const snapshotsDir = path.join(CONFIG_DIR, "snapshots");
  await mkdir(snapshotsDir, { recursive: true });
  const target = path.join(snapshotsDir, `snapshot-${Date.now()}`);
  await cp(workspace, target, {
    recursive: true,
    filter: (source) => !isBlockedPathForConfig(source, config) && !source.includes(`${path.sep}node_modules${path.sep}`),
  });
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO snapshots(workspace, path) VALUES (?, ?)").run(workspace, target);
    return { id: Number(result.lastInsertRowid), workspace, path: target };
  } finally {
    db.close();
  }
}

async function createSandboxCopy(name = "") {
  const config = await loadConfig();
  const workspace = resolveWorkspaceRoot(config);
  const sandboxesDir = path.join(CONFIG_DIR, "sandboxes");
  await mkdir(sandboxesDir, { recursive: true });
  const safeName = name ? String(name).replace(/[^a-zA-Z0-9_-]+/g, "-") : `sandbox-${Date.now()}`;
  const target = path.join(sandboxesDir, safeName);
  await rm(target, { recursive: true, force: true });
  await cp(workspace, target, {
    recursive: true,
    filter: (source) => !isBlockedPathForConfig(source, config) && !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}.git${path.sep}`),
  });
  const id = saveArtifact("sandbox", safeName, target, { workspace });
  return { id, workspace, path: target };
}

function listSnapshots() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, workspace, path, created_at FROM snapshots ORDER BY id DESC LIMIT 50").all();
  } finally {
    db.close();
  }
}

async function restoreSnapshot(id) {
  initDatabase();
  const db = openDatabase();
  let row;
  try {
    row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id);
  } finally {
    db.close();
  }
  if (!row) throw new Error(`Snapshot не найден: ${id}`);
  await cp(row.path, row.workspace, { recursive: true, force: true });
}

async function stageFileChange(kind, target, afterText, beforeText = null) {
  const { resolved, relative } = await resolveFileTarget(target, kind === "patch" ? "edit" : "write");
  const before = beforeText ?? (existsSync(resolved) ? await readFile(resolved, "utf8").catch(() => "") : "");
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO pending_changes(kind, target, before_text, after_text) VALUES (?, ?, ?, ?)").run(kind, relative, before, afterText);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function listChanges() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT id, kind, target, status, created_at FROM pending_changes ORDER BY id DESC LIMIT 100").all();
  } finally {
    db.close();
  }
}

function getChange(id) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM pending_changes WHERE id = ?").get(id);
    if (!row) throw new Error(`Изменение не найдено: ${id}`);
    return row;
  } finally {
    db.close();
  }
}

function updateChangeStatus(id, status) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("UPDATE pending_changes SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN datetime('now') ELSE applied_at END WHERE id = ?").run(status, status, id);
  } finally {
    db.close();
  }
}

async function applyChange(id) {
  const change = getChange(id);
  if (change.status !== "pending") throw new Error(`Изменение уже не pending: ${change.status}`);
  await filesWrite(change.target, change.after_text);
  updateChangeStatus(id, "applied");
}

async function importDataFile(target, dataset) {
  const text = await filesRead(target, { maxBytes: 5_000_000 });
  const ext = path.extname(target).toLocaleLowerCase("ru-RU");
  let rows = [];
  if (ext === ".json") {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : normalizeItems(parsed);
  } else if (ext === ".csv") {
    rows = parseCsv(text);
  } else {
    throw new Error("Поддерживается импорт JSON и CSV.");
  }
  saveCustomRecords(dataset, rows);
  return rows.length;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quote = !quote;
    else if (char === "," && !quote) {
      result.push(current);
      current = "";
    } else current += char;
  }
  result.push(current);
  return result.map((value) => value.trim());
}

function saveCustomRecords(dataset, rows) {
  initDatabase();
  const db = openDatabase();
  try {
    const insert = db.prepare("INSERT INTO custom_records(dataset, record_key, record_json, searchable_text) VALUES (?, ?, ?, ?) ON CONFLICT(dataset, record_key) DO UPDATE SET record_json = excluded.record_json, searchable_text = excluded.searchable_text, imported_at = datetime('now')");
    const insertFts = db.prepare("INSERT INTO custom_records_fts(dataset, record_key, searchable_text) VALUES (?, ?, ?)");
    db.prepare("DELETE FROM custom_records_fts WHERE dataset = ?").run(dataset);
    rows.forEach((row, index) => {
      const key = String(row.id || row.inn || index + 1);
      const json = JSON.stringify(row);
      const text = json.toLocaleLowerCase("ru-RU");
      insert.run(dataset, key, json, text);
      insertFts.run(dataset, key, text);
    });
  } finally {
    db.close();
  }
}

async function indexFolder(target, options = {}) {
  const rows = await filesTree(target, { depth: Number(options.depth || 5), limit: Number(options.limit || 1000) });
  let count = 0;
  for (const row of rows.filter((item) => item.type === "file" && INDEXABLE_EXTENSIONS.test(item.path))) {
    try {
      const text = await filesRead(row.path, { maxBytes: 1_000_000 });
      saveIndexedDoc(row.path, path.basename(row.path), text);
      count += 1;
    } catch {
      // Skip unreadable files.
    }
  }
  return count;
}

function saveIndexedDoc(file, title, content) {
  initDatabase();
  const db = openDatabase();
  try {
    const result = db.prepare("INSERT INTO doc_index(file, title, content) VALUES (?, ?, ?)").run(file, title, content);
    db.prepare("INSERT INTO doc_index_fts(rowid, file, title, content) VALUES (?, ?, ?, ?)").run(Number(result.lastInsertRowid), file, title, content);
  } finally {
    db.close();
  }
}

function getIndexStatus() {
  initDatabase();
  const db = openDatabase();
  try {
    const docs = db.prepare("SELECT COUNT(*) AS count FROM doc_index").get();
    return { docs: docs?.count || 0 };
  } finally {
    db.close();
  }
}

function searchDocs(query, limit = 20) {
  initDatabase();
  const db = openDatabase();
  try {
    const rows = db.prepare("SELECT file, title, snippet(doc_index_fts, 2, '[', ']', '...', 16) AS snippet FROM doc_index_fts WHERE doc_index_fts MATCH ? LIMIT ?").all(toFtsQuery(query), limit);
    return rows;
  } finally {
    db.close();
  }
}

function listPlugins() {
  initDatabase();
  const db = openDatabase();
  try {
    return db.prepare("SELECT name, source, COALESCE(command, '-') AS command FROM plugins ORDER BY name").all();
  } finally {
    db.close();
  }
}

function savePlugin(name, source, command) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("INSERT INTO plugins(name, source, command) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET source = excluded.source, command = excluded.command").run(name, source, command);
  } finally {
    db.close();
  }
}

function getPlugin(name) {
  initDatabase();
  const db = openDatabase();
  try {
    const row = db.prepare("SELECT * FROM plugins WHERE name = ?").get(name);
    if (!row) throw new Error(`Plugin не найден: ${name}`);
    return row;
  } finally {
    db.close();
  }
}

function deletePlugin(name) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM plugins WHERE name = ?").run(name);
  } finally {
    db.close();
  }
}

function unifiedPreview(before, after) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const output = ["--- before", "+++ after"];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < Math.min(max, 80); index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      if (beforeLines[index] !== undefined) output.push(`- ${beforeLines[index]}`);
      if (afterLines[index] !== undefined) output.push(`+ ${afterLines[index]}`);
    }
  }
  return output.join("\n");
}

async function executeRpc(method, options = {}) {
  if (method === "status") {
    return { db: getDbStatus(), sync: getSyncStatus(), activeProfile: getActiveProfileName(await loadConfig()) };
  }
  if (method === "search") {
    await ensureLocalData();
    return searchLocalRecords(options.query || options.search || options._?.join(" ") || "", {
      dataset: options.dataset || "all",
      limit: Number(options.limit || 20),
      fts: options.fts !== false,
    });
  }
  if (method === "card") {
    await ensureLocalData();
    return findCard(options.query || options.search || options._?.join(" ") || "");
  }
  if (method === "quality") {
    await ensureLocalData();
    return runQuality(options.scope || "all");
  }
  if (method === "sync") {
    await assertPermission("sync");
    return syncDataset(options.dataset || "schools");
  }
  if (method === "files.tree") {
    return filesTree(options.path || ".", options);
  }
  if (method === "files.read") {
    return { path: options.path, text: await filesRead(options.path, options) };
  }
  if (method === "files.search") {
    return filesSearch(options.query || options.search || "", options);
  }
  if (method === "index.search") {
    return searchDocs(options.query || options.search || "", Number(options.limit || 20));
  }
  throw new Error(`RPC method неизвестен: ${method}. Доступно: status, search, card, quality, sync, files.tree, files.read, files.search, index.search.`);
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
  const sanitized = sanitizeConfig(value);
  const errors = validateConfig(sanitized);
  if (errors.length > 0) {
    throw new Error(`Конфигурация не сохранена: ${errors.join("; ")}`);
  }
  await mkdir(CONFIG_DIR, { recursive: true });
  if (existsSync(CONFIG_FILE)) {
    await copyFile(CONFIG_FILE, LAST_GOOD_CONFIG_FILE).catch(() => {});
  }
  await writeFile(CONFIG_FILE, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
}

async function loadConfig() {
  let config = DEFAULT_AI_CONFIG;
  for (const layer of [CONFIG_FILE, PROJECT_CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    const value = await readConfigLayer(layer);
    if (value) config = mergeConfig(config, value);
  }
  return sanitizeConfig(config);
}

async function loadConfigLayers() {
  const files = [
    { scope: "defaults", file: "builtin", value: DEFAULT_AI_CONFIG, exists: true },
    { scope: "user", file: CONFIG_FILE },
    { scope: "project", file: PROJECT_CONFIG_FILE },
    { scope: "local", file: LOCAL_CONFIG_FILE },
  ];
  const rows = [];
  for (const layer of files) {
    if (layer.scope === "defaults") {
      rows.push({ ...layer, errors: validateConfig(layer.value) });
      continue;
    }
    const value = await readConfigLayer(layer.file);
    rows.push({ ...layer, exists: Boolean(value), value, errors: value ? validateConfig(sanitizeConfig(mergeConfig(DEFAULT_AI_CONFIG, value))) : [] });
  }
  rows.push({ scope: "runtime", file: "process.env", exists: true, value: { IOLA_API_BASE_URL: process.env.IOLA_API_BASE_URL || "", IOLA_MCP_BASE_URL: process.env.IOLA_MCP_BASE_URL || "" }, errors: [] });
  return rows;
}

async function readConfigLayer(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function readConfigLayerSync(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
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
    permissions: {
      ...base.permissions,
      ...(override.permissions || {}),
      localTools: {
        ...(base.permissions?.localTools || {}),
        ...(override.permissions?.localTools || {}),
      },
    },
    files: {
      ...base.files,
      ...(override.files || {}),
    },
    memory: {
      ...base.memory,
      ...(override.memory || {}),
    },
    skills: {
      ...base.skills,
      ...(override.skills || {}),
    },
    toolsets: {
      ...base.toolsets,
      ...(override.toolsets || {}),
    },
    daemon: {
      ...base.daemon,
      ...(override.daemon || {}),
    },
    mcp: {
      ...base.mcp,
      ...(override.mcp || {}),
      servers: {
        ...(base.mcp?.servers || {}),
        ...(override.mcp?.servers || {}),
      },
    },
    cron: {
      ...base.cron,
      ...(override.cron || {}),
    },
    hooks: {
      ...base.hooks,
      ...(override.hooks || {}),
    },
    subagents: {
      ...(base.subagents || {}),
      ...(override.subagents || {}),
    },
    workspaces: {
      ...(base.workspaces || {}),
      ...(override.workspaces || {}),
    },
    hooksTrusted: override.hooksTrusted ?? base.hooksTrusted,
    local: override.local ?? base.local,
  };
}

function sanitizeConfig(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (next.permissions?.localTools && typeof next.permissions.localTools === "object") {
    for (const tool of Object.keys(next.permissions.localTools)) {
      if (!ALL_TOOL_ALIASES.includes(tool)) {
        delete next.permissions.localTools[tool];
      }
    }
  }
  if (Array.isArray(next.skills?.enabled) && next.skills.enabled.includes("open-data") && !next.skills.enabled.includes("education")) {
    next.skills.enabled = ["education", ...next.skills.enabled];
  }
  return next;
}

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") errors.push("config must be object");
  if (!config.api?.baseUrl) errors.push("api.baseUrl обязателен");
  if (!config.api?.mcpBaseUrl) errors.push("api.mcpBaseUrl обязателен");
  if (!config.ai?.profiles || typeof config.ai.profiles !== "object") errors.push("ai.profiles обязателен");
  if (config.ai?.activeProfile && !config.ai.profiles?.[config.ai.activeProfile]) errors.push(`ai.activeProfile не найден в profiles: ${config.ai.activeProfile}`);
  for (const [name, profile] of Object.entries(config.ai?.profiles || {})) {
    if (!["iola", "ollama", "openai", "openrouter", "codex"].includes(profile.provider)) errors.push(`ai.profiles.${name}.provider неизвестен`);
    if (profile.provider !== "codex" && profile.provider !== "iola" && !profile.baseUrl) errors.push(`ai.profiles.${name}.baseUrl обязателен`);
  }
  for (const tool of Object.keys(config.permissions?.localTools || {})) {
    if (!ALL_TOOL_ALIASES.includes(tool)) errors.push(`permissions.localTools.${tool} неизвестен`);
  }
  for (const toolset of config.toolsets?.enabled || []) {
    if (!TOOLSETS[toolset]) errors.push(`toolsets.enabled содержит неизвестный toolset: ${toolset}`);
  }
  return errors;
}

function configSchema() {
  return {
    type: "object",
    required: ["api", "ai"],
    properties: {
      api: { required: ["baseUrl", "mcpBaseUrl"] },
      ai: { required: ["activeProfile", "profiles"], providers: ["iola", "ollama", "openai", "openrouter", "codex"] },
      permissions: { localTools: ALL_LOCAL_TOOLS, runtime: ["readFiles", "writeFiles", "editFiles", "deleteFiles", "sync", "externalApi", "externalAi", "codex"] },
      toolsets: { available: Object.keys(TOOLSETS) },
      files: { modes: ["locked", "read-only", "workspace-write", "full-access"], approvals: ["never", "on-write", "on-danger", "always"] },
      skills: { enabled: "array of skill names" },
      daemon: { host: "127.0.0.1", port: DAEMON_PORT },
    },
  };
}

function getActiveProfileName(config) {
  if (config.ai.activeProfile && config.ai.profiles?.[config.ai.activeProfile]) {
    return config.ai.activeProfile;
  }

  const provider = config.ai.provider === "ollama" || config.ai.provider === "iola" ? "local" : config.ai.provider;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      cwd: options.cwd,
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "@iola_adm/iola-cli",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})${text ? `\n${text}` : ""}`);
  }

  return response.json();
}

function parseJsonOrSse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const dataLines = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) throw new Error(`Unexpected MCP response: ${trimmed.slice(0, 300)}`);
  return JSON.parse(dataLines.join("\n"));
}

async function publicMcpRequest(method, params = undefined) {
  const baseUrl = await getMcpBaseUrl();
  const body = { jsonrpc: "2.0", id: 1, method };
  if (params !== undefined) body.params = params;
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP ${method} failed: ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }
  const payload = parseJsonOrSse(text);
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return payload?.result;
}

async function callPublicMcpTool(name, args = {}) {
  const result = await publicMcpRequest("tools/call", { name, arguments: args });
  if (result?.structuredContent) return result.structuredContent;
  if (result?.structured_content) return result.structured_content;
  const text = result?.content?.find?.((item) => item.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
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
