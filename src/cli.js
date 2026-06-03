import { execFile, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { appendFile, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import readline from "node:readline/promises";
import { Readable } from "node:stream";
import { stdin as input, stdout as output } from "node:process";
import { DatabaseSync } from "node:sqlite";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";
const AI_RELAY_BASE_URL = process.env.IOLA_AI_RELAY_BASE_URL || `${API_BASE_URL}/ai/relay`;
const AI_NETWORK_MODE = process.env.IOLA_AI_NETWORK_MODE || "";
const MIN_NODE_VERSION = "22.5.0";
const CONFIG_DIR = path.join(os.homedir(), ".iola");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LAST_GOOD_CONFIG_FILE = path.join(CONFIG_DIR, "config.last-good.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");
const DB_FILE = path.join(CONFIG_DIR, "iola.db");
const DB_SCHEMA_VERSION = 8;
const IOLA_LOCAL_MODEL = "iola-router:qwen3-1.7b-v4-q8";
const IOLA_LOCAL_OLLAMA_MODEL = IOLA_LOCAL_MODEL;
const IOLA_ROUTER_HF_REPO = process.env.IOLA_ROUTER_HF_REPO || "LMSerg/iola-1b-router-2026-05-28-merged";
const IOLA_ROUTER_GGUF_REPO = process.env.IOLA_ROUTER_GGUF_REPO || "LMSerg/iola-router-qwen3-1.7b-v4-gguf";
const IOLA_ROUTER_GGUF_FILE = process.env.IOLA_ROUTER_GGUF_FILE || "iola-router-qwen3-1.7b-v4-q8_0.gguf";
const IOLA_MODEL_DIR = path.join(CONFIG_DIR, "models", "router");
const IOLA_MODEL_RUNTIME_DIR = path.join(CONFIG_DIR, "model-runtime");
const IOLA_MODEL_RUNNER = path.resolve(__dirname, "iola_hf_runner.py");
const PROJECT_IOLA_DIR = path.join(process.cwd(), ".iola");
const PROJECT_CONFIG_FILE = path.join(PROJECT_IOLA_DIR, "config.json");
const LOCAL_CONFIG_FILE = path.join(PROJECT_IOLA_DIR, "local.json");
const BROWSER_RUNTIME_DIR = path.join(CONFIG_DIR, "browser-runtime");
const BROWSER_RUNTIME_PACKAGE = path.join(BROWSER_RUNTIME_DIR, "node_modules", "playwright", "package.json");
const CLOUD_DEFAULT_REMOTE_DIR = "/IOLA";
const YANDEX_OAUTH_AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
const YANDEX_OAUTH_REDIRECT_URL = "https://oauth.yandex.ru/verification_code";
const YANDEX_CONNECTOR_CLIENT_ID = process.env.IOLA_YANDEX_OAUTH_CLIENT_ID || process.env.YANDEX_OAUTH_CLIENT_ID || "9b7c9bcf81e8491f9bd36ba44fa76128";
const YANDEX_CONNECTOR_ORGANIZER_CLIENT_ID = process.env.IOLA_YANDEX_ORGANIZER_OAUTH_CLIENT_ID || "4ab53d8557e64ac98534ed60295cb138";
const YANDEX_CONNECTOR_REDIRECT_HOST = "127.0.0.1";
const YANDEX_CONNECTOR_REDIRECT_PORT = Number(process.env.IOLA_YANDEX_OAUTH_PORT || 18791);
const YANDEX_CONNECTOR_REDIRECT_PATH = "/yandex/oauth/callback";
const YANDEX_CONNECTOR_SERVICES = {
  identity: {
    title: "Yandex ID",
    category: "identity",
    scope: "login:info login:email",
    status: "ready",
    hint: "профиль, логин и email пользователя",
  },
  disk: {
    title: "Яндекс Диск",
    category: "cloud-storage",
    scope: "cloud_api:disk.read cloud_api:disk.write cloud_api:disk.info",
    status: "ready",
    hint: "файлы, папка /IOLA, загрузка, скачивание, публичные ссылки",
  },
  mail: {
    title: "Яндекс Почта",
    category: "mail",
    scope: "mail:imap_full mail:smtp",
    status: "research",
    hint: "чтение/поиск писем и отправка только после подтверждения",
  },
  calendar: {
    title: "Яндекс Календарь",
    category: "calendar",
    scope: "calendar:all",
    status: "research",
    hint: "события и напоминания, протокол требует отдельной проверки",
  },
  contacts: {
    title: "Яндекс Контакты",
    category: "contacts",
    scope: "addressbook:all",
    status: "research",
    hint: "адресная книга и контакты, требует проверки API",
  },
  docs: {
    title: "Яндекс Документы / 360",
    category: "documents",
    scope: "cloud_api:disk.read cloud_api:disk.write",
    status: "research",
    hint: "обычно работает через файлы на Диске",
  },
  telemost: {
    title: "Яндекс Телемост",
    category: "meetings",
    scope: "calendar:all",
    status: "research",
    hint: "встречи через календарное событие, если поддерживается",
  },
  cloud: {
    title: "Yandex Cloud Connector",
    category: "cloud-platform",
    scope: "",
    status: "ready",
    hint: "геокодинг и YandexGPT через ключи Yandex Cloud",
  },
  maps: {
    title: "Яндекс Геокодер",
    category: "maps",
    scope: "",
    status: "ready",
    hint: "адреса, координаты, маршруты и ссылки на карты",
  },
  taxi: {
    title: "Яндекс Go / Такси",
    category: "mobility",
    scope: "",
    status: "ready",
    hint: "deeplink и маршрут; заказ через API ожидает clid/apikey",
  },
  market: {
    title: "Яндекс Маркет",
    category: "shopping",
    scope: "",
    status: "backlog",
    hint: "только поиск и список покупок, без корзины и оплаты",
  },
  delivery: {
    title: "Яндекс Доставка",
    category: "delivery",
    scope: "",
    status: "backlog",
    hint: "только подготовка заявки/ссылки, без оформления и оплаты",
  },
};
const YANDEX_CONNECTOR_OAUTH_APPS = [
  {
    id: "core",
    title: "IOLA CLI A",
    clientId: YANDEX_CONNECTOR_CLIENT_ID,
    services: ["identity", "disk", "mail", "docs"],
  },
  {
    id: "organizer",
    title: "IOLA CLI B",
    clientId: YANDEX_CONNECTOR_ORGANIZER_CLIENT_ID,
    services: ["calendar", "contacts", "telemost"],
  },
];
const INDEXABLE_EXTENSIONS = /\.(md|txt|csv|json|html|docx|xlsx|pptx|pdf)$/i;
const LOCAL_TOOLS = ["search_data", "search_entities", "resolve_entity_field", "get_card", "export_report", "file_read", "browser_open", "get_current_date"];
const LEGACY_LOCAL_TOOLS = ["search_local", "export_data", "run_report", "save_view"];
const FILE_TOOLS = ["files_tree", "files_read", "files_search", "files_write", "files_patch"];
const USER_SKILL_TOOLS = ["user_skill_create", "user_skill_update", "user_skill_enable", "user_skill_disable", "user_skill_delete", "user_skill_list", "user_skill_templates", "user_skill_validate", "user_skill_preview"];
const YANDEX_TOOLS = [
  "yandex_identity_me",
  "yandex_disk_info",
  "yandex_disk_ls",
  "yandex_disk_mkdir",
  "yandex_disk_find",
  "yandex_disk_stat",
  "yandex_disk_exists",
  "yandex_disk_read_text",
  "yandex_disk_save_text",
  "yandex_disk_upload",
  "yandex_disk_download",
  "yandex_disk_move",
  "yandex_disk_copy",
  "yandex_disk_rename",
  "yandex_disk_share",
  "yandex_disk_share_qr",
  "yandex_disk_share_email",
  "yandex_disk_package_share_email",
  "yandex_disk_unshare",
  "yandex_disk_delete",
  "yandex_disk_trash_list",
  "yandex_disk_restore",
  "yandex_disk_empty_trash",
  "yandex_mail_status",
  "yandex_mail_folders",
  "yandex_mail_list",
  "yandex_mail_search",
  "yandex_mail_read",
  "yandex_mail_send",
  "yandex_mail_reply",
  "yandex_mail_forward",
  "yandex_mail_delete",
  "yandex_mail_mark",
  "yandex_mail_save_to_disk",
  "yandex_mail_create_calendar_event",
  "yandex_mail_sender_to_contact",
  "yandex_mail_city_context",
  "yandex_mail_map_addresses",
  "yandex_mail_create_task",
  "yandex_mail_meeting_pack",
  "yandex_calendar_status",
  "yandex_calendar_calendars",
  "yandex_calendar_create_event",
  "yandex_calendar_list",
  "yandex_calendar_get",
  "yandex_calendar_search",
  "yandex_calendar_update",
  "yandex_calendar_move",
  "yandex_calendar_delete",
  "yandex_calendar_create_recurring_event",
  "yandex_calendar_add_reminder",
  "yandex_docs_status",
  "yandex_docs_list",
  "yandex_docs_find",
  "yandex_docs_create_text",
  "yandex_docs_read",
  "yandex_docs_share",
  "yandex_docs_rename",
  "yandex_docs_delete",
  "yandex_docs_save_answer",
  "yandex_contacts_status",
  "yandex_contacts_list",
  "yandex_contacts_search",
  "yandex_contacts_get",
  "yandex_contacts_create",
  "yandex_contacts_update",
  "yandex_contacts_delete",
  "yandex_contacts_add_email",
  "yandex_contacts_add_phone",
  "yandex_contacts_add_address",
  "yandex_contacts_add_note",
  "yandex_contacts_add_birthday",
  "yandex_contacts_add_org",
  "yandex_contacts_remove_email",
  "yandex_contacts_remove_phone",
  "yandex_contacts_export_vcard",
  "yandex_contacts_export_csv",
  "yandex_contacts_import_vcard",
  "yandex_contacts_import_csv",
  "yandex_contacts_find_incomplete",
  "yandex_contacts_find_duplicates",
  "yandex_contacts_backup_to_disk",
  "yandex_contacts_birthdays_to_calendar",
  "yandex_contact_send_mail",
  "yandex_contact_send_disk_link_qr",
  "yandex_contact_create_disk_folder",
  "yandex_contact_create_calendar_event",
  "yandex_contact_create_telemost_event",
  "yandex_contact_from_public_entity",
  "yandex_telemost_status",
  "yandex_telemost_create_event",
  "yandex_contact_full_pack",
  "yandex_daily_digest",
  "yandex_calendar_reminders_tick",
  "yandex_disk_maintenance_tick",
  "yandex_cloud_status",
  "yandex_go_deeplink",
];
const ALL_LOCAL_TOOLS = [...LOCAL_TOOLS, ...FILE_TOOLS, ...YANDEX_TOOLS, ...USER_SKILL_TOOLS];
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
  yandex: {
    description: "Сервисы Яндекса через Yandex Connector: ID, Диск, Почта, Календарь, Контакты.",
    permissions: {
      externalApi: true,
      localTools: Object.fromEntries(YANDEX_TOOLS.map((tool) => [tool, true])),
    },
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
  "user-skills": {
    description: "Создание и управление пользовательскими skills на базе встроенных tools.",
    permissions: {
      writeFiles: true,
      localTools: Object.fromEntries(USER_SKILL_TOOLS.map((tool) => [tool, true])),
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
const MAIN_OPENROUTER_DEVELOPERS = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google"],
  ["qwen", "Qwen / Alibaba"],
  ["deepseek", "DeepSeek"],
  ["meta-llama", "Meta / Llama"],
  ["mistralai", "Mistral AI"],
  ["x-ai", "xAI"],
  ["cohere", "Cohere"],
  ["microsoft", "Microsoft"],
  ["perplexity", "Perplexity"],
];
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
    aiRelayBaseUrl: "https://apiiola.yasg.ru/api/v1/ai/relay",
  },
  ai: {
    activeProfile: "local",
    provider: "iola",
    model: IOLA_LOCAL_MODEL,
    profiles: {
      local: {
        provider: "iola",
        model: IOLA_LOCAL_MODEL,
        runtime: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        ggufRepo: IOLA_ROUTER_GGUF_REPO,
        ggufFile: IOLA_ROUTER_GGUF_FILE,
        modelDir: IOLA_MODEL_DIR,
      },
      openai: {
        provider: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        networkMode: "gateway",
      },
      openrouter: {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        baseUrl: "https://openrouter.ai/api/v1",
        networkMode: "gateway",
      },
      yandexgpt: {
        provider: "yandexgpt",
        model: "yandexgpt-lite/latest",
        baseUrl: "https://llm.api.cloud.yandex.net/foundationModels/v1",
        networkMode: "direct",
      },
      gigachat: {
        provider: "gigachat",
        model: "GigaChat-2",
        baseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
        authUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        scope: "GIGACHAT_API_PERS",
        networkMode: "direct",
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
      yandex_identity_me: true,
      yandex_disk_info: true,
      yandex_disk_ls: true,
      yandex_disk_mkdir: true,
      yandex_disk_find: true,
      yandex_disk_save_text: true,
      yandex_disk_upload: false,
      yandex_disk_download: false,
      yandex_disk_share: false,
      yandex_disk_unshare: false,
      yandex_disk_delete: false,
      yandex_mail_status: true,
      yandex_mail_list: true,
      yandex_mail_search: true,
      yandex_mail_read: true,
      yandex_mail_send: false,
      yandex_calendar_status: true,
      yandex_calendar_create_event: false,
      yandex_calendar_list: true,
      yandex_contacts_status: true,
      yandex_contacts_list: true,
      yandex_contacts_search: true,
      yandex_telemost_create_event: false,
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
    enabled: ["data-read", "reports", "sync", "ai", "yandex", "user-skills"],
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
    enabled: ["education", "open-data", "geo", "personal-docs", "reports", "local-model", "local-files", "browser-agent", "yandex-services", "user-skills"],
  },
  cloud: {
    activeProvider: "",
    providers: {
      "yandex-disk": { root: CLOUD_DEFAULT_REMOTE_DIR },
      "mailru-cloud": { root: CLOUD_DEFAULT_REMOTE_DIR },
    },
  },
  yandex: {
    authorizedServices: [],
    enabledServices: [],
    categories: {},
    oauth: {
      clientId: "",
      redirectUrl: YANDEX_OAUTH_REDIRECT_URL,
    },
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
  { command: "/cloud status", description: "облачные диски" },
  { command: "/yandex", description: "выбор сервисов Yandex Connector" },
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
  { command: "/delete", description: "удалить локальные данные iola-cli" },
  { command: "/layers", description: "слои данных" },
  { command: "/data schools --limit 10", description: "данные слоя" },
  { command: "/schools --limit 10", description: "школы" },
  { command: "/kindergartens --search 29", description: "детские сады" },
  { command: "/search лицей --limit 3", description: "поиск" },
  { command: "/mcp-info", description: "публичный MCP" },
  { command: "/profiles", description: "AI-профили" },
  { command: "/model", description: "выбрать AI-подключение и модель" },
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
  ["cloud", handleCloud],
  ["yandex", handleYandex],
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
  ["delete", handleUninstall],
  ["banner", showBanner],
  ["agent", startAgent],
  ["chat", startAgent],
  ["ask", aiAsk],
  ["ai", handleAi],
  ["init", initCli],
  ["health", checkHealth],
  ["layers", listLayers],
  ["data", handleData],
  ["geo", handleGeo],
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
    runtime: profile?.runtime,
    repo: profile?.repo || IOLA_ROUTER_HF_REPO,
    ggufRepo: profile?.ggufRepo,
    ggufFile: profile?.ggufFile,
    model: profile?.model,
    baseUrl: profile?.baseUrl,
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
  iola cloud status            облачные диски
  iola yandex status           Yandex Connector
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
  iola skills list|show|paths|create|enable|disable|delete|bundles|bundle|doctor
  iola tools list|toolsets|enable|disable|profile
  iola files status|mode|approvals|tree|read|search|write|patch
  iola cloud setup|status|ls|find|upload|download|share|save|backup
  iola yandex setup|menu|status|services|enable|disable|oauth-url|token
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
  iola delete
  iola update
  iola ask TEXT [--profile NAME] [--model MODEL] [--tools] [--files] [--plan] [--trace] [--reasoning fast|verify|vote] [--output FILE] [--schema json|table] [--events] [--no-history] [--bare] [--quiet] [--no-color] [--fail-on-empty]
  iola data LAYER [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola ai ask TEXT [--provider iola|ollama|yandexgpt|gigachat|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set yandexgpt
  iola ai key set gigachat
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete yandexgpt|gigachat|openai|openrouter
  iola ai profiles
  iola ai profile add NAME --provider PROVIDER --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models iola|ollama|yandexgpt|gigachat|openai|openrouter|codex [--search TEXT]
  iola ai doctor [--json]
  iola ai setup
  iola ai setup iola [--yes] [--force]
  iola ai setup ollama [--yes] [--model MODEL]
  iola ai setup yandexgpt [--model MODEL]
  iola ai setup gigachat [--model MODEL]
  iola health [--json]
  iola layers [--json]
  iola schools [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola schools get --inn INN [--json]
  iola kindergartens [--limit 10] [--search TEXT] [--where FIELD=VALUE] [--columns a,b,c] [--format table|json|csv]
  iola kindergartens get --inn INN [--json]
  iola search TEXT [--limit 5] [--format table|json|csv]
  iola geo key set yandex
  iola geo key doctor
  iola geo geocode "Йошкар-Ола, ул. Петрова, 15"
  iola mcp-info [--json]
  iola setup codex
  iola onboard
  iola master
  iola wizard
  iola version

Environment:
  IOLA_API_BASE_URL   default: ${API_BASE_URL}
  IOLA_MCP_BASE_URL   default: ${MCP_BASE_URL}
  IOLA_AI_RELAY_BASE_URL default: ${AI_RELAY_BASE_URL}
  IOLA_AI_NETWORK_MODE direct|gateway|auto

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
    const readiness = await getAiReadiness();
    if (readiness.ready) {
      markFirstRunCompleted();
    } else {
      await showBanner();
      console.log("Первый запуск iola-cli. Сейчас откроется мастер настройки.");
      console.log("После мастера запустится интерактивный агент.");
      console.log("Введите 0, чтобы пропустить мастер и перейти в CLI.");
      console.log("");
      await onboard([]);
      markFirstRunCompleted();
      console.log("");
    }
  }

  await startAgent([]);
}

async function startAgent() {
  setTerminalTitle(`iola - ${path.basename(process.cwd()) || process.cwd()}`);
  await showBanner();
  await ensureAgentAiReady();
  await printActiveAiModelLine();
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

async function printActiveAiModelLine() {
  const config = await loadConfig();
  const name = getActiveProfileName(config);
  const profile = config.ai.profiles?.[name] || {
    provider: config.ai.provider,
    model: config.ai.model,
  };
  console.log(`Активная модель: ${name} (${profile.provider || "-"}, ${profile.model || "-"})`);
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
  const yandexgpt = Boolean((process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY || secrets.yandexgpt?.apiKey)
    && (process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexgpt?.folderId));
  const gigachat = Boolean(process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_API_KEY || secrets.gigachat?.apiKey);
  const providerReady = {
    iola,
    ollama,
    yandexgpt,
    gigachat,
    openai,
    openrouter,
    codex,
  };
  return {
    ready: Boolean(providerReady[activeProfile.provider]),
    activeProfile: activeProfileName,
    activeProvider: activeProfile.provider || "-",
    activeModel: activeProfile.model || "-",
    anyReady: Boolean(iola || ollama || yandexgpt || gigachat || openai || openrouter || codex),
    profiles: config.ai.profiles || {},
    iola,
    ollama,
    yandexgpt,
    gigachat,
    openai,
    openrouter,
    codex,
  };
}

function getFallbackAiProfile(readiness) {
  const priority = ["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"];
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
          if (shouldExit) break;
          await refreshAgentAiStatus(state);
          restoreRawInput();
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
    finishAgentTerminalLine(state);
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
    yandex: ["yandex", args.length ? args : ["menu"]],
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
    delete: ["delete", args],
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
  const result = await COMMANDS.get(cliCommand)(cliArgs);
  if (cliCommand === "delete" && result?.deleted) return true;
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
  const inputLines = buildAgentInputDisplayLines(state.buffer, prompt);
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
    const cursorColumn = Math.min(visibleLength(inputLines[inputLines.length - 1]), Math.max(1, Number(output.columns || 100)) - 1);
    output.write(`\x1b[${cursorColumn + 1}G`);
  }
  state.renderedInputLines = inputLines.length;
  state.renderedLines = renderedLines.length;
}

function buildAgentInputDisplayLines(buffer, prompt = "> ") {
  const columns = Math.max(20, Number(output.columns || 100));
  const logicalLines = String(buffer || "").split("\n");
  const result = [];
  for (let index = 0; index < logicalLines.length; index += 1) {
    const prefix = index === 0 ? prompt : "";
    const width = Math.max(1, columns - visibleLength(prefix));
    const chunks = wrapTerminalText(logicalLines[index] || "", width);
    if (chunks.length === 0) {
      result.push(prefix);
      continue;
    }
    result.push(`${prefix}${chunks[0]}`);
    for (const chunk of chunks.slice(1)) result.push(chunk);
  }
  return result.length ? result : [prompt];
}

function wrapTerminalText(value, width) {
  const chars = [...String(value || "")];
  if (!chars.length) return [];
  const rows = [];
  for (let index = 0; index < chars.length; index += width) {
    rows.push(chars.slice(index, index + width).join(""));
  }
  return rows;
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

function finishAgentTerminalLine(state = null) {
  if (!output.isTTY) return;
  const rows = Number(output.rows || state?.statusRows || 0);
  output.write("\x1b[r");
  if (rows >= 1) {
    output.write(`\x1b[${rows};1H\x1b[2K\n`);
  } else {
    output.write("\r\x1b[0K\n");
  }
  if (state) {
    state.statusBar = false;
    state.statusRows = 0;
    state.renderedInputLines = 0;
    state.renderedLines = 0;
  }
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
  printAiAnswer(text);
}

function colorSlashSelection(row) {
  if (!output.isTTY || process.env.NO_COLOR === "1") return row;
  return `\x1b[38;5;213m${row}\x1b[0m`;
}

function colorMuted(row) {
  if (!output.isTTY || process.env.NO_COLOR === "1") return row;
  return `\x1b[38;5;245m${row}\x1b[0m`;
}

function printAiAnswer(text) {
  output.write(`${renderTerminalMarkdown(text)}\n`);
}

function renderTerminalMarkdown(text) {
  const source = String(text || "");
  if (!output.isTTY || process.env.NO_COLOR === "1") return source;
  return source
    .split(/(```[\s\S]*?```)/g)
    .map((part) => part.startsWith("```") ? part : renderInlineMarkdown(part))
    .join("");
}

function renderInlineMarkdown(text) {
  return String(text || "")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "\x1b[1m$1\x1b[22m")
    .replace(/__([^_\n][\s\S]*?[^_\n])__/g, "\x1b[1m$1\x1b[22m")
    .replace(/`([^`\n]+)`/g, "\x1b[36m$1\x1b[39m");
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
    yandexgpt: "YandexGPT",
    gigachat: "GigaChat",
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
      yandexGeocoderKey: (process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY) ? "env" : secrets.yandexGeocoder?.apiKey ? "local" : "missing",
      yandexConnector: getYandexConnectorSecretStatus(secrets),
      yandexAuthorized: config.yandex?.authorizedServices?.join(", ") || "-",
      yandexServices: config.yandex?.enabledServices?.join(", ") || (secrets.cloud?.["yandex-disk"]?.token ? "disk (legacy cloud token)" : "-"),
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
  printKeyValueFull({ ...report.skills, toolsets: report.toolsets.enabled, daemon: report.daemon.status });
  console.log("");
  const isLocalAi = ["iola", "ollama"].includes(activeAiProfile.provider);
  printDiagnostics(diagnostics, isLocalAi ? recommendOllamaModel(diagnostics) : null);
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
    console.log("  iola ai key set yandexgpt");
    console.log("  iola ai key set gigachat");
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
  iola ai ask TEXT [--provider iola|ollama|yandexgpt|gigachat|openai|openrouter] [--model MODEL]
  iola ai context TEXT [--json]
  iola ai key set yandexgpt
  iola ai key set gigachat
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete yandexgpt|gigachat|openai|openrouter
  iola ai profiles
  iola ai profile add NAME --provider iola|ollama|yandexgpt|gigachat|openai|openrouter|codex --model MODEL
  iola ai profile use NAME
  iola ai profile delete NAME
  iola ai models iola|ollama|yandexgpt|gigachat|openai|openrouter|codex [--search TEXT]
  iola ai doctor [--json]
  iola ai setup
  iola ai setup iola [--yes] [--force]
  iola ai setup ollama [--yes] [--model MODEL]
  iola ai setup yandexgpt [--model MODEL]
  iola ai setup gigachat [--model MODEL]
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
  targets.push(...getIolaTempCleanupTargets());
  const npmPackage = "@iola_adm/iola-cli";

  const safeTargets = targets.map((target) => ({
    ...target,
    path: path.resolve(target.path),
  }));
  const home = path.resolve(os.homedir());
  const temp = path.resolve(os.tmpdir());
  for (const target of safeTargets) {
    const isUserConfig = target.path === path.resolve(CONFIG_DIR) && target.path.startsWith(home);
    const isProjectConfig = target.path === path.resolve(PROJECT_IOLA_DIR) && target.path.startsWith(path.resolve(process.cwd()));
    const isTemp = target.path.startsWith(temp + path.sep) && path.basename(target.path).startsWith("iola-");
    if (!isUserConfig && !isProjectConfig && !isTemp) {
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
      willRemovePackage: npmPackage,
      willKeep: ["Codex CLI", "Codex auth/config"],
      reinstall: "npm install -g @iola_adm/iola-cli@latest",
    };
    if (options.json) printJson(payload);
    else printKeyValue(Object.fromEntries(payload.willDelete.map((item) => [item.label, `${item.path} (${item.exists ? "exists" : "missing"})`])));
    return { deleted: false };
  }

  if (!options.yes) {
    console.log("Будет удалено:");
    for (const target of safeTargets) {
      console.log(`- ${target.path}`);
      console.log(`  ${target.description}`);
    }
    console.log("");
    console.log(`Будет удален npm-пакет: ${npmPackage}`);
    console.log("Codex CLI и его настройки не удаляются.");
    const confirmed = await confirm("Полностью удалить iola-cli? [y/N] ");
    if (!confirmed) {
      console.log("Удаление отменено.");
      return { deleted: false };
    }
  }

  for (const target of safeTargets) {
    await rm(target.path, { recursive: true, force: true });
  }

  console.log("Локальные данные iola-cli удалены.");
  console.log(`Удаляю npm-пакет ${npmPackage}...`);
  const packageRemoval = await removeGlobalNpmPackage(npmPackage).catch((error) => ({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  }));
  if (packageRemoval.status === "scheduled") {
    console.log("Удаление npm-пакета запланировано после выхода из CLI.");
  } else if (packageRemoval.status === "removed") {
    console.log("npm-пакет iola-cli удален.");
  } else {
    console.log(`Не удалось удалить npm-пакет автоматически: ${packageRemoval.error}`);
    console.log("Локальные данные уже удалены, CLI сейчас выйдет.");
    console.log("После выхода выполните вручную:");
    console.log(`  npm remove -g ${npmPackage}`);
  }
  console.log("Codex CLI не тронут.");
  console.log("Для повторной установки:");
  console.log("  npm install -g @iola_adm/iola-cli@latest");
  return { deleted: true };
}

function getIolaTempCleanupTargets() {
  const tempDir = os.tmpdir();
  const names = [
    "iola-cli-test",
    "iola-model-check.txt",
  ];
  let dynamicNames = [];
  try {
    dynamicNames = readdirSync(tempDir)
      .filter((name) => /^iola-(archive|codex|browser)-/u.test(name))
      .slice(0, 100);
  } catch {
    dynamicNames = [];
  }
  return [...new Set([...names, ...dynamicNames])].map((name) => ({
    label: "temp",
    path: path.join(tempDir, name),
    description: "временные файлы iola-cli",
  }));
}

async function removeGlobalNpmPackage(npmPackage) {
  if (process.platform === "win32") {
    const command = quoteWindowsCommand(getNpmCommand(), ["remove", "-g", npmPackage]);
    const cleanupConfig = quoteWindowsCommand("rmdir", ["/s", "/q", CONFIG_DIR]);
    const cleanupTempTest = quoteWindowsCommand("rmdir", ["/s", "/q", path.join(os.tmpdir(), "iola-cli-test")]);
    const cleanupTempModel = quoteWindowsCommand("del", ["/f", "/q", path.join(os.tmpdir(), "iola-model-check.txt")]);
    const script = `ping 127.0.0.1 -n 3 > nul & ${cleanupConfig} 2> nul & ${cleanupTempTest} 2> nul & ${cleanupTempModel} 2> nul & ${command}`;
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { status: "scheduled" };
  }
  await runCommand(getNpmCommand(), ["remove", "-g", npmPackage], { inherit: true });
  return { status: "removed" };
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
    ["Yandex Geocoder API key", `${base}/Yandex-Geocoder-API-key`],
    ["Скиллы для жителей", `${base}/Скиллы-для-жителей`],
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
    printSkillsList(listSkills(config), config);
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

  if (action === "templates") {
    printTable(userSkillTemplates().map((row) => ({ name: row.name, description: row.description, tools: row.tools.join(", ") })), [["name", "Шаблон"], ["description", "Описание"], ["tools", "Tools"]]);
    return;
  }

  if (action === "preview") {
    const options = parseOptions(args.slice(2));
    console.log(buildUserSkillPreview({
      name,
      description: options.description || "",
      instructions: options.instructions || options.text || options.prompt || options._.join(" "),
      tools: parseCommaList(options["allowed-tools"] || options.tool || options.uses || ""),
      template: options.template,
    }));
    return;
  }

  if (action === "validate") {
    const result = await userSkillValidate(name);
    printTable(result.checks, [["check", "Проверка"], ["status", "Статус"], ["message", "Сообщение"]]);
    return;
  }

  if (action === "create" || action === "new") {
    const options = parseOptions(args.slice(2));
    const result = await userSkillCreate({
      name,
      description: options.description || "",
      instructions: options.instructions || options.text || options.prompt || options._.join(" "),
      tools: parseCommaList(options["allowed-tools"] || options.tool || options.uses || ""),
      template: options.template,
      enable: Boolean(options.enable),
      overwrite: Boolean(options.force),
      confirm: true,
    });
    console.log(`Skill создан: ${result.name}`);
    console.log(`Файл: ${result.file}`);
    if (result.enabled) console.log("Skill включен.");
    return;
  }

  if (action === "update" || action === "edit") {
    const options = parseOptions(args.slice(2));
    const result = await userSkillUpdate(name, {
      description: options.description,
      instructions: options.instructions || options.text || options.prompt || options._.join(" "),
      tools: parseCommaList(options["allowed-tools"] || options.tool || options.uses || ""),
      enable: options.enable,
      confirm: true,
    });
    console.log(`Skill обновлен: ${result.name}`);
    console.log(`Файл: ${result.file}`);
    return;
  }

  if (action === "delete" || action === "remove" || action === "rm") {
    const options = parseOptions(args.slice(2));
    const result = await userSkillDelete(name, { confirm: Boolean(options.yes || options.force) });
    console.log(`Skill удален: ${result.name}`);
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

  throw new Error("Команды skills: list, paths, show NAME, templates, preview NAME --template T, create NAME --description TEXT --instructions TEXT [--enable], update NAME --instructions TEXT, validate NAME, enable NAME, disable NAME, delete NAME --yes, bundles, bundle enable NAME, doctor.");
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

async function handleCloud(args) {
  const [action = "status", target, maybeRemote, ...rest] = args;
  const options = parseOptions(rest);

  if (action === "setup") {
    await setupCloudProvider(target, options);
    return;
  }

  if (action === "use") {
    const provider = normalizeCloudProvider(target);
    await requireCloudCredentials(provider);
    const config = await loadConfig();
    await saveConfig({ cloud: { ...(config.cloud || {}), activeProvider: provider } });
    console.log(`Активный облачный диск: ${provider}`);
    return;
  }

  if (action === "status") {
    await printCloudStatus({ check: Boolean(options.check) });
    return;
  }

  if (action === "doctor") {
    await printCloudStatus({ check: true });
    return;
  }

  if (action === "delete") {
    const provider = normalizeCloudProvider(target);
    const secrets = await loadSecrets();
    delete secrets.cloud?.[provider];
    if (secrets.cloud && Object.keys(secrets.cloud).length === 0) delete secrets.cloud;
    await saveSecrets(secrets);
    const config = await loadConfig();
    if (config.cloud?.activeProvider === provider) {
      await saveConfig({ cloud: { ...(config.cloud || {}), activeProvider: "" } });
    }
    console.log(`Локальные секреты облака удалены: ${provider}`);
    return;
  }

  if (action === "ls" || action === "list") {
    const provider = await getCloudProvider(options.provider);
    const rows = await cloudList(provider, target || cloudRootForProvider(provider));
    printTable(rows, [["type", "Тип"], ["name", "Имя"], ["path", "Путь"], ["size", "Размер"]]);
    return;
  }

  if (action === "find" || action === "search") {
    if (!target) throw new Error('Пример: iola cloud find "справка" --path /IOLA');
    const provider = await getCloudProvider(options.provider);
    const rows = await cloudFind(provider, target, { path: options.path || cloudRootForProvider(provider), limit: Number(options.limit || 50) });
    printTable(rows, [["type", "Тип"], ["name", "Имя"], ["path", "Путь"], ["size", "Размер"]]);
    return;
  }

  if (action === "mkdir" || action === "create-folder") {
    const provider = await getCloudProvider(options.provider);
    const remotePath = target || `${cloudRootForProvider(provider)}/Новая папка`;
    const result = await cloudCreateFolder(provider, remotePath);
    printKeyValue(result);
    return;
  }

  if (action === "upload") {
    if (!target) throw new Error('Пример: iola cloud upload report.md /IOLA/reports/report.md');
    const provider = await getCloudProvider(options.provider);
    const remotePath = maybeRemote || `${cloudRootForProvider(provider)}/${path.basename(target)}`;
    const result = await cloudUpload(provider, target, remotePath, { overwrite: options.overwrite !== false });
    printKeyValue(result);
    return;
  }

  if (action === "download") {
    if (!target) throw new Error('Пример: iola cloud download /IOLA/report.md ./report.md');
    const provider = await getCloudProvider(options.provider);
    const outputPath = maybeRemote || path.basename(target);
    const result = await cloudDownload(provider, target, outputPath);
    printKeyValue(result);
    return;
  }

  if (action === "share") {
    if (!target) throw new Error('Пример: iola cloud share /IOLA/report.md');
    const provider = await getCloudProvider(options.provider);
    const result = await cloudShare(provider, target);
    printKeyValue(result);
    return;
  }

  if (action === "save") {
    const provider = await getCloudProvider(options.provider);
    const text = options.text ?? [target, maybeRemote, ...rest].filter(Boolean).join(" ");
    if (!text) throw new Error('Пример: iola cloud save --text "Текст" --path /IOLA/notes/note.txt');
    const remotePath = options.path || `${cloudRootForProvider(provider)}/notes/iola-${timestampForFile()}.txt`;
    const tempPath = path.join(CONFIG_DIR, `cloud-save-${Date.now()}.txt`);
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(tempPath, text, "utf8");
    try {
      const result = await cloudUpload(provider, tempPath, remotePath, { overwrite: true });
      printKeyValue(result);
    } finally {
      await rm(tempPath, { force: true }).catch(() => {});
    }
    return;
  }

  if (action === "backup") {
    const provider = await getCloudProvider(options.provider);
    const result = await cloudBackup(provider);
    printKeyValue(result);
    return;
  }

  throw new Error(`Команды cloud:
  iola cloud setup yandex-disk
  iola cloud setup mailru-cloud
  iola cloud status|doctor
  iola cloud use yandex-disk
  iola cloud ls /IOLA
  iola cloud mkdir /IOLA/Фото
  iola cloud find "справка" --path /IOLA
  iola cloud upload local.txt /IOLA/local.txt
  iola cloud download /IOLA/local.txt ./local.txt
  iola cloud share /IOLA/local.txt
  iola cloud save --text "Текст" --path /IOLA/notes/note.txt
  iola cloud backup`);
}

async function handleYandex(args) {
  const [action = process.stdin.isTTY ? "menu" : "status", target, ...rest] = args;
  const options = parseOptions(rest);

  if (action === "menu" || action === "choose" || action === "select") {
    await chooseYandexServicesMenu();
    return;
  }

  if (action === "services" || action === "list") {
    printYandexServices();
    return;
  }

  if (action === "status" || action === "doctor") {
    await printYandexConnectorStatus({ check: action === "doctor" || options.check });
    return;
  }

  if (action === "setup") {
    await setupYandexConnector([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "cloud" || action === "cloud-connector" || action === "yc") {
    await handleYandexCloudConnector([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "go" || action === "taxi" || action === "такси") {
    await handleYandexGo([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "mail-watch" || action === "mailwatch" || action === "watch-mail") {
    await handleYandexMailWatch([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "daily-digest" || action === "digest") {
    await handleYandexDailyDigest([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "calendar-reminders" || action === "calendar-watch" || action === "reminders") {
    await handleYandexCalendarReminders([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "disk-maintenance" || action === "disk-watch" || action === "disk-doctor") {
    await handleYandexDiskMaintenance([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "contacts-maintenance" || action === "contacts-watch" || action === "contacts-doctor") {
    await handleYandexContactsMaintenance([target, ...rest].filter(Boolean));
    return;
  }

  if (action === "enable" || action === "disable") {
    const services = [target, ...rest].filter((item) => item && !String(item).startsWith("--"));
    if (services.length === 0) throw new Error("Укажите сервисы. Пример: iola yandex enable disk mail calendar");
    await updateYandexEnabledServices(services, action === "enable");
    return;
  }

  if (action === "oauth-url" || action === "url") {
    const url = await buildYandexOAuthUrlFromConfig([target, ...rest].filter(Boolean));
    console.log(url);
    if (options.open) await openUrl(url);
    return;
  }

  if (action === "token") {
    if (target === "set") {
      await setYandexConnectorToken(rest);
      return;
    }
    if (target === "delete") {
      await deleteYandexConnectorToken();
      return;
    }
  }

  if (action === "backlog") {
    printYandexServices({ status: "backlog" });
    return;
  }

  throw new Error(`Команды yandex:
  iola yandex setup
  iola yandex menu
  iola yandex status|doctor
  iola yandex services
  iola yandex cloud setup|status|doctor|delete
  iola yandex cloud enable geocoder yandexgpt
  iola yandex cloud disable yandexgpt
  iola yandex go link --from "Адрес" --to "Адрес" [--tariff econom]
  iola yandex go open --from "Адрес" --to "Адрес" [--tariff econom]
  iola yandex mail-watch on|off|status|tick [--minutes 5]
  iola yandex daily-digest on|off|status|tick [--time 09:00] [--email]
  iola yandex calendar-reminders on|off|status|tick [--minutes 15]
  iola yandex disk-maintenance on|off|status|tick [--days 7]
  iola yandex contacts-maintenance on|off|status|tick [--days 7] [--backup]
  iola yandex enable disk mail calendar
  iola yandex disable mail
  iola yandex oauth-url [disk mail calendar] [--client-id ID] [--open]
  iola yandex token set
  iola yandex token delete    удалить локальные токены и настройки коннектора
  iola yandex backlog`);
}

function printYandexServices(options = {}) {
  const rows = Object.entries(YANDEX_CONNECTOR_SERVICES)
    .filter(([, service]) => !options.status || service.status === options.status)
    .map(([id, service]) => ({
      id,
      title: service.title,
      category: service.category,
      status: service.status,
      scope: service.scope || "-",
      hint: service.hint,
    }));
  printTable(rows, [
    ["id", "ID"],
    ["title", "Сервис"],
    ["category", "Категория"],
    ["status", "Статус"],
    ["scope", "Scope"],
    ["hint", "Суть"],
  ]);
}

async function handleYandexCloudConnector(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);

  if (action === "setup" || action === "connect" || action === "onboard") {
    await setupYandexCloudConnector(options);
    return;
  }

  if (action === "status" || action === "doctor" || action === "check") {
    await printYandexCloudConnectorStatus({ check: action !== "status" || options.check });
    return;
  }

  if (action === "enable" || action === "disable") {
    const services = options._.length ? options._ : rest.filter((item) => item && !String(item).startsWith("--"));
    await updateYandexCloudEnabledServices(services, action === "enable");
    return;
  }

  if (action === "delete" || action === "disconnect" || action === "remove") {
    const ok = !process.stdin.isTTY || await askYesNo("Удалить локальные ключи и настройки Yandex Cloud Connector? [y/N] ", false);
    if (!ok) {
      console.log("Удаление отменено.");
      return;
    }
    await deleteYandexCloudConnector();
    return;
  }

  if (action === "open") {
    await openUrl("https://console.yandex.cloud/");
    return;
  }

  throw new Error("Команды: iola yandex cloud setup | status | doctor | enable geocoder yandexgpt | disable yandexgpt | delete");
}

async function setupYandexCloudConnector(options = {}) {
  console.log("Yandex Cloud Connector: геокодинг и YandexGPT.");
  console.log("Геокодер будет включен по умолчанию. YandexGPT можно выбрать в /model после сохранения ключей.");
  if (process.stdin.isTTY) {
    const openConsole = await askYesNo("Открыть Yandex Cloud Console для получения ключей? [Y/n] ", true);
    if (openConsole) await openUrl("https://console.yandex.cloud/");
  }

  const secrets = await loadSecrets();
  const currentGeocoder = secrets.yandexGeocoder?.apiKey || secrets.yandexCloud?.geocoderApiKey || "";
  const currentGptKey = secrets.yandexgpt?.apiKey || secrets.yandexCloud?.yandexgptApiKey || "";
  const currentFolderId = secrets.yandexgpt?.folderId || secrets.yandexCloud?.folderId || "";

  if (!process.stdin.isTTY) {
    await saveYandexCloudEnabledServices(["geocoder"]);
    console.log("Интерактивный ввод ключей недоступен. Запустите: iola yandex cloud setup");
    return;
  }

  const geocoderKey = (await askText(`YANDEX_GEOCODER_API_KEY${currentGeocoder ? " [уже сохранен, Enter - оставить]" : ""}: `)).trim() || currentGeocoder;
  if (!geocoderKey) throw new Error("Для Cloud Connector нужен хотя бы Geocoder API key.");

  const setupGpt = await askYesNo(`Настроить YandexGPT сейчас${currentGptKey && currentFolderId ? " (уже сохранен)" : ""}? [y/N] `, Boolean(currentGptKey && currentFolderId));
  let yandexgptApiKey = currentGptKey;
  let folderId = currentFolderId;
  if (setupGpt) {
    yandexgptApiKey = (await askText(`YANDEXGPT_API_KEY${currentGptKey ? " [Enter - оставить]" : ""}: `)).trim() || currentGptKey;
    folderId = (await askText(`YANDEXGPT_FOLDER_ID${currentFolderId ? " [Enter - оставить]" : ""}: `)).trim() || currentFolderId;
    if (!yandexgptApiKey || !folderId) throw new Error("Для YandexGPT нужны API key и folder ID.");
  }

  await saveYandexCloudConnectorSecrets({ geocoderApiKey: geocoderKey, yandexgptApiKey, folderId });
  await saveYandexCloudEnabledServices(setupGpt ? ["geocoder", "yandexgpt"] : ["geocoder"]);
  console.log(`Yandex Cloud Connector сохранен локально: ${SECRETS_FILE}`);
  await printYandexCloudConnectorStatus({ check: true });
}

async function saveYandexCloudConnectorSecrets({ geocoderApiKey, yandexgptApiKey, folderId }) {
  const secrets = await loadSecrets();
  secrets.yandexCloud = {
    ...(secrets.yandexCloud || {}),
    geocoderApiKey: geocoderApiKey || secrets.yandexCloud?.geocoderApiKey || "",
    yandexgptApiKey: yandexgptApiKey || secrets.yandexCloud?.yandexgptApiKey || "",
    folderId: folderId || secrets.yandexCloud?.folderId || "",
    updatedAt: new Date().toISOString(),
  };
  if (geocoderApiKey) secrets.yandexGeocoder = { ...(secrets.yandexGeocoder || {}), apiKey: geocoderApiKey };
  if (yandexgptApiKey || folderId) {
    secrets.yandexgpt = {
      ...(secrets.yandexgpt || {}),
      apiKey: yandexgptApiKey || secrets.yandexgpt?.apiKey || "",
      folderId: folderId || secrets.yandexgpt?.folderId || "",
    };
  }
  await saveSecrets(secrets);
}

async function saveYandexCloudEnabledServices(services) {
  const config = await loadConfig();
  const normalized = normalizeYandexCloudServiceList(services);
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      cloudConnector: {
        ...(config.yandex?.cloudConnector || {}),
        enabledServices: normalized,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

async function updateYandexCloudEnabledServices(rawServices, enabled) {
  const config = await loadConfig();
  const current = new Set(config.yandex?.cloudConnector?.enabledServices || ["geocoder"]);
  for (const service of normalizeYandexCloudServiceList(rawServices)) {
    if (enabled) current.add(service);
    else current.delete(service);
  }
  if (current.size > 0 && !current.has("geocoder")) current.add("geocoder");
  await saveYandexCloudEnabledServices([...current]);
  console.log(`Yandex Cloud services: ${[...current].join(", ") || "-"}`);
}

function normalizeYandexCloudServiceList(services = []) {
  const aliases = {
    geo: "geocoder",
    geocoder: "geocoder",
    maps: "geocoder",
    map: "geocoder",
    "yandex-geocoder": "geocoder",
    gpt: "yandexgpt",
    yandexgpt: "yandexgpt",
    "yandex-gpt": "yandexgpt",
    model: "yandexgpt",
    models: "yandexgpt",
  };
  return [...new Set([].concat(services || []).map((item) => aliases[String(item || "").toLocaleLowerCase("ru-RU")] || "").filter(Boolean))];
}

async function printYandexCloudConnectorStatus(options = {}) {
  const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);
  const enabled = new Set(config.yandex?.cloudConnector?.enabledServices || []);
  const geocoderKey = process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY || secrets.yandexCloud?.geocoderApiKey || secrets.yandexGeocoder?.apiKey || "";
  const gptKey = process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY || secrets.yandexCloud?.yandexgptApiKey || secrets.yandexgpt?.apiKey || "";
  const folderId = process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexCloud?.folderId || secrets.yandexgpt?.folderId || "";
  const rows = [
    { service: "geocoder", enabled: enabled.has("geocoder") ? "yes" : "no", configured: geocoderKey ? "yes" : "no", source: geocoderKey ? "local/env" : "-", hint: "адреса и координаты" },
    { service: "yandexgpt", enabled: enabled.has("yandexgpt") ? "yes" : "no", configured: gptKey && folderId ? "yes" : "no", source: gptKey && folderId ? "local/env" : "-", hint: "модели YandexGPT" },
  ];
  printTable(rows, [
    ["service", "Сервис"],
    ["enabled", "Вкл"],
    ["configured", "Настроен"],
    ["source", "Ключ"],
    ["hint", "Суть"],
  ]);
  if (options.check) {
    await checkYandexGeocoderKey({ print: true });
    if (gptKey && folderId) console.log("YandexGPT: ключ и folder ID найдены.");
    else console.log("YandexGPT: не настроен.");
  }
}

async function deleteYandexCloudConnector() {
  const secrets = await loadSecrets();
  delete secrets.yandexCloud;
  delete secrets.yandexGeocoder;
  delete secrets.yandexgpt;
  await saveSecrets(secrets);
  const config = await loadConfig();
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      cloudConnector: { enabledServices: [], updatedAt: new Date().toISOString() },
    },
  });
  console.log("Yandex Cloud Connector удален локально.");
}

async function handleYandexGo(args = []) {
  const [action = "link", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "link" || action === "deeplink" || action === "url") {
    await ensureYandexGoGeocoderReady();
    const result = await buildYandexGoDeeplinkFromOptions(options);
    printYandexGoDeeplinkResult(result);
    return;
  }
  if (action === "open" || action === "prepare" || action === "route") {
    await ensureYandexGoGeocoderReady();
    const result = await buildYandexGoDeeplinkFromOptions(options);
    printYandexGoDeeplinkResult(result);
    await openUrl(result.url);
    return;
  }
  if (action === "status") {
    printKeyValue({
      deeplink: "ready",
      priceApi: "ожидает clid/apikey от Яндекса",
      orderApi: "не подключен",
    });
    return;
  }
  throw new Error('Команды: iola yandex go link --from "Адрес" --to "Адрес" [--tariff econom] | open --from "Адрес" --to "Адрес"');
}

async function ensureYandexGoGeocoderReady() {
  if (await getYandexGeocoderKey()) return true;
  throw new Error([
    "Для Yandex Go deeplink нужен ключ Yandex Geocoder API: адреса нужно превратить в координаты.",
    "Откройте мастер настройки и запустите Yandex Cloud Connector (геокодинг и YandexGPT):",
    "  iola master",
    "или напрямую:",
    "  iola yandex cloud setup",
    "После подключения повторите команду такси.",
  ].join("\n"));
}

async function buildYandexGoDeeplinkFromOptions(options = {}) {
  const from = options.from || options._?.[0] || "";
  const to = options.to || options._?.[1] || "";
  if (!from || !to) throw new Error('Укажите маршрут: iola yandex go link --from "Медведево, Школьная 15" --to "Медведево, Советская 20"');
  const fromPoint = await resolveYandexGoPoint(from);
  const toPoint = await resolveYandexGoPoint(to);
  const tariff = normalizeYandexGoTariff(options.tariff || options.class || options.level || "econom");
  return {
    from,
    to,
    fromPoint,
    toPoint,
    tariff,
    url: buildYandexGoDeeplink({
      fromPoint,
      toPoint,
      tariff,
      ref: options.ref || "iola-cli",
      lang: options.lang || "ru",
    }),
  };
}

async function resolveYandexGoPoint(query) {
  const parsed = parseLonLat(query);
  if (parsed) return { lon: parsed.lon, lat: parsed.lat, label: `${parsed.lat}, ${parsed.lon}`, address: "" };
  const point = await callYandexGeocoder(query);
  const coords = parseCoordinates(point?.coordinates);
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) throw new Error(`Не смог получить координаты: ${query}`);
  return { lon: coords.lon, lat: coords.lat, label: point.name || query, address: point.address || "" };
}

function parseLonLat(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/u);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (Math.abs(first) <= 90 && Math.abs(second) > 90) return { lat: first, lon: second };
  return { lon: first, lat: second };
}

function normalizeYandexGoTariff(value) {
  const text = String(value || "").toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  const aliases = {
    economy: "econom",
    econom: "econom",
    эконом: "econom",
    comfort: "business",
    комфорт: "business",
    business: "business",
    comfortplus: "comfortplus",
    "комфорт+": "comfortplus",
    komfortplus: "comfortplus",
    minivan: "minivan",
    минивен: "minivan",
    vip: "vip",
    бизнес: "vip",
    детский: "econom",
    child: "econom",
    children: "econom",
  };
  return aliases[text] || "econom";
}

function buildYandexGoDeeplink({ fromPoint, toPoint, tariff = "econom", ref = "iola-cli", lang = "ru" }) {
  const url = new URL("https://3.redirect.appmetrica.yandex.com/route");
  url.searchParams.set("start-lat", String(fromPoint.lat));
  url.searchParams.set("start-lon", String(fromPoint.lon));
  url.searchParams.set("end-lat", String(toPoint.lat));
  url.searchParams.set("end-lon", String(toPoint.lon));
  url.searchParams.set("tariffClass", tariff);
  url.searchParams.set("level", tariff);
  url.searchParams.set("ref", ref);
  url.searchParams.set("lang", lang);
  url.searchParams.set("appmetrica_tracking_id", "1178268795219780156");
  return url.toString();
}

function printYandexGoDeeplinkResult(result) {
  console.log(formatYandexGoDeeplinkResult(result));
}

function formatYandexGoDeeplinkResult(result) {
  return [
    `Откуда: ${result.fromPoint.address || result.from}`,
    `Куда: ${result.toPoint.address || result.to}`,
    `Тариф: ${result.tariff}`,
    `Ссылка Яндекс Go: ${result.url}`,
    "Детское кресло и повышенный спрос deeplink не кодирует напрямую; это выбирается/проверяется в интерфейсе Яндекс Go или через taxi_info после получения clid/apikey.",
  ].join("\n");
}

function extractYandexGoRouteFromText(text) {
  const source = String(text || "").trim();
  const tariffMatch = source.match(/(эконом|комфорт\+?|комфорт плюс|бизнес|минивен|детск\w*|econom|business|comfortplus|minivan|vip)/iu);
  const cleaned = source
    .replace(/^(?:построй|создай|дай|открой|сделай|подготовь|вызови|закажи)\s+/iu, "")
    .replace(/\b(?:яндекс\s*go|яндекс\s*го|такси|маршрут|ссылк[ау]?|диплинк|deeplink)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/(?:от|из|с)\s+(.+?)\s+(?:до|в|на)\s+(.+)$/iu);
  if (!match) return { from: "", to: "", tariff: tariffMatch ? normalizeYandexGoTariff(tariffMatch[1]) : "econom" };
  const from = match[1].replace(/[,.;]\s*$/u, "").trim();
  const to = match[2].replace(/[,.;]\s*(?:тариф|эконом|комфорт\+?|комфорт плюс|бизнес|минивен|детск\w*).*$/iu, "").trim();
  return { from, to, tariff: tariffMatch ? normalizeYandexGoTariff(tariffMatch[1]) : "econom" };
}

async function handleYandexMailWatch(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "on" || action === "enable" || action === "start" || action === "вкл") {
    const minutes = Math.max(1, Number(options.minutes || options.interval || rest.find((item) => /^\d+$/u.test(String(item))) || 5));
    const result = await yandexMailWatchEnable(minutes);
    console.log(`Автопроверка новых писем включена: каждые ${minutes} минут. Текущий последний UID: ${result.lastUid || "-"}.`);
    console.log("Для работы по расписанию должен запускаться cron tick: вручную, через daemon или Windows Task Scheduler.");
    return;
  }
  if (action === "off" || action === "disable" || action === "stop" || action === "выкл") {
    await yandexMailWatchDisable();
    console.log("Автопроверка новых писем выключена.");
    return;
  }
  if (action === "tick" || action === "run" || action === "check") {
    const result = await yandexMailWatchTick(options);
    if (!result.enabled) {
      console.log("Автопроверка новых писем выключена.");
    } else if (!result.newMessages.length) {
      console.log("Новых писем нет.");
    } else {
      console.log(["Новые письма:", ...result.newMessages.map((row, index) => `${index + 1}. ${formatYandexMailSummary(row)}`)].join("\n"));
    }
    return;
  }
  if (action === "status" || action === "doctor") {
    const config = await loadConfig();
    const watch = config.yandex?.mailWatch || {};
    printKeyValue({
      enabled: watch.enabled ? "yes" : "no",
      minutes: watch.minutes || "-",
      mailbox: watch.mailbox || "INBOX",
      lastUid: watch.lastUid || "-",
      cron: listCronJobs().some((job) => job.command === "yandex mail-watch tick") ? "yes" : "no",
    });
    return;
  }
  throw new Error("Команды: iola yandex mail-watch on --minutes 5 | off | status | tick");
}

async function handleYandexDailyDigest(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "on" || action === "enable" || action === "start" || action === "вкл") {
    const time = options.time || rest.find((item) => /^\d{1,2}:\d{2}$/u.test(String(item))) || "09:00";
    const result = await yandexDailyDigestEnable({ time, email: Boolean(options.email), save: options.save !== false });
    console.log(`Ежедневный дайджест включен: каждый день ${result.time}. Email: ${result.email ? "yes" : "no"}.`);
    return;
  }
  if (action === "off" || action === "disable" || action === "stop" || action === "выкл") {
    await yandexDailyDigestDisable();
    console.log("Ежедневный дайджест выключен.");
    return;
  }
  if (action === "tick" || action === "run" || action === "check") {
    const result = await yandexDailyDigestTick({ force: true, email: Boolean(options.email), save: options.save !== false });
    console.log(result.text || "Дайджест пуст.");
    if (result.remote) console.log(`Сохранено на Диск: ${result.remote}`);
    return;
  }
  const config = await loadConfig();
  const digest = config.yandex?.dailyDigest || {};
  printKeyValue({
    enabled: digest.enabled ? "yes" : "no",
    time: digest.time || "-",
    email: digest.email ? "yes" : "no",
    lastRunAt: digest.lastRunAt || "-",
    lastRemote: digest.lastRemote || "-",
    cron: listCronJobs().some((job) => job.command === "yandex daily-digest tick") ? "yes" : "no",
  });
}

async function handleYandexCalendarReminders(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "on" || action === "enable" || action === "start" || action === "вкл") {
    const minutes = Math.max(1, Number(options.minutes || rest.find((item) => /^\d+$/u.test(String(item))) || 15));
    const result = await yandexCalendarRemindersEnable(minutes);
    console.log(`Проверка календарных напоминаний включена: каждые ${result.minutes} минут.`);
    return;
  }
  if (action === "off" || action === "disable" || action === "stop" || action === "выкл") {
    await yandexCalendarRemindersDisable();
    console.log("Проверка календарных напоминаний выключена.");
    return;
  }
  if (action === "tick" || action === "run" || action === "check") {
    const result = await yandexCalendarRemindersTick({ force: true, horizonMinutes: Number(options.horizon || options.minutes || 60) });
    if (!result.events.length) console.log("Ближайших событий для напоминания нет.");
    else console.log(["Ближайшие события:", ...result.events.map((row, index) => `${index + 1}. ${row.title || row.uid} — ${row.startIso || row.start || "-"}`)].join("\n"));
    return;
  }
  const config = await loadConfig();
  const reminders = config.yandex?.calendarReminders || {};
  printKeyValue({
    enabled: reminders.enabled ? "yes" : "no",
    minutes: reminders.minutes || "-",
    horizonMinutes: reminders.horizonMinutes || 60,
    lastRunAt: reminders.lastRunAt || "-",
    lastCount: reminders.lastCount ?? "-",
    cron: listCronJobs().some((job) => job.command === "yandex calendar-reminders tick") ? "yes" : "no",
  });
}

async function handleYandexDiskMaintenance(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "on" || action === "enable" || action === "start" || action === "вкл") {
    const days = Math.max(1, Number(options.days || rest.find((item) => /^\d+$/u.test(String(item))) || 7));
    const result = await yandexDiskMaintenanceEnable(days);
    console.log(`Проверка Яндекс Диска включена: каждые ${result.days} дней.`);
    return;
  }
  if (action === "off" || action === "disable" || action === "stop" || action === "выкл") {
    await yandexDiskMaintenanceDisable();
    console.log("Проверка Яндекс Диска выключена.");
    return;
  }
  if (action === "tick" || action === "run" || action === "check") {
    const result = await yandexDiskMaintenanceTick({ force: true });
    printKeyValue({
      used: formatBytes(result.usedSpace),
      total: formatBytes(result.totalSpace),
      trash: formatBytes(result.trashSize),
      docs: result.docs,
      publicLinks: result.publicLinks,
      remote: result.remote || "-",
    });
    return;
  }
  const config = await loadConfig();
  const disk = config.yandex?.diskMaintenance || {};
  printKeyValue({
    enabled: disk.enabled ? "yes" : "no",
    days: disk.days || "-",
    lastRunAt: disk.lastRunAt || "-",
    lastRemote: disk.lastRemote || "-",
    cron: listCronJobs().some((job) => job.command === "yandex disk-maintenance tick") ? "yes" : "no",
  });
}

async function handleYandexContactsMaintenance(args = []) {
  const [action = "status", ...rest] = args;
  const options = parseOptions(rest);
  if (action === "on" || action === "enable" || action === "start" || action === "вкл") {
    const days = Math.max(1, Number(options.days || options.interval || rest.find((item) => /^\d+$/u.test(String(item))) || 7));
    const result = await yandexContactsMaintenanceEnable(days, { backup: Boolean(options.backup) });
    console.log(`Проверка контактов включена: каждые ${days} дней.`);
    console.log(`Backup на Диск: ${result.backup ? "yes" : "no"}.`);
    console.log("Для работы по расписанию должен запускаться cron tick: вручную, через daemon или Windows Task Scheduler.");
    return;
  }
  if (action === "off" || action === "disable" || action === "stop" || action === "выкл") {
    await yandexContactsMaintenanceDisable();
    console.log("Проверка контактов выключена.");
    return;
  }
  if (action === "tick" || action === "run" || action === "check") {
    const result = await yandexContactsMaintenanceTick({ force: true, backup: options.backup });
    if (!result.enabled) {
      console.log("Проверка контактов выключена.");
    } else {
      printKeyValue({
        status: "ok",
        contacts: result.total,
        incomplete: result.incomplete,
        duplicateGroups: result.duplicateGroups,
        backup: result.backupRemote || "-",
      });
    }
    return;
  }
  if (action === "status" || action === "doctor") {
    const config = await loadConfig();
    const maintenance = config.yandex?.contactsMaintenance || {};
    printKeyValue({
      enabled: maintenance.enabled ? "yes" : "no",
      days: maintenance.days || "-",
      backup: maintenance.backup ? "yes" : "no",
      lastRunAt: maintenance.lastRunAt || "-",
      lastTotal: maintenance.lastTotal || "-",
      lastIncomplete: maintenance.lastIncomplete || "-",
      lastDuplicateGroups: maintenance.lastDuplicateGroups || "-",
      cron: listCronJobs().some((job) => job.command === "yandex contacts-maintenance tick") ? "yes" : "no",
    });
    return;
  }
  throw new Error("Команды: iola yandex contacts-maintenance on --days 7 [--backup] | off | status | tick");
}

async function setupYandexConnector(args = []) {
  const options = parseOptions(args);
  const config = await loadConfig();
  const oauthApps = getConfiguredYandexOAuthApps();
  const authorizedServices = getYandexOAuthCapableServiceIds();
  const enabledServices = config.yandex?.enabledServices?.length ? config.yandex.enabledServices : ["identity", "disk"];
  await saveYandexAuthorizedServices(authorizedServices);
  await saveYandexEnabledServices(enabledServices);

  const clientId = options["client-id"] || config.yandex?.oauth?.clientId || oauthApps[0]?.clientId || "";
  const redirectUrl = options["redirect-url"] || getYandexConnectorRedirectUrl();
  if (clientId) {
    await saveConfig({
      yandex: {
        ...(config.yandex || {}),
        oauth: { ...(config.yandex?.oauth || {}), clientId, redirectUrl },
      },
    });
  }

  console.log("Yandex Connector настроен.");
  console.log(`OAuth-права встроенного приложения: ${authorizedServices.join(", ")}`);
  console.log(`Активные функции CLI: ${normalizeYandexServiceList(enabledServices).join(", ")}`);
  console.log("Выбрать активные функции можно командой /yandex или iola yandex menu.");
  if (clientId || oauthApps.length) {
    if (process.stdin.isTTY && !options["print-url"]) {
      const secrets = await loadSecrets();
      console.log("Открываю браузер для входа в Яндекс. После авторизации токен сохранится автоматически.");
      for (const app of oauthApps.length ? oauthApps : [{ id: "custom", title: "Yandex Connector", clientId, services: authorizedServices }]) {
        if (!options.force && hasYandexOAuthAppToken(secrets, app.id)) {
          console.log(`Авторизация: ${app.title} уже подключена, пропускаю.`);
          continue;
        }
        console.log(`Авторизация: ${app.title}`);
        await runYandexBrowserOAuth({ appId: app.id, clientId: app.clientId, services: app.services, redirectUrl });
      }
      await printYandexConnectorStatus({ check: true });
    } else {
      console.log("Откройте ссылки авторизации, получите OAuth-токены и сохраните их командой: iola yandex token set --app APP_ID");
      for (const app of oauthApps.length ? oauthApps : [{ id: "custom", title: "Yandex Connector", clientId, services: authorizedServices }]) {
        const url = buildYandexOAuthUrl({ clientId: app.clientId, services: app.services, redirectUrl });
        console.log(`${app.id}: ${url}`);
        if (options.open) await openUrl(url);
      }
    }
  } else {
    console.log("Yandex Connector не может открыть браузер: в этой сборке не задан public OAuth client_id приложения IOLA.");
    console.log("Нужно один раз зарегистрировать OAuth-приложение IOLA и задать IOLA_YANDEX_OAUTH_CLIENT_ID при сборке/запуске CLI.");
    console.log("Ручной fallback для разработки: iola yandex setup --client-id CLIENT_ID");
  }
}

async function chooseYandexServicesMenu() {
  if (!process.stdin.isTTY) {
    await printYandexConnectorStatus();
    return;
  }
  const config = await loadConfig();
  const serviceIds = getYandexConnectorMenuServiceIds();
  const cloudNumber = serviceIds.length + 1;
  const goNumber = serviceIds.length + 2;
  const deleteNumber = serviceIds.length + 3;
  const enabled = new Set(config.yandex?.enabledServices?.length ? config.yandex.enabledServices : ["identity", "disk"]);
  const authState = await getYandexServiceAuthState();
  const cloudStatus = await getYandexCloudConnectorSummary();
  console.log("Функции Яндекса.");
  console.log("Выберите номера функций через запятую:");
  serviceIds.forEach((id, index) => {
    const service = YANDEX_CONNECTOR_SERVICES[id];
    const marker = enabled.has(id) ? "✓" : " ";
    const auth = authState.byService[id];
    const authLabel = auth?.hasToken ? "подключено" : (auth?.authorized ? "нужен вход" : "нет прав");
    console.log(`${index + 1}. [${marker}] ${service.title} - ${service.hint} (${service.status}, ${authLabel})`);
  });
  console.log(`${cloudNumber}. Yandex Cloud Connector - геокодинг и YandexGPT (${cloudStatus})`);
  console.log(`${goNumber}. Yandex Go / Такси - deeplink и маршрут (готово, заказ через API ожидает clid/apikey)`);
  console.log(`${deleteNumber}. Удалить подключение-коннектор`);
  console.log("0. Отмена");
  const defaults = serviceIds.map((id, index) => enabled.has(id) ? String(index + 1) : "").filter(Boolean);
  const answer = (await askText(`Номера через запятую [${defaults.join(",") || "1,2"}]: `)).trim();
  if (answer === "0") {
    console.log("Выбор сервисов отменен.");
    return;
  }
  const selectedNumbers = answer ? answer.split(/[,\s]+/).filter(Boolean) : (defaults.length ? defaults : ["1", "2"]);
  if (selectedNumbers.includes(String(deleteNumber))) {
    if (selectedNumbers.length > 1) throw new Error("Удаление коннектора выбирается отдельно, без других пунктов.");
    const ok = await askYesNo("Удалить локальные токены и настройки Yandex Connector? [y/N] ", false);
    if (!ok) {
      console.log("Удаление отменено.");
      return;
    }
    await deleteYandexConnectorToken();
    return;
  }
  if (selectedNumbers.includes(String(cloudNumber))) {
    if (selectedNumbers.length > 1) throw new Error("Yandex Cloud Connector выбирается отдельно, без других пунктов.");
    await chooseYandexCloudConnectorMenu();
    return;
  }
  if (selectedNumbers.includes(String(goNumber))) {
    if (selectedNumbers.length > 1) throw new Error("Yandex Go выбирается отдельно, без других пунктов.");
    await handleYandexGo(["status"]);
    console.log('Для маршрута: iola yandex go open --from "Адрес" --to "Адрес" --tariff econom');
    return;
  }
  const selected = selectedNumbers.map((item) => {
    const index = Number(item) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= serviceIds.length) {
      throw new Error(`Неизвестный номер сервиса: ${item}`);
    }
    return serviceIds[index];
  });
  await saveYandexEnabledServices(selected);
  console.log(`Включены сервисы: ${normalizeYandexServiceList(selected).join(", ")}`);
  const missingAuth = selected.filter((id) => !authState.byService[id]?.authorized);
  const missingToken = selected.filter((id) => authState.byService[id]?.authorized && !authState.byService[id]?.hasToken);
  if (missingAuth.length) console.log(`Нет OAuth-прав в текущей сборке: ${missingAuth.join(", ")}. Для них нужно отдельное OAuth-приложение Яндекса.`);
  if (missingToken.length) console.log(`Нужно пройти вход Яндекса для: ${missingToken.join(", ")}. Запустите iola yandex setup.`);
}

function getYandexConnectorMenuServiceIds() {
  return Object.entries(YANDEX_CONNECTOR_SERVICES)
    .filter(([, service]) => (service.status === "ready" || service.status === "research") && service.scope)
    .map(([id]) => id);
}

async function chooseYandexCloudConnectorMenu() {
  const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);
  const enabled = new Set(config.yandex?.cloudConnector?.enabledServices || ["geocoder"]);
  const geocoderConfigured = Boolean(process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY || secrets.yandexCloud?.geocoderApiKey || secrets.yandexGeocoder?.apiKey);
  const gptConfigured = Boolean((process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY || secrets.yandexCloud?.yandexgptApiKey || secrets.yandexgpt?.apiKey)
    && (process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexCloud?.folderId || secrets.yandexgpt?.folderId));
  console.log("Yandex Cloud Connector.");
  console.log("1. Настроить/обновить ключи");
  console.log(`2. [${enabled.has("geocoder") ? "✓" : " "}] Геокодер (${geocoderConfigured ? "ключ есть" : "ключ не задан"})`);
  console.log(`3. [${enabled.has("yandexgpt") ? "✓" : " "}] YandexGPT (${gptConfigured ? "ключ и folder ID есть" : "не настроено"})`);
  console.log("4. Проверить подключение");
  console.log("5. Удалить Cloud Connector");
  console.log("0. Назад");
  const answer = (await askText("Номер: ")).trim();
  if (answer === "0" || !answer) return;
  if (answer === "1") return setupYandexCloudConnector({});
  if (answer === "2") {
    if (enabled.has("geocoder")) await updateYandexCloudEnabledServices(["geocoder"], false);
    else await updateYandexCloudEnabledServices(["geocoder"], true);
    return;
  }
  if (answer === "3") {
    if (enabled.has("yandexgpt")) await updateYandexCloudEnabledServices(["yandexgpt"], false);
    else await updateYandexCloudEnabledServices(["yandexgpt"], true);
    return;
  }
  if (answer === "4") return printYandexCloudConnectorStatus({ check: true });
  if (answer === "5") return handleYandexCloudConnector(["delete"]);
}

async function getYandexCloudConnectorSummary() {
  const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);
  const enabled = config.yandex?.cloudConnector?.enabledServices || [];
  const geocoder = Boolean(process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY || secrets.yandexCloud?.geocoderApiKey || secrets.yandexGeocoder?.apiKey);
  const gpt = Boolean((process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY || secrets.yandexCloud?.yandexgptApiKey || secrets.yandexgpt?.apiKey)
    && (process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexCloud?.folderId || secrets.yandexgpt?.folderId));
  if (geocoder && gpt) return `готово: ${enabled.join(", ") || "geocoder"}`;
  if (geocoder) return "частично: geocoder";
  return "не настроено";
}

async function updateYandexEnabledServices(rawServices, enabled) {
  const config = await loadConfig();
  const current = new Set(config.yandex?.enabledServices || []);
  for (const service of normalizeYandexServiceList(rawServices)) {
    if (enabled) current.add(service);
    else current.delete(service);
  }
  await saveYandexEnabledServices([...current]);
  console.log(`Yandex services: ${[...current].join(", ") || "-"}`);
}

async function saveYandexEnabledServices(services) {
  const config = await loadConfig();
  const normalized = normalizeYandexServiceList(services);
  if (normalized.length > 0 && !normalized.includes("identity")) normalized.unshift("identity");
  const categories = {};
  for (const id of normalized) {
    const meta = YANDEX_CONNECTOR_SERVICES[id];
    if (meta) categories[meta.category] = [...new Set([...(categories[meta.category] || []), id])];
  }
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      enabledServices: normalized,
      categories,
    },
  });
}

async function saveYandexAuthorizedServices(services) {
  const config = await loadConfig();
  const normalized = normalizeYandexServiceList(services.length ? services : getYandexOAuthCapableServiceIds());
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      authorizedServices: normalized,
    },
  });
}

async function buildYandexOAuthUrlFromConfig(rawArgs = []) {
  const options = parseOptions(rawArgs);
  const config = await loadConfig();
  const apps = getConfiguredYandexOAuthApps();
  const capableServices = getYandexOAuthCapableServiceIds();
  const requestedServices = normalizeYandexServiceList(options._.length ? options._ : capableServices);
  const app = options.app
    ? apps.find((item) => item.id === options.app)
    : apps.find((item) => requestedServices.some((service) => item.services.includes(service))) || apps[0];
  const clientId = options["client-id"] || app?.clientId || config.yandex?.oauth?.clientId || YANDEX_CONNECTOR_CLIENT_ID;
  if (!clientId) throw new Error("Yandex OAuth Client ID не задан. Пример: iola yandex oauth-url disk --client-id CLIENT_ID");
  const services = requestedServices.filter((id) => capableServices.includes(id) && (!app || app.services.includes(id)));
  return buildYandexOAuthUrl({ clientId, services, redirectUrl: options["redirect-url"] || config.yandex?.oauth?.redirectUrl || YANDEX_OAUTH_REDIRECT_URL });
}

function buildYandexOAuthUrl({ clientId, services, redirectUrl = YANDEX_OAUTH_REDIRECT_URL }) {
  const scopes = getYandexScopesForServices(services);
  const url = new URL(YANDEX_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUrl);
  if (scopes) url.searchParams.set("scope", scopes);
  return url.toString();
}

function getYandexConnectorRedirectUrl() {
  return `http://${YANDEX_CONNECTOR_REDIRECT_HOST}:${YANDEX_CONNECTOR_REDIRECT_PORT}${YANDEX_CONNECTOR_REDIRECT_PATH}`;
}

async function runYandexBrowserOAuth({ appId = "core", clientId, services, redirectUrl }) {
  let token = "";
  try {
    token = await waitForYandexOAuthToken({ clientId, services, redirectUrl });
  } catch (error) {
    if (!process.stdin.isTTY || !String(error?.message || error).includes("Время ожидания")) throw error;
    console.log("Автоматический прием OAuth-токена не сработал.");
    console.log("Если в адресной строке браузера есть access_token, вставьте только значение access_token.");
    token = (await askText("Yandex OAuth access_token [Enter - пропустить]: ")).trim();
    if (!token) throw error;
  }
  await setYandexConnectorToken(["--token", token, "--app", appId]);
  console.log("Yandex Connector подключен.");
}

function waitForYandexOAuthToken({ clientId, services, redirectUrl }) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const timeoutMs = 180000;
    const debug = process.env.IOLA_YANDEX_OAUTH_DEBUG === "1";
    const logDebug = (message) => {
      if (debug) console.log(`[yandex-oauth] ${message}`);
    };
    const finish = (token) => {
      if (!token) throw new Error("Yandex OAuth token не получен.");
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        logDebug("token received");
        resolvePromise(String(token));
      }
    };
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", redirectUrl);
        if (url.pathname === YANDEX_CONNECTOR_REDIRECT_PATH && req.method === "GET") {
          logDebug(`GET ${url.pathname}${url.search || ""}`);
          const tokenFromQuery = url.searchParams.get("access_token") || url.searchParams.get("token");
          const errorFromQuery = url.searchParams.get("error") || "";
          if (errorFromQuery) throw new Error(`Yandex OAuth error: ${errorFromQuery}`);
          if (tokenFromQuery) {
            finish(tokenFromQuery);
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end("<p>Yandex Connector подключен. Можно закрыть вкладку и вернуться в терминал.</p>");
            server.close();
            return;
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>IOLA Yandex Connector</title></head>
<body>
<p>Передаю токен в iola-cli...</p>
<script>
(async () => {
  const params = new URLSearchParams(location.hash.replace(/^#/, "") || location.search.replace(/^\\?/, ""));
  const token = params.get("access_token");
  const error = params.get("error") || "";
  const qs = new URLSearchParams({ token: token || "", error }).toString();
  try {
    await fetch("/yandex/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, error })
    });
  } catch {
    location.replace("/yandex/oauth/token?" + qs);
    return;
  }
  document.body.innerHTML = token
    ? "<p>Yandex Connector подключен. Можно закрыть вкладку и вернуться в терминал.</p>"
    : "<p>Не удалось получить токен. Вернитесь в терминал.</p>";
  if (!token || error) location.replace("/yandex/oauth/token?" + qs);
})();
</script>
</body></html>`);
          return;
        }
        if (url.pathname === "/yandex/oauth/token" && req.method === "GET") {
          logDebug(`GET ${url.pathname}${url.search || ""}`);
          const token = url.searchParams.get("token") || url.searchParams.get("access_token");
          const error = url.searchParams.get("error") || "";
          if (error) throw new Error(`Yandex OAuth error: ${error}`);
          finish(token);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<p>Yandex Connector подключен. Можно закрыть вкладку и вернуться в терминал.</p>");
          server.close();
          return;
        }
        if (url.pathname === "/yandex/oauth/token" && req.method === "POST") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          logDebug(`POST ${url.pathname}; token=${payload.token ? "yes" : "no"} error=${payload.error ? "yes" : "no"}`);
          if (payload.error) throw new Error(`Yandex OAuth error: ${payload.error}`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          res.on("finish", () => {
            try {
              finish(payload.token);
            } catch (error) {
              if (!settled) reject(error);
            }
            server.close();
          });
          return;
        }
        res.writeHead(404);
        res.end("not found");
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(error instanceof Error ? error.message : String(error));
        server.close();
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Время ожидания авторизации Яндекса истекло."));
      }
    }, timeoutMs);
    server.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen(YANDEX_CONNECTOR_REDIRECT_PORT, YANDEX_CONNECTOR_REDIRECT_HOST, async () => {
      const authUrl = buildYandexOAuthUrl({ clientId, services, redirectUrl });
      console.log(`Если браузер не открылся, откройте ссылку вручную: ${authUrl}`);
      console.log("Ожидаю возврат токена из браузера...");
      try {
        await openUrl(authUrl);
      } catch (error) {
        console.log(`Не удалось открыть браузер автоматически: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
}

function getYandexScopesForServices(services) {
  const scopes = new Set();
  const normalized = normalizeYandexServiceList(services);
  for (const id of normalized) {
    const raw = YANDEX_CONNECTOR_SERVICES[id]?.scope || "";
    for (const scope of raw.split(/\s+/).filter(Boolean)) scopes.add(scope);
  }
  return [...scopes].join(" ");
}

function getYandexOAuthCapableServiceIds() {
  return [...new Set(getConfiguredYandexOAuthApps().flatMap((app) => app.services))];
}

function getConfiguredYandexOAuthApps() {
  return YANDEX_CONNECTOR_OAUTH_APPS
    .filter((app) => app.clientId)
    .map((app) => ({ ...app, services: normalizeYandexServiceList(app.services) }));
}

function getYandexOAuthAppById(appId) {
  return getConfiguredYandexOAuthApps().find((app) => app.id === appId)
    || YANDEX_CONNECTOR_OAUTH_APPS.find((app) => app.id === appId)
    || null;
}

function getYandexConnectorConnectedAppIds(secrets = {}) {
  const apps = new Set(Object.keys(secrets.yandex?.oauthApps || {}));
  if (secrets.yandex?.oauthToken) apps.add("core");
  if (secrets.cloud?.["yandex-disk"]?.token) apps.add("core");
  return apps;
}

function hasYandexOAuthAppToken(secrets = {}, appId = "core") {
  if (process.env.YANDEX_OAUTH_TOKEN) return true;
  if (secrets.yandex?.oauthApps?.[appId]?.token) return true;
  if (appId === "core" && (secrets.yandex?.oauthToken || secrets.cloud?.["yandex-disk"]?.token)) return true;
  return false;
}

function isYandexConnectorFullyConnected(secrets = {}) {
  if (process.env.YANDEX_OAUTH_TOKEN) return true;
  const connected = getYandexConnectorConnectedAppIds(secrets);
  const required = getConfiguredYandexOAuthApps().map((app) => app.id);
  return required.length > 0 && required.every((id) => connected.has(id));
}

function getYandexConnectorSecretStatus(secrets = {}) {
  if (process.env.YANDEX_OAUTH_TOKEN) return "env";
  const connected = getYandexConnectorConnectedAppIds(secrets);
  const required = getConfiguredYandexOAuthApps().map((app) => app.id);
  if (required.length === 0) return connected.size ? "local" : "missing";
  if (required.every((id) => connected.has(id))) return "ready";
  if (connected.size > 0) return `partial (${[...connected].join(", ")})`;
  return "missing";
}

async function setYandexConnectorToken(args = []) {
  const options = parseOptions(args);
  const appId = options.app || "core";
  const token = options.token || (process.stdin.isTTY ? (await askText("Yandex OAuth token: ")).trim() : "");
  if (!token) throw new Error("OAuth token обязателен.");
  const app = getYandexOAuthAppById(appId);
  const appServices = normalizeYandexServiceList(app?.services || []);
  const hasDiskAccess = appServices.includes("disk") || appId === "core";
  const secrets = await loadSecrets();
  secrets.yandex = secrets.yandex || {};
  secrets.yandex.oauthApps = secrets.yandex.oauthApps || {};
  secrets.yandex.oauthApps[appId] = { token, updatedAt: new Date().toISOString() };
  if (appId === "core") secrets.yandex.oauthToken = token;
  secrets.yandex.updatedAt = new Date().toISOString();
  if (hasDiskAccess) {
    secrets.cloud = secrets.cloud || {};
    secrets.cloud["yandex-disk"] = { token };
  }
  await saveSecrets(secrets);
  if (hasDiskAccess) {
    const config = await loadConfig();
    await saveConfig({ cloud: { ...(config.cloud || {}), activeProvider: "yandex-disk" } });
  }
  console.log(`Yandex OAuth token сохранен локально: ${SECRETS_FILE}`);
  if (hasDiskAccess) console.log("Токен также подключен к cloud provider yandex-disk.");
}

async function deleteYandexConnectorToken() {
  const secrets = await loadSecrets();
  delete secrets.yandex;
  if (secrets.cloud?.["yandex-disk"]) delete secrets.cloud["yandex-disk"];
  if (secrets.cloud && Object.keys(secrets.cloud).length === 0) delete secrets.cloud;
  await saveSecrets(secrets);
  await deleteLocalYandexConnectorConfig();
  console.log("Yandex Connector удален локально. Токены и настройки приложений очищены.");
}

async function deleteLocalYandexConnectorConfig() {
  const local = await readConfigLayer(CONFIG_FILE);
  if (!local) return;
  delete local.yandex;
  if (local.cloud?.activeProvider === "yandex-disk") local.cloud.activeProvider = "";
  await mkdir(CONFIG_DIR, { recursive: true });
  if (existsSync(CONFIG_FILE)) await copyFile(CONFIG_FILE, LAST_GOOD_CONFIG_FILE).catch(() => {});
  await writeFile(CONFIG_FILE, `${JSON.stringify(local, null, 2)}\n`, "utf8");
}

async function printYandexConnectorStatus(options = {}) {
  const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);
  const enabled = config.yandex?.enabledServices || [];
  const legacyDiskToken = Boolean(secrets.cloud?.["yandex-disk"]?.token && !secrets.yandex?.oauthToken);
  const authState = await getYandexServiceAuthState({ config, secrets });
  const token = process.env.YANDEX_OAUTH_TOKEN || secrets.yandex?.oauthToken || secrets.cloud?.["yandex-disk"]?.token || "";
  const rows = Object.entries(YANDEX_CONNECTOR_SERVICES).map(([id, service]) => ({
    id,
    enabled: enabled.includes(id) ? "yes" : (legacyDiskToken && id === "disk" ? "legacy" : "no"),
    category: service.category,
    status: service.status,
    token: service.scope && authState.byService[id]?.authorized ? (authState.byService[id]?.hasToken ? "local/env" : "missing") : "-",
    authorized: authState.byService[id]?.authorized ? "yes" : "-",
    title: service.title,
  }));
  printTable(rows, [
    ["id", "ID"],
    ["enabled", "Вкл"],
    ["category", "Категория"],
    ["status", "Статус"],
    ["authorized", "Права"],
    ["token", "Токен"],
    ["title", "Сервис"],
  ]);
  if (options.check && token) {
    const profile = await yandexUserInfo(token).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    console.log("");
    if (profile.error) console.log(`Yandex ID check: ${profile.error}`);
    else printKeyValue({
      login: profile.login || "-",
      displayName: profile.display_name || profile.real_name || "-",
      defaultEmail: profile.default_email || "-",
    });
  }
}

async function getYandexServiceAuthState({ config = null, secrets = null } = {}) {
  const loadedConfig = config || await loadConfig();
  const loadedSecrets = secrets || await loadSecrets();
  const apps = getConfiguredYandexOAuthApps();
  const appTokens = loadedSecrets.yandex?.oauthApps || {};
  const envToken = process.env.YANDEX_OAUTH_TOKEN || "";
  const byService = {};
  for (const id of Object.keys(YANDEX_CONNECTOR_SERVICES)) {
    byService[id] = { authorized: false, hasToken: false, apps: [] };
  }
  for (const app of apps) {
    const hasToken = Boolean(envToken || appTokens[app.id]?.token || (app.id === "core" && loadedSecrets.yandex?.oauthToken));
    for (const id of normalizeYandexServiceList(app.services)) {
      byService[id] = byService[id] || { authorized: false, hasToken: false, apps: [] };
      byService[id].authorized = true;
      byService[id].hasToken = byService[id].hasToken || hasToken;
      byService[id].apps.push(app.id);
    }
  }
  if (loadedSecrets.cloud?.["yandex-disk"]?.token) {
    byService.disk.authorized = true;
    byService.disk.hasToken = true;
    byService.disk.apps.push("legacy-cloud");
  }
  const authorizedServices = Object.entries(byService).filter(([, state]) => state.authorized).map(([id]) => id);
  const enabledServices = loadedConfig.yandex?.enabledServices || [];
  return { byService, authorizedServices, enabledServices };
}

async function yandexUserInfo(token) {
  const response = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Yandex ID недоступен: ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function getYandexOAuthToken(appId = "core") {
  if (process.env.YANDEX_OAUTH_TOKEN) return process.env.YANDEX_OAUTH_TOKEN;
  const secrets = await loadSecrets();
  return secrets.yandex?.oauthApps?.[appId]?.token
    || (appId === "core" ? secrets.yandex?.oauthToken || secrets.cloud?.["yandex-disk"]?.token : "")
    || "";
}

async function requireYandexOAuthToken(appId = "core", service = "Yandex Connector") {
  const token = await getYandexOAuthToken(appId);
  if (!token) throw new Error(`${service} не подключен. Запустите: iola yandex setup`);
  return token;
}

async function getYandexIdentityProfile() {
  const token = await requireYandexOAuthToken("core", "Yandex ID");
  const profile = await yandexUserInfo(token);
  return {
    login: profile.login || "",
    displayName: profile.display_name || profile.real_name || "",
    defaultEmail: profile.default_email || profile.default_email_alias || "",
    emails: profile.emails || [],
  };
}

async function yandexDiskInfo() {
  const payload = await yandexDiskRequest("GET", "/", { query: { fields: "total_space,used_space,trash_size,system_folders" } });
  return {
    provider: "yandex-disk",
    totalSpace: payload.total_space || 0,
    usedSpace: payload.used_space || 0,
    trashSize: payload.trash_size || 0,
  };
}

async function yandexDiskSaveText(text, remotePath) {
  if (!text) throw new Error("Текст для сохранения пустой.");
  const target = remotePath || `${CLOUD_DEFAULT_REMOTE_DIR}/notes/iola-${timestampForFile()}.txt`;
  const tempPath = path.join(CONFIG_DIR, `yandex-save-${Date.now()}.txt`);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(tempPath, text, "utf8");
  try {
    return await yandexDiskUpload(tempPath, target, { overwrite: true });
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function yandexDiskUnshare(remotePath) {
  await yandexDiskRequest("PUT", "/resources/unpublish", { query: { path: normalizeYandexDiskPath(remotePath) } });
  return { provider: "yandex-disk", remote: remotePath, status: "unpublished" };
}

async function yandexDiskDelete(remotePath, options = {}) {
  if (!options.confirm) throw new Error("Для удаления с Яндекс Диска нужен аргумент confirm=true.");
  await yandexDiskRequest("DELETE", "/resources", { query: { path: normalizeYandexDiskPath(remotePath), permanently: Boolean(options.permanently) } });
  return { provider: "yandex-disk", remote: remotePath, status: options.permanently ? "deleted-permanently" : "moved-to-trash" };
}

async function executeYandexTool(tool, args = {}) {
  if (tool === "yandex_identity_me") return getYandexIdentityProfile();
  if (tool === "yandex_disk_info") return yandexDiskInfo();
  if (tool === "yandex_disk_ls") return yandexDiskList(args.path || args.remotePath || CLOUD_DEFAULT_REMOTE_DIR, { allowMissingRoot: true });
  if (tool === "yandex_disk_mkdir") return cloudCreateFolder("yandex-disk", args.path || args.remotePath || `${CLOUD_DEFAULT_REMOTE_DIR}/Новая папка`);
  if (tool === "yandex_disk_find") return yandexDiskFind(args.query || args.name || "", { path: args.path || CLOUD_DEFAULT_REMOTE_DIR, depth: args.depth || 4, limit: args.limit || 20 });
  if (tool === "yandex_disk_stat") return yandexDiskStat(args.path || args.remotePath || CLOUD_DEFAULT_REMOTE_DIR);
  if (tool === "yandex_disk_exists") return yandexDiskExists(args.path || args.remotePath || CLOUD_DEFAULT_REMOTE_DIR);
  if (tool === "yandex_disk_read_text") return yandexDiskReadText(args.path || args.remotePath, { maxBytes: args.maxBytes || args["max-bytes"] });
  if (tool === "yandex_disk_save_text") return yandexDiskSaveText(args.text || args.content || "", args.path || args.remotePath);
  if (tool === "yandex_disk_upload") return yandexDiskUpload(args.localPath || args.file || args.path, args.remotePath || args.remote || `${CLOUD_DEFAULT_REMOTE_DIR}/${path.basename(args.localPath || args.file || "file.txt")}`, { overwrite: args.overwrite !== false });
  if (tool === "yandex_disk_download") return yandexDiskDownload(args.remotePath || args.path, args.outputPath || args.output || path.basename(args.remotePath || args.path || "download"));
  if (tool === "yandex_disk_move") return yandexDiskMove(args.from || args.source || args.path, args.to || args.target || args.remotePath, args);
  if (tool === "yandex_disk_copy") return yandexDiskCopy(args.from || args.source || args.path, args.to || args.target || args.remotePath, args);
  if (tool === "yandex_disk_rename") return yandexDiskRename(args.path || args.remotePath, args.name || args.newName || args.to, args);
  if (tool === "yandex_disk_share") {
    if (!args.confirm) throw new Error("Для публикации ссылки нужен аргумент confirm=true.");
    return yandexDiskShare(args.remotePath || args.path);
  }
  if (tool === "yandex_disk_share_qr") return yandexDiskShareWithQr(args.remotePath || args.path, args);
  if (tool === "yandex_disk_share_email") return yandexDiskShareEmail(args);
  if (tool === "yandex_disk_package_share_email") return yandexDiskPackageShareEmail(args);
  if (tool === "yandex_disk_unshare") return yandexDiskUnshare(args.remotePath || args.path);
  if (tool === "yandex_disk_delete") return yandexDiskDelete(args.remotePath || args.path, args);
  if (tool === "yandex_disk_trash_list") return yandexDiskTrashList(args.path || args.remotePath || "", args);
  if (tool === "yandex_disk_restore") return yandexDiskRestore(args.path || args.remotePath, args);
  if (tool === "yandex_disk_empty_trash") return yandexDiskEmptyTrash(args);
  if (tool === "yandex_mail_status") return yandexMailStatus();
  if (tool === "yandex_mail_folders") return yandexMailFolders();
  if (tool === "yandex_mail_list") return yandexMailList({ mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), limit: args.limit || 10, unread: Boolean(args.unread) });
  if (tool === "yandex_mail_search") return yandexMailSearch(args.query || "", { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), limit: args.limit || 20 });
  if (tool === "yandex_mail_read") return yandexMailRead(args.uid || args.id, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: args.markSeen !== false });
  if (tool === "yandex_mail_send") return yandexMailSend(args);
  if (tool === "yandex_mail_reply") return yandexMailReply(args);
  if (tool === "yandex_mail_forward") return yandexMailForward(args);
  if (tool === "yandex_mail_delete") return yandexMailDelete(args.uid || args.id, { ...args, mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX") });
  if (tool === "yandex_mail_mark") return yandexMailMark(args.uid || args.id, args.seen !== false && args.unread !== true, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX") });
  if (tool === "yandex_mail_save_to_disk") return yandexMailSaveToDisk(args.uid || args.id, args);
  if (tool === "yandex_mail_create_calendar_event") return yandexMailCreateCalendarEvent(args.uid || args.id, args);
  if (tool === "yandex_mail_sender_to_contact") return yandexMailSenderToContact(args.uid || args.id, args);
  if (tool === "yandex_mail_city_context") return yandexMailCityContext(args.uid || args.id, args);
  if (tool === "yandex_mail_map_addresses") return yandexMailMapAddresses(args.uid || args.id, args);
  if (tool === "yandex_mail_create_task") return yandexMailCreateTask(args.uid || args.id, args);
  if (tool === "yandex_mail_meeting_pack") return yandexMailMeetingPack(args.uid || args.id, args);
  if (tool === "yandex_calendar_status") return yandexCalendarStatus();
  if (tool === "yandex_calendar_calendars") return yandexCalendarCalendars(args);
  if (tool === "yandex_calendar_create_event") return yandexCalendarCreateEvent(args);
  if (tool === "yandex_calendar_list") return yandexCalendarList(args);
  if (tool === "yandex_calendar_get") return yandexCalendarGet(args.query || args.uid || args.title || "", args);
  if (tool === "yandex_calendar_search") return yandexCalendarSearch(args.query || args.title || "", args);
  if (tool === "yandex_calendar_update") return yandexCalendarUpdate(args.query || args.uid || args.title || "", args);
  if (tool === "yandex_calendar_move") return yandexCalendarMove(args.query || args.uid || args.title || "", args);
  if (tool === "yandex_calendar_delete") return yandexCalendarDelete(args.query || args.uid || args.title || "", args);
  if (tool === "yandex_calendar_create_recurring_event") return yandexCalendarCreateRecurringEvent(args);
  if (tool === "yandex_calendar_add_reminder") return yandexCalendarAddReminder(args.query || args.uid || args.title || "", args);
  if (tool === "yandex_docs_status") return yandexDocsStatus();
  if (tool === "yandex_docs_list") return yandexDocsList(args);
  if (tool === "yandex_docs_find") return yandexDocsFind(args.query || args.name || "", args);
  if (tool === "yandex_docs_create_text") return yandexDocsCreateText(args);
  if (tool === "yandex_docs_read") return yandexDocsRead(args.path || args.remotePath || args.query || args.name, args);
  if (tool === "yandex_docs_share") return yandexDocsShare(args.path || args.remotePath || args.query || args.name, args);
  if (tool === "yandex_docs_rename") return yandexDocsRename(args.path || args.remotePath || args.query || args.name, args.name || args.newName || args.to, args);
  if (tool === "yandex_docs_delete") return yandexDocsDelete(args.path || args.remotePath || args.query || args.name, args);
  if (tool === "yandex_docs_save_answer") return yandexDocsCreateText({ ...args, text: args.text || args.answer || args.content });
  if (tool === "yandex_contacts_status") return yandexContactsStatus();
  if (tool === "yandex_contacts_list") return yandexContactsList(args);
  if (tool === "yandex_contacts_search") return yandexContactsSearch(args.query || "", args);
  if (tool === "yandex_contacts_get") return yandexContactsGet(args.query || args.name || args.email || args.phone || "", args);
  if (tool === "yandex_contacts_create") return yandexContactsCreate(args);
  if (tool === "yandex_contacts_update") return yandexContactsUpdate(args.query || args.name || args.email || "", args);
  if (tool === "yandex_contacts_delete") return yandexContactsDelete(args.query || args.name || args.email || "", args);
  if (tool === "yandex_contacts_add_email") return yandexContactsAddEmail(args.query || args.name || "", args.email, args);
  if (tool === "yandex_contacts_add_phone") return yandexContactsUpdate(args.query || args.name || "", { ...args, phone: args.phone, mode: "add-phone" });
  if (tool === "yandex_contacts_add_address") return yandexContactsUpdate(args.query || args.name || "", { ...args, address: args.address, mode: "add-address" });
  if (tool === "yandex_contacts_add_note") return yandexContactsUpdate(args.query || args.name || "", { ...args, note: args.note || args.text, mode: "add-note" });
  if (tool === "yandex_contacts_add_birthday") return yandexContactsUpdate(args.query || args.name || "", { ...args, birthday: args.birthday || args.date, mode: "add-birthday" });
  if (tool === "yandex_contacts_add_org") return yandexContactsUpdate(args.query || args.name || "", { ...args, org: args.org || args.organization, title: args.title || args.position, mode: "add-org" });
  if (tool === "yandex_contacts_remove_email") return yandexContactsUpdate(args.query || args.name || "", { ...args, removeEmail: args.email || true, mode: "remove-email" });
  if (tool === "yandex_contacts_remove_phone") return yandexContactsUpdate(args.query || args.name || "", { ...args, removePhone: args.phone || true, mode: "remove-phone" });
  if (tool === "yandex_contacts_export_vcard") return yandexContactsExport("vcard", args);
  if (tool === "yandex_contacts_export_csv") return yandexContactsExport("csv", args);
  if (tool === "yandex_contacts_import_vcard") return yandexContactsImport("vcard", args);
  if (tool === "yandex_contacts_import_csv") return yandexContactsImport("csv", args);
  if (tool === "yandex_contacts_find_incomplete") return yandexContactsFindIncomplete(args);
  if (tool === "yandex_contacts_find_duplicates") return yandexContactsFindDuplicates(args);
  if (tool === "yandex_contacts_backup_to_disk") return yandexContactsBackupToDisk(args);
  if (tool === "yandex_contacts_birthdays_to_calendar") return yandexContactsBirthdaysToCalendar(args);
  if (tool === "yandex_contact_send_mail") return yandexContactSendMail(args);
  if (tool === "yandex_contact_send_disk_link_qr") return yandexContactSendDiskLinkQr(args);
  if (tool === "yandex_contact_create_disk_folder") return yandexContactCreateDiskFolder(args);
  if (tool === "yandex_contact_create_calendar_event") return yandexContactCreateCalendarEvent(args);
  if (tool === "yandex_contact_create_telemost_event") return yandexContactCreateTelemostEvent(args);
  if (tool === "yandex_contact_from_public_entity") return yandexContactFromPublicEntity(args);
  if (tool === "yandex_telemost_status") return yandexTelemostStatus();
  if (tool === "yandex_telemost_create_event") return yandexTelemostCreateEvent(args);
  if (tool === "yandex_contact_full_pack") return yandexContactFullPack(args);
  if (tool === "yandex_daily_digest") return yandexDailyDigestTick({ ...args, force: true });
  if (tool === "yandex_calendar_reminders_tick") return yandexCalendarRemindersTick({ ...args, force: true });
  if (tool === "yandex_disk_maintenance_tick") return yandexDiskMaintenanceTick({ ...args, force: true });
  if (tool === "yandex_cloud_status") {
    const [secrets, config] = await Promise.all([loadSecrets(), loadConfig()]);
    return {
      geocoder: Boolean(process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY || secrets.yandexCloud?.geocoderApiKey || secrets.yandexGeocoder?.apiKey),
      yandexgpt: Boolean((process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY || secrets.yandexCloud?.yandexgptApiKey || secrets.yandexgpt?.apiKey)
        && (process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexCloud?.folderId || secrets.yandexgpt?.folderId)),
      enabled: config.yandex?.cloudConnector?.enabledServices || [],
    };
  }
  if (tool === "yandex_go_deeplink") {
    await ensureYandexGoGeocoderReady();
    return buildYandexGoDeeplinkFromOptions({ from: args.from, to: args.to, tariff: args.tariff || args.class || args.level, ref: args.ref, lang: args.lang });
  }
  throw new Error(`Yandex tool неизвестен: ${tool}`);
}

async function yandexMailCredentials() {
  const [token, profile] = await Promise.all([
    requireYandexOAuthToken("core", "Яндекс Почта"),
    getYandexIdentityProfile(),
  ]);
  const email = profile.defaultEmail || profile.emails?.[0] || (profile.login ? `${profile.login}@yandex.ru` : "");
  if (!email) throw new Error("Не удалось определить email Яндекс Почты.");
  return { token, email };
}

async function yandexMailStatus() {
  const { email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, await requireYandexOAuthToken("core", "Яндекс Почта"));
    const inbox = await imapCommand(session, "SELECT INBOX");
    return { email, status: "ok", inbox: parseImapSelect(inbox) };
  } finally {
    await imapClose(session);
  }
}

async function yandexMailFolders() {
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    const text = await imapCommand(session, 'LIST "" "*"');
    return parseImapListMailboxes(text);
  } finally {
    await imapClose(session);
  }
}

async function resolveYandexMailbox(value = "INBOX") {
  const requested = String(value || "INBOX").trim();
  if (!requested || /^inbox$/iu.test(requested)) return "INBOX";
  if (!isYandexMailboxAlias(requested)) return requested;
  const folders = await yandexMailFolders();
  const target = normalizeYandexMailboxAlias(requested);
  const found = findYandexMailbox(folders, target);
  if (found?.name) return found.name;
  throw new Error(`Папка Яндекс Почты не найдена: ${requested}. Проверьте список папок командой: покажи папки почты.`);
}

function isYandexMailboxAlias(value) {
  return /^(sent|send|sentmail|отправ|исход|draft|drafts|чернов|spam|junk|спам|trash|bin|корзин|удален|удалён)$/iu.test(String(value || "").trim());
}

function normalizeYandexMailboxAlias(value) {
  const text = String(value || "").toLocaleLowerCase("ru-RU");
  if (/(sent|send|sentmail|отправ|исход)/iu.test(text)) return "sent";
  if (/(draft|drafts|чернов)/iu.test(text)) return "drafts";
  if (/(spam|junk|спам)/iu.test(text)) return "spam";
  if (/(trash|bin|корзин|удален|удалён)/iu.test(text)) return "trash";
  return "inbox";
}

function findYandexMailbox(folders, target) {
  const special = {
    sent: "\\Sent",
    drafts: "\\Drafts",
    spam: "\\Junk",
    trash: "\\Trash",
  }[target];
  if (special) {
    const bySpecial = folders.find((folder) => folder.flags.some((flag) => flag.toLocaleLowerCase("en-US") === special.toLocaleLowerCase("en-US")));
    if (bySpecial) return bySpecial;
  }
  const patterns = {
    sent: /(sent|отправ|исход)/iu,
    drafts: /(draft|чернов)/iu,
    spam: /(spam|junk|спам)/iu,
    trash: /(trash|bin|корзин|удален|удалён)/iu,
  }[target];
  return folders.find((folder) => patterns?.test(folder.name) || patterns?.test(folder.displayName || ""));
}

async function yandexMailList(options = {}) {
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    await imapCommand(session, `SELECT ${quoteImapMailbox(options.mailbox || "INBOX")}`);
    const criterion = options.unread ? "UNSEEN" : "ALL";
    const search = await imapCommand(session, `UID SEARCH ${criterion}`);
    const uids = parseImapSearchUids(search).slice(-Number(options.limit || 10));
    if (!uids.length) return [];
    const fetch = await imapCommand(session, `UID FETCH ${uids.join(",")} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)] BODY.PEEK[TEXT]<0.800>)`, { timeout: 45000 });
    return parseImapFetchSummaries(fetch).sort((left, right) => Number(right.uid || 0) - Number(left.uid || 0));
  } finally {
    await imapClose(session);
  }
}

async function yandexMailCount(options = {}) {
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    await imapCommand(session, `SELECT ${quoteImapMailbox(options.mailbox || "INBOX")}`);
    const criterion = options.unread ? "UNSEEN" : "ALL";
    const search = await imapCommand(session, `UID SEARCH ${criterion}`);
    return parseImapSearchUids(search).length;
  } finally {
    await imapClose(session);
  }
}

async function yandexMailSearch(query, options = {}) {
  const normalized = normalizeGeoText(query);
  if (!normalized) return yandexMailList(options);
  const tokens = normalized.split(/\s+/u).filter((token) => token.length > 2 && !/^(про|обо?|где|что|кто|как)$/iu.test(token));
  const rows = await yandexMailList({ ...options, limit: Math.max(50, Number(options.limit || 20) * 3) });
  return rows.filter((row) => {
    const haystack = normalizeGeoText(`${row.from} ${row.subject} ${row.snippet}`);
    if (haystack.includes(normalized)) return true;
    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  }).slice(0, Number(options.limit || 20));
}

async function yandexMailWatchTick(options = {}) {
  const config = await loadConfig();
  const watch = config.yandex?.mailWatch || {};
  if (!watch.enabled && !options.force) return { enabled: false, newMessages: [] };
  const mailbox = watch.mailbox || "INBOX";
  const lastUid = Number(watch.lastUid || 0);
  const rows = await yandexMailList({ mailbox, limit: Number(options.limit || 30), unread: false });
  const newMessages = rows.filter((row) => Number(row.uid || 0) > lastUid).sort((left, right) => Number(left.uid || 0) - Number(right.uid || 0));
  const newestUid = Math.max(lastUid, ...rows.map((row) => Number(row.uid || 0)));
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      mailWatch: {
        ...watch,
        enabled: watch.enabled !== false,
        mailbox,
        lastUid: newestUid,
        lastCheckedAt: new Date().toISOString(),
      },
    },
  });
  return { enabled: true, mailbox, lastUid, newestUid, newMessages };
}

async function yandexMailWatchEnable(minutes = 5) {
  const config = await loadConfig();
  const safeMinutes = Math.max(1, Number(minutes || 5));
  const latest = await yandexMailList({ mailbox: "INBOX", limit: 1, unread: false });
  const lastUid = latest[0]?.uid || 0;
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      mailWatch: { enabled: true, minutes: safeMinutes, mailbox: "INBOX", lastUid, updatedAt: new Date().toISOString() },
    },
  });
  await upsertCronJob(`каждые ${safeMinutes} минут`, "yandex mail-watch tick", { replaceCommand: true });
  return { enabled: true, minutes: safeMinutes, mailbox: "INBOX", lastUid };
}

async function yandexMailWatchDisable() {
  const config = await loadConfig();
  await saveConfig({ yandex: { ...(config.yandex || {}), mailWatch: { ...(config.yandex?.mailWatch || {}), enabled: false, updatedAt: new Date().toISOString() } } });
  deleteCronJobsByCommand("yandex mail-watch tick");
  return { enabled: false };
}

async function yandexDailyDigestEnable(options = {}) {
  const config = await loadConfig();
  const time = normalizeDigestTime(options.time || "09:00");
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      dailyDigest: { ...(config.yandex?.dailyDigest || {}), enabled: true, time, email: Boolean(options.email), save: options.save !== false, updatedAt: new Date().toISOString() },
    },
  });
  await upsertCronJob(`каждый день ${time}`, "yandex daily-digest tick", { replaceCommand: true });
  return { enabled: true, time, email: Boolean(options.email), save: options.save !== false };
}

async function yandexDailyDigestDisable() {
  const config = await loadConfig();
  const current = config.yandex?.dailyDigest || {};
  await saveConfig({ yandex: { ...(config.yandex || {}), dailyDigest: { ...current, enabled: false, lastRemote: "", updatedAt: new Date().toISOString() } } });
  deleteCronJobsByCommand("yandex daily-digest tick");
  return { enabled: false };
}

async function yandexDailyDigestTick(options = {}) {
  const config = await loadConfig();
  const digest = config.yandex?.dailyDigest || {};
  if (!digest.enabled && !options.force) return { enabled: false, text: "" };
  const unread = await yandexMailList({ mailbox: "INBOX", limit: 10, unread: true }).catch(() => []);
  const events = await yandexCalendarList({ start: new Date().toISOString(), end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), limit: 20 }).catch(() => []);
  const incomplete = await yandexContactsFindIncomplete({ limit: 10 }).catch(() => []);
  const text = [
    `# Дайджест IOLA за ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date())}`,
    "",
    `Непрочитанных писем: ${unread.length}`,
    ...unread.slice(0, 5).map((row, index) => `${index + 1}. ${formatYandexMailSummary(row)}`),
    "",
    `Событий на 24 часа: ${events.length}`,
    ...events.slice(0, 10).map((row, index) => `${index + 1}. ${row.title || "(без названия)"} — ${row.startIso || row.start || "-"}`),
    "",
    `Неполных контактов: ${incomplete.length}`,
    ...incomplete.slice(0, 5).map((row, index) => `${index + 1}. ${formatYandexContact(row)}`),
  ].join("\n").trim();
  let remote = "";
  if (options.save !== false && digest.save !== false) {
    const saved = await yandexDocsCreateText({ title: `daily-digest-${timestampForFile()}`, text, format: "md", confirm: true });
    remote = saved.remote || "";
  }
  if (options.email || digest.email) {
    const profile = await getYandexIdentityProfile();
    const to = profile.defaultEmail || profile.emails?.[0];
    if (to) await yandexMailSend({ to: [to], subject: "Ежедневный дайджест IOLA", text, confirm: true });
  }
  await saveConfig({ yandex: { ...(config.yandex || {}), dailyDigest: { ...digest, enabled: digest.enabled !== false, lastRunAt: new Date().toISOString(), lastRemote: remote || digest.lastRemote || "" } } });
  return { enabled: true, text, remote, unread: unread.length, events: events.length, incomplete: incomplete.length };
}

async function yandexCalendarRemindersEnable(minutes = 15) {
  const config = await loadConfig();
  const safeMinutes = Math.max(1, Number(minutes || 15));
  await saveConfig({ yandex: { ...(config.yandex || {}), calendarReminders: { ...(config.yandex?.calendarReminders || {}), enabled: true, minutes: safeMinutes, horizonMinutes: 60, updatedAt: new Date().toISOString() } } });
  await upsertCronJob(`каждые ${safeMinutes} минут`, "yandex calendar-reminders tick", { replaceCommand: true });
  return { enabled: true, minutes: safeMinutes };
}

async function yandexCalendarRemindersDisable() {
  const config = await loadConfig();
  const current = config.yandex?.calendarReminders || {};
  await saveConfig({ yandex: { ...(config.yandex || {}), calendarReminders: { ...current, enabled: false, seen: [], updatedAt: new Date().toISOString() } } });
  deleteCronJobsByCommand("yandex calendar-reminders tick");
  return { enabled: false };
}

async function yandexCalendarRemindersTick(options = {}) {
  const config = await loadConfig();
  const reminders = config.yandex?.calendarReminders || {};
  if (!reminders.enabled && !options.force) return { enabled: false, events: [] };
  const horizon = Math.max(5, Number(options.horizonMinutes || reminders.horizonMinutes || 60));
  const now = new Date();
  const rows = await yandexCalendarList({ start: now.toISOString(), end: new Date(now.getTime() + horizon * 60 * 1000).toISOString(), limit: 30 });
  const seen = new Set(reminders.seen || []);
  const fresh = rows.filter((row) => {
    const key = `${row.uid}:${row.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await saveConfig({ yandex: { ...(config.yandex || {}), calendarReminders: { ...reminders, enabled: reminders.enabled !== false, lastRunAt: new Date().toISOString(), lastCount: fresh.length, seen: [...seen].slice(-500) } } });
  return { enabled: true, events: fresh };
}

async function yandexDiskMaintenanceEnable(days = 7) {
  const config = await loadConfig();
  const safeDays = Math.max(1, Number(days || 7));
  await saveConfig({ yandex: { ...(config.yandex || {}), diskMaintenance: { ...(config.yandex?.diskMaintenance || {}), enabled: true, days: safeDays, updatedAt: new Date().toISOString() } } });
  await upsertCronJob(`каждые ${safeDays} дней`, "yandex disk-maintenance tick", { replaceCommand: true });
  return { enabled: true, days: safeDays };
}

async function yandexDiskMaintenanceDisable() {
  const config = await loadConfig();
  const current = config.yandex?.diskMaintenance || {};
  await saveConfig({ yandex: { ...(config.yandex || {}), diskMaintenance: { ...current, enabled: false, lastRemote: "", updatedAt: new Date().toISOString() } } });
  deleteCronJobsByCommand("yandex disk-maintenance tick");
  return { enabled: false };
}

async function yandexDiskMaintenanceTick(options = {}) {
  const config = await loadConfig();
  const disk = config.yandex?.diskMaintenance || {};
  if (!disk.enabled && !options.force) return { enabled: false };
  const info = await yandexDiskInfo();
  const docs = await yandexDocsList({ limit: 500 }).catch(() => []);
  const all = await yandexDiskListRecursive(CLOUD_DEFAULT_REMOTE_DIR, { depth: 4, limit: 500 }).catch(() => []);
  const publicLinks = [];
  for (const row of all.slice(0, 100)) {
    const statRow = await yandexDiskStat(row.path).catch(() => null);
    if (statRow?.publicUrl) publicLinks.push(statRow);
  }
  const text = [
    `# Проверка Яндекс Диска ${new Date().toISOString()}`,
    "",
    `Занято: ${formatBytes(info.usedSpace)} из ${formatBytes(info.totalSpace)}`,
    `Корзина: ${formatBytes(info.trashSize)}`,
    `Документов: ${docs.length}`,
    `Публичных ссылок в /IOLA: ${publicLinks.length}`,
    ...publicLinks.slice(0, 20).map((row, index) => `${index + 1}. ${row.path} — ${row.publicUrl}`),
  ].join("\n");
  const saved = await yandexDocsCreateText({ title: `disk-maintenance-${timestampForFile()}`, text, format: "md", confirm: true });
  await saveConfig({ yandex: { ...(config.yandex || {}), diskMaintenance: { ...disk, enabled: disk.enabled !== false, lastRunAt: new Date().toISOString(), lastRemote: saved.remote || "", lastDocs: docs.length, lastPublicLinks: publicLinks.length } } });
  return { enabled: true, ...info, docs: docs.length, publicLinks: publicLinks.length, remote: saved.remote || "" };
}

function normalizeDigestTime(value) {
  const match = String(value || "").match(/^(\d{1,2})(?::(\d{2}))?$/u);
  if (!match) return "09:00";
  return `${String(Math.min(23, Number(match[1]))).padStart(2, "0")}:${String(Math.min(59, Number(match[2] || 0))).padStart(2, "0")}`;
}

async function yandexContactsMaintenanceEnable(days = 7, options = {}) {
  const config = await loadConfig();
  const safeDays = Math.max(1, Number(days || 7));
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      contactsMaintenance: {
        ...(config.yandex?.contactsMaintenance || {}),
        enabled: true,
        days: safeDays,
        backup: Boolean(options.backup),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  await upsertCronJob(`каждые ${safeDays} дней`, "yandex contacts-maintenance tick", { replaceCommand: true });
  return { enabled: true, days: safeDays, backup: Boolean(options.backup) };
}

async function yandexContactsMaintenanceDisable() {
  const config = await loadConfig();
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      contactsMaintenance: {
        ...(config.yandex?.contactsMaintenance || {}),
        enabled: false,
        updatedAt: new Date().toISOString(),
      },
    },
  });
  deleteCronJobsByCommand("yandex contacts-maintenance tick");
  return { enabled: false };
}

async function yandexContactsMaintenanceTick(options = {}) {
  const config = await loadConfig();
  const maintenance = config.yandex?.contactsMaintenance || {};
  if (!maintenance.enabled && !options.force) return { enabled: false };
  const contacts = await yandexContactsList({ limit: Number(options.limit || 1000) });
  const incomplete = await yandexContactsFindIncomplete({ limit: Number(options.limit || 1000) });
  const duplicates = await yandexContactsFindDuplicates({ limit: Number(options.limit || 1000) });
  let backupRemote = "";
  if (options.backup || maintenance.backup) {
    const backup = await yandexContactsBackupToDisk({ format: "csv", confirm: true, limit: Number(options.limit || 1000) });
    backupRemote = backup.remote || "";
  }
  await saveConfig({
    yandex: {
      ...(config.yandex || {}),
      contactsMaintenance: {
        ...maintenance,
        enabled: maintenance.enabled !== false,
        lastRunAt: new Date().toISOString(),
        lastTotal: contacts.length,
        lastIncomplete: incomplete.length,
        lastDuplicateGroups: duplicates.length,
        lastBackupRemote: backupRemote || maintenance.lastBackupRemote || "",
      },
    },
  });
  return {
    enabled: true,
    total: contacts.length,
    incomplete: incomplete.length,
    duplicateGroups: duplicates.length,
    backupRemote,
    incompletePreview: incomplete.slice(0, 10),
    duplicatePreview: duplicates.slice(0, 10),
  };
}

async function yandexMailRead(uid, options = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    await imapCommand(session, `SELECT ${quoteImapMailbox(options.mailbox || "INBOX")}`);
    const bodyAccessor = options.markSeen === false ? "BODY.PEEK[]" : "BODY[]";
    const fetch = await imapCommand(session, `UID FETCH ${Number(uid)} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT MESSAGE-ID REFERENCES)] ${bodyAccessor})`, { timeout: 60000 });
    return parseImapFetchSummaries(fetch, { full: true })[0] || { uid, status: "not-found" };
  } finally {
    await imapClose(session);
  }
}

async function yandexMailMark(uid, seen = true, options = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    const mailbox = options.mailbox || "INBOX";
    await imapCommand(session, `SELECT ${quoteImapMailbox(mailbox)}`);
    const command = seen ? "+FLAGS.SILENT" : "-FLAGS.SILENT";
    await imapCommand(session, `UID STORE ${Number(uid)} ${command} (\\Seen)`);
    return { uid: Number(uid), mailbox, status: seen ? "seen" : "unseen" };
  } finally {
    await imapClose(session);
  }
}

async function yandexMailDelete(uid, options = {}) {
  if (!options.confirm) throw new Error("Для удаления письма нужен аргумент confirm=true.");
  if (!uid) throw new Error("UID письма обязателен.");
  const folders = await yandexMailFolders();
  const trash = options.trashMailbox || findYandexMailbox(folders, "trash")?.name;
  if (!trash) throw new Error("Не нашел папку корзины в Яндекс Почте. Безопасное удаление невозможно.");
  const { token, email } = await yandexMailCredentials();
  const session = await imapConnect();
  try {
    await imapAuthenticate(session, email, token);
    const mailbox = options.mailbox || "INBOX";
    await imapCommand(session, `SELECT ${quoteImapMailbox(mailbox)}`);
    await imapCommand(session, `UID MOVE ${Number(uid)} ${quoteImapMailbox(trash)}`, { timeout: 60000 });
    return { uid: Number(uid), from: mailbox, to: trash, status: "moved-to-trash" };
  } finally {
    await imapClose(session);
  }
}

async function yandexMailReply(args = {}) {
  if (!args.confirm) throw new Error("Для ответа на письмо нужен аргумент confirm=true.");
  const uid = args.uid || args.id;
  const text = args.text || args.body || args.message || "";
  if (!uid) throw new Error("UID письма обязателен.");
  if (!String(text).trim()) throw new Error("Текст ответа пустой.");
  const mailbox = await resolveYandexMailbox(args.mailbox || args.folder || "INBOX");
  const original = await yandexMailRead(uid, { mailbox, markSeen: true, includeMessageId: true });
  if (!original || original.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const to = [extractEmailAddress(original.from)].filter(Boolean);
  if (!to.length) throw new Error("Не удалось определить получателя ответа из поля From.");
  const subject = /^re:/iu.test(original.subject || "") ? original.subject : `Re: ${original.subject || "(без темы)"}`;
  const result = await yandexMailSend({
    to,
    subject,
    text,
    confirm: true,
    inReplyTo: original.messageId || "",
    references: original.references || original.messageId || "",
  });
  return { ...result, replyToUid: Number(uid), originalFrom: original.from };
}

async function yandexMailForward(args = {}) {
  if (!args.confirm) throw new Error("Для пересылки письма нужен аргумент confirm=true.");
  const uid = args.uid || args.id;
  const to = Array.isArray(args.to) ? args.to : String(args.to || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  if (!uid) throw new Error("UID письма обязателен.");
  if (!to.length) throw new Error("Получатель пересылки не указан.");
  const original = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: true });
  if (!original || original.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const text = [
    args.text || args.comment || "",
    "",
    "---------- Пересланное письмо ----------",
    `От: ${original.from || "-"}`,
    `Дата: ${original.date || "-"}`,
    `Тема: ${original.subject || "(без темы)"}`,
    "",
    original.snippet || "",
  ].join("\n").trim();
  return yandexMailSend({ to, subject: `Fwd: ${original.subject || "(без темы)"}`, text, confirm: true });
}

async function yandexMailSaveToDisk(uid, args = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: args.markSeen !== false });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const safeSubject = slugForFile(row.subject || `mail-${uid}`).slice(0, 80);
  const remotePath = args.path || args.remotePath || `${CLOUD_DEFAULT_REMOTE_DIR}/Почта/mail-${uid}-${safeSubject}.md`;
  const text = [
    `# ${row.subject || "(без темы)"}`,
    "",
    `- UID: ${row.uid}`,
    `- От: ${row.from || "-"}`,
    `- Дата: ${row.date || "-"}`,
    "",
    row.snippet || "",
  ].join("\n");
  const saved = await yandexDiskSaveText(text, remotePath);
  return { ...saved, uid: row.uid, subject: row.subject };
}

async function yandexMailCreateCalendarEvent(uid, args = {}) {
  if (!args.confirm) throw new Error("Для создания события из письма нужен аргумент confirm=true.");
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: true });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const detected = extractDateTimeFromText(`${row.subject}\n${row.snippet}`);
  const start = args.start || detected.start || new Date(Date.now() + 3600000).toISOString();
  const end = args.end || detected.end || new Date(new Date(start).getTime() + 3600000).toISOString();
  return yandexCalendarCreateEvent({
    title: args.title || row.subject || `Письмо #${uid}`,
    description: [`Создано из письма #${uid}.`, `От: ${row.from || "-"}`, "", row.snippet || ""].join("\n"),
    location: args.location || detected.location || "",
    start,
    end,
    confirm: true,
  });
}

async function yandexMailMeetingPack(uid, args = {}) {
  if (!args.confirm) throw new Error("Для пакетного сценария по письму нужен аргумент confirm=true.");
  if (!uid) throw new Error("UID письма обязателен.");
  const mailbox = await resolveYandexMailbox(args.mailbox || args.folder || "INBOX");
  const row = await yandexMailRead(uid, { mailbox, markSeen: true });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const senderEmail = extractEmailAddress(row.from);
  const saved = await yandexMailSaveToDisk(uid, { mailbox });
  const shared = await yandexDiskShareWithQr(saved.remote, { confirm: true });
  const detected = extractDateTimeFromText(`${args.text || ""}\n${row.subject}\n${row.snippet}`);
  const start = args.start || detected.start || new Date(Date.now() + 3600000).toISOString();
  const end = args.end || detected.end || new Date(new Date(start).getTime() + 3600000).toISOString();
  const event = await yandexCalendarCreateEvent({
    title: args.title || `Встреча по письму: ${row.subject || `#${uid}`}`,
    description: [
      `Создано из письма #${uid}.`,
      `От: ${row.from || "-"}`,
      `Письмо сохранено: ${saved.remote}`,
      `Ссылка: ${shared.publicUrl}`,
      `QR-код: ${shared.qrPublicUrl}`,
      "",
      row.snippet || "",
    ].join("\n"),
    location: args.location || detected.location || "",
    start,
    end,
    attendees: senderEmail ? [senderEmail] : [],
    confirm: true,
  });
  let sent = null;
  if ((args.send || args.email) && senderEmail) {
    sent = await yandexMailSend({
      to: [senderEmail],
      subject: args.subject || `Материалы к встрече: ${row.subject || `письмо #${uid}`}`,
      text: [`Создал встречу и сохранил письмо на Яндекс Диск.`, `Ссылка: ${shared.publicUrl}`, `QR-код: ${shared.qrPublicUrl}`].join("\n"),
      confirm: true,
    });
  }
  return { status: "mail-meeting-pack-created", uid: Number(uid), from: row.from, saved: saved.remote, publicUrl: shared.publicUrl, qrPublicUrl: shared.qrPublicUrl, event: event.uid, sentTo: sent?.to || [] };
}

async function yandexMailSenderToContact(uid, args = {}) {
  if (!args.confirm) throw new Error("Для добавления отправителя в контакты нужен аргумент confirm=true.");
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: false });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const email = extractEmailAddress(row.from);
  const name = extractDisplayName(row.from) || email;
  if (!email) throw new Error("В отправителе письма не найден email.");
  return yandexContactsCreate({ name, email, confirm: true });
}

async function yandexMailCityContext(uid, args = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: false });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const text = `${row.subject}\n${row.snippet}`;
  const queries = extractEducationQueriesFromText(text);
  const results = [];
  for (const query of queries) {
    results.push(...searchLocalRecords(query, { dataset: "all", limit: 5, fts: true }));
  }
  const unique = dedupeBy(results, (item) => `${item.dataset || ""}:${item.inn || item.name}`);
  return unique.slice(0, Number(args.limit || 10)).map((item) => ({
    name: item.name,
    inn: item.inn,
    address: item.address,
    phone: item.phone,
    email: item.email,
    website: item.website,
    dataset: item.dataset,
  }));
}

async function yandexMailMapAddresses(uid, args = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: false });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const addresses = extractLikelyAddresses(`${row.subject}\n${row.snippet}`).slice(0, Number(args.limit || 5));
  const rows = [];
  for (const address of addresses) {
    const point = await geocodeCached(address).catch(() => null);
    rows.push({
      address,
      resolved: point?.address || "",
      map: point?.lat && point?.lon ? `https://yandex.ru/maps/?pt=${point.lon},${point.lat}&z=16&l=map` : "",
    });
  }
  return rows;
}

async function yandexMailCreateTask(uid, args = {}) {
  if (!uid) throw new Error("UID письма обязателен.");
  const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(args.mailbox || args.folder || "INBOX"), markSeen: false });
  if (!row || row.status === "not-found") throw new Error(`Письмо #${uid} не найдено.`);
  const title = args.title || `Ответить/разобрать письмо #${uid}: ${row.subject || "(без темы)"}`;
  const id = addTask(title, `ask "прочитай письмо #${uid}"`);
  return { id, title, uid: Number(uid), status: "open" };
}

async function yandexMailSend(args = {}) {
  if (!args.confirm) throw new Error("Для отправки письма нужен аргумент confirm=true.");
  const to = Array.isArray(args.to) ? args.to : String(args.to || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  if (!to.length) throw new Error("Получатель письма не указан.");
  const subject = args.subject || "Сообщение от IOLA CLI";
  const text = args.text || args.body || "";
  if (!text.trim()) throw new Error("Текст письма пустой.");
  const { token, email } = await yandexMailCredentials();
  const session = await smtpConnect();
  try {
    await smtpCommand(session, `EHLO ${os.hostname() || "iola.local"}`);
    await smtpCommand(session, `AUTH XOAUTH2 ${buildXoauth2(email, token)}`);
    await smtpCommand(session, `MAIL FROM:<${email}>`);
    for (const recipient of to) await smtpCommand(session, `RCPT TO:<${recipient}>`);
    await smtpCommand(session, "DATA", { expect: /^354/u });
    await smtpCommand(session, `${dotStuffSmtpData(buildMimeMessage({ from: email, to, subject, text, inReplyTo: args.inReplyTo, references: args.references }))}\r\n.`);
    await smtpCommand(session, "QUIT").catch(() => {});
    return { from: email, to, subject, status: "sent" };
  } finally {
    session.socket.destroy();
  }
}

function buildXoauth2(email, token) {
  return Buffer.from(`user=${email}\x01auth=Bearer ${token}\x01\x01`).toString("base64");
}

function buildMimeMessage({ from, to, subject, text, inReplyTo = "", references = "" }) {
  const encodedSubject = Buffer.from(subject, "utf8").toString("base64");
  const messageIdDomain = String(from || "").split("@")[1] || "localhost";
  const messageId = `${randomUUID()}@${messageIdDomain}`;
  return [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Reply-To: ${from}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
    references ? `References: ${references}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "X-Mailer: IOLA CLI",
    "",
    Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim(),
  ].filter((line) => line !== "").join("\r\n");
}

function dotStuffSmtpData(message) {
  return String(message || "").replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

function imapConnect() {
  return tlsLineSession("imap.yandex.ru", 993, "* OK");
}

function smtpConnect() {
  return tlsLineSession("smtp.yandex.ru", 465, /^220/u);
}

function tlsLineSession(host, port, greetingPattern) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 30000 }, () => {});
    const session = { socket, buffer: "", lines: [], tag: 0 };
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${host}:${port} connection timeout`));
    }, 30000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      session.buffer += chunk;
      const parts = session.buffer.split(/\r?\n/);
      session.buffer = parts.pop() || "";
      session.lines.push(...parts.filter(Boolean));
      const text = session.lines.join("\n");
      const ok = typeof greetingPattern === "string" ? text.includes(greetingPattern) : greetingPattern.test(text);
      if (ok) {
        clearTimeout(timer);
        resolve(session);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function imapAuthenticate(session, email, token) {
  await imapCommand(session, `AUTHENTICATE XOAUTH2 ${buildXoauth2(email, token)}`, { sensitive: token });
}

function imapCommand(session, command, options = {}) {
  const tag = `A${++session.tag}`;
  session.lines = [];
  return sendTaggedCommand(session, `${tag} ${command}`, new RegExp(`^${tag} (OK|NO|BAD)`, "imu"), {
    timeout: options.timeout || 30000,
    sensitive: options.sensitive,
    ok: new RegExp(`^${tag} OK`, "imu"),
  });
}

function smtpCommand(session, command, options = {}) {
  session.lines = [];
  return sendTaggedCommand(session, command, options.expect || /^[235]|\n[235]/u, {
    timeout: options.timeout || 30000,
    ok: options.expect || /^[235]|\n[235]/u,
  });
}

function sendTaggedCommand(session, command, donePattern, options = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Yandex mail command timeout")), options.timeout || 30000);
    const onData = () => {
      const text = session.lines.join("\n");
      if (!donePattern.test(text)) return;
      clearTimeout(timer);
      session.socket.off("data", onData);
      if (options.ok && !options.ok.test(text)) {
        reject(new Error(sanitizeSecretFromText(`Yandex mail command failed: ${text}`, options.sensitive)));
      } else {
        resolve(text);
      }
    };
    session.socket.on("data", onData);
    session.socket.write(`${command}\r\n`);
  });
}

async function imapClose(session) {
  await imapCommand(session, "LOGOUT").catch(() => {});
  session.socket.destroy();
}

function quoteImapMailbox(value) {
  return `"${encodeImapModifiedUtf7(String(value || "INBOX")).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function parseImapSelect(text) {
  return {
    exists: Number(text.match(/\* (\d+) EXISTS/iu)?.[1] || 0),
    recent: Number(text.match(/\* (\d+) RECENT/iu)?.[1] || 0),
    unseen: Number(text.match(/UNSEEN (\d+)/iu)?.[1] || 0),
  };
}

function parseImapSearchUids(text) {
  return [...String(text).matchAll(/\* SEARCH ([\d\s]+)/giu)]
    .flatMap((match) => match[1].trim().split(/\s+/).map(Number).filter(Boolean));
}

function parseImapListMailboxes(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => {
      const match = line.match(/^\* LIST \(([^)]*)\) (?:"([^"]*)"|NIL) (?:"((?:\\"|[^"])*)"|(.+))$/iu);
      if (!match) return null;
      const flags = [...match[1].matchAll(/\\[^\s)]+/gu)].map((item) => item[0]);
      const delimiter = match[2] || "";
      const rawName = (match[3] || match[4] || "").trim();
      const name = decodeImapModifiedUtf7(rawName.replace(/\\"/g, "\""));
      return {
        name,
        displayName: name,
        delimiter,
        flags,
        special: flags.find((flag) => /\\(?:Inbox|Sent|Drafts|Junk|Trash)/iu.test(flag)) || "",
      };
    })
    .filter(Boolean);
}

function decodeImapModifiedUtf7(value) {
  return String(value || "").replace(/&([^-]*)-/gu, (_, data) => {
    if (!data) return "&";
    const base64 = data.replace(/,/g, "/");
    try {
      const buffer = Buffer.from(base64, "base64");
      let decoded = "";
      for (let index = 0; index + 1 < buffer.length; index += 2) {
        decoded += String.fromCharCode(buffer.readUInt16BE(index));
      }
      return decoded;
    } catch {
      return `&${data}-`;
    }
  });
}

function encodeImapModifiedUtf7(value) {
  return String(value || "").replace(/&/gu, "&-").replace(/[^\x20-\x7e]+/gu, (chunk) => {
    const bytes = [];
    for (const char of chunk) {
      const code = char.charCodeAt(0);
      bytes.push((code >> 8) & 0xff, code & 0xff);
    }
    return `&${Buffer.from(bytes).toString("base64").replace(/\//g, ",").replace(/=+$/u, "")}-`;
  });
}

function parseImapFetchSummaries(text, options = {}) {
  const rows = [];
  const chunks = String(text || "").split(/\n(?=\* \d+ FETCH)/u);
  for (const chunk of chunks) {
    const uid = Number(chunk.match(/UID (\d+)/iu)?.[1] || 0);
    if (!uid) continue;
    const headers = parseMailHeaders(chunk);
    const subject = headers.subject || "";
    const from = headers.from || "";
    const date = headers.date || "";
    const body = options.full ? stripMailBody(chunk) : stripMailBody(chunk).slice(0, 800);
    rows.push({
      uid,
      date,
      from,
      subject,
      messageId: headers.messageId || "",
      references: headers.references || "",
      snippet: body.replace(/\s+/g, " ").trim().slice(0, options.full ? 12000 : 500),
    });
  }
  return rows;
}

function parseMailHeaders(value) {
  const normalized = String(value || "").replace(/\r/g, "").replace(/\n BODY\[[\s\S]*$/u, "");
  const headerValue = (name) => {
    const match = normalized.match(new RegExp(`^${name}:\\s*([^\\n]*(?:\\n[\\t ][^\\n]*)*)`, "imu"));
    return match ? decodeMimeHeader(match[1].replace(/\n[\t ]+/g, " ").trim()) : "";
  };
  return {
    date: headerValue("Date"),
    from: headerValue("From"),
    subject: headerValue("Subject"),
    messageId: headerValue("Message-ID"),
    references: headerValue("References"),
  };
}

function extractEmailAddress(value) {
  const text = String(value || "").trim();
  return text.match(/<([^<>@\s]+@[^<>@\s]+)>/u)?.[1]
    || text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0]
    || "";
}

function decodeMimeHeader(value) {
  return String(value || "")
    .replace(/\?=\s+=\?/gu, "?==?")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/giu, (_, data) => Buffer.from(data, "base64").toString("utf8"))
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/giu, (_, data) => Buffer.from(data.replace(/_/g, " ").replace(/=([A-F0-9]{2})/giu, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "binary").toString("utf8"));
}

function stripMailBody(value) {
  const raw = String(value || "").replace(/\r/g, "");
  const withoutFetch = raw
    .replace(/^\* \d+ FETCH[^\n]*\n?/u, "")
    .replace(/^BODY(?:\.PEEK)?\[[^\n]*\]\s*\{\d+\}\n?/imu, "")
    .replace(/\n\)\s*$/u, "");
  const bodyMatch = withoutFetch.match(/BODY(?:\.PEEK)?\[[^\n]*\]\s*\{\d+\}\s*([\s\S]*)/iu);
  if (bodyMatch?.[1]) return extractMimeText(bodyMatch[1]);
  const headerEnd = withoutFetch.indexOf("\n\n");
  if (headerEnd < 0) return withoutFetch.replace(/[^\S\n]+/g, " ").trim();
  const headers = withoutFetch.slice(0, headerEnd);
  const body = withoutFetch.slice(headerEnd + 2).replace(/^BODY(?:\.PEEK)?\[[^\n]*\]\s*\{\d+\}\n?/imu, "");
  return extractMimeText(`${headers}\n\n${body}`);
}

function extractMimeText(source, depth = 0) {
  if (depth > 5) return decodeMailPart(source);
  const boundary = String(source || "").match(/boundary="?([^"\n;]+)"?/iu)?.[1];
  if (!boundary || !source.includes(`--${boundary}`)) return decodeMailPart(source);
  const parts = source.slice(source.indexOf(`--${boundary}`)).split(`--${boundary}`).filter((part) => part.trim() && part.trim() !== "--");
  const plain = parts.find((part) => /^Content-Type:\s*text\/plain/im.test(part));
  if (plain) return decodeMailPart(plain);
  for (const part of parts) {
    if (/^Content-Type:\s*multipart\//im.test(part) || /boundary="?([^"\n;]+)"?/iu.test(part)) {
      const nested = extractMimeText(part, depth + 1);
      if (nested) return nested;
    }
  }
  const html = parts.find((part) => /^Content-Type:\s*text\/html/im.test(part));
  if (html) return decodeMailPart(html);
  return decodeMailPart(parts[0] || source);
}

function decodeMailPart(part) {
  const text = String(part || "").replace(/\r/g, "");
  let headerEnd = text.indexOf("\n\n");
  let headers = headerEnd >= 0 ? text.slice(0, headerEnd) : "";
  let body = headerEnd >= 0 ? text.slice(headerEnd + 2) : text;
  if (headerEnd < 0) {
    const transferMatch = text.match(/^(.*Content-Transfer-Encoding:\s*(?:base64|quoted-printable)[^\n]*\n)([\s\S]*)$/imu);
    if (transferMatch) {
      headers = transferMatch[1];
      body = transferMatch[2];
    }
  }
  const encoding = headers.match(/^Content-Transfer-Encoding:\s*([^\n]+)/imu)?.[1]?.trim().toLocaleLowerCase("en-US") || "";
  let decoded = body;
  if (encoding === "base64") {
    const clean = body.replace(/\s+/g, "");
    decoded = /^[A-Z0-9+/]+={0,2}$/iu.test(clean) && clean.length >= 8
      ? Buffer.from(clean, "base64").toString("utf8")
      : body;
  } else if (encoding === "quoted-printable") {
    decoded = decodeQuotedPrintable(body);
  } else {
    const clean = body.replace(/\s+/g, "");
    if (/^[A-Z0-9+/]+={0,2}$/iu.test(clean) && clean.length >= 80) {
      const candidate = Buffer.from(clean, "base64").toString("utf8");
      if (/(<!doctype|<html|<body|[А-Яа-яЁё]{3,})/u.test(candidate)) decoded = candidate;
    }
  }
  decoded = decodeEmbeddedBase64MailBody(decoded);
  const cleaned = decoded
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]+/gu, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const firstCyrillic = cleaned.search(/[А-Яа-яЁё]{3,}/u);
  if (firstCyrillic > 0 && firstCyrillic < 120 && cleaned.slice(0, firstCyrillic).includes("�")) {
    return cleaned.slice(firstCyrillic).trim();
  }
  return cleaned;
}

function decodeQuotedPrintable(value) {
  return Buffer.from(String(value || "").replace(/=\n/gu, "").replace(/=([A-F0-9]{2})/giu, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "binary").toString("utf8");
}

function decodeEmbeddedBase64MailBody(value) {
  const text = String(value || "");
  if (/(<!doctype|<html|<body|[А-Яа-яЁё]{3,})/u.test(text) && !/[A-Z0-9+/]{120,}/u.test(text)) return text;
  const matches = text.match(/[A-Z0-9+/=\s]{160,}/giu) || [];
  for (const match of matches) {
    const clean = match.replace(/\s+/g, "");
    if (!/^[A-Z0-9+/]+={0,2}$/iu.test(clean) || clean.length < 160) continue;
    const candidate = Buffer.from(clean, "base64").toString("utf8");
    if (/(<!doctype|<html|<body|[А-Яа-яЁё]{3,})/u.test(candidate)) return candidate;
  }
  return text;
}

async function yandexDavRequest(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `OAuth ${token}`,
      ...(options.xml ? { "content-type": "application/xml; charset=utf-8" } : {}),
      ...(options.ics ? { "content-type": "text/calendar; charset=utf-8" } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(Number(options.timeout || 30000)),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok && response.status !== 207) {
    throw new Error(`Yandex DAV request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text.slice(0, 1000), token)}`);
  }
  return text;
}

async function yandexCalendarStatus() {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
  const calendars = await yandexCalendarCollections(token);
  const selected = pickYandexCalendar(calendars, {});
  const url = selected.url;
  const text = await yandexDavRequest(url, token, { method: "PROPFIND", headers: { Depth: "0" }, xml: true, body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/></d:prop></d:propfind>" });
  return { status: "ok", url, displayName: stripXmlTags(text.match(/<[^:>]*:?displayname[^>]*>([\s\S]*?)<\/[^:>]*:?displayname>/iu)?.[1] || "") || selected.name || "calendar", calendars: calendars.length };
}

async function yandexCalendarCalendars(args = {}) {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
  const calendars = await yandexCalendarCollections(token);
  return calendars.slice(0, Number(args.limit || 50));
}

async function yandexCalendarCreateEvent(args = {}) {
  if (!args.confirm) throw new Error("Для создания события в календаре нужен аргумент confirm=true.");
  const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
  const baseUrl = await yandexCalendarBaseUrl(token, args);
  const uid = `${randomUUID()}@iola-cli`;
  const start = toIcsDate(args.start || args.date || new Date(Date.now() + 3600000).toISOString());
  const end = toIcsDate(args.end || new Date(Date.now() + 7200000).toISOString());
  const summary = args.title || args.summary || "Событие IOLA";
  const description = args.description || "";
  const ics = buildIcsEvent({
    uid,
    start,
    end,
    summary,
    description,
    location: args.location || "",
    attendees: args.attendees || args.to || [],
    rrule: args.rrule || buildIcsRrule(args),
    reminders: normalizeCalendarReminders(args.reminders || args.reminder || args.alarm),
  });
  const url = `${baseUrl}${encodeURIComponent(uid)}.ics`;
  await yandexDavRequest(url, token, { method: "PUT", ics: true, body: ics, timeout: 45000 });
  return { status: "calendar-event-created", uid, title: summary, start: args.start || args.date || "", end: args.end || "", url };
}

async function yandexCalendarCreateRecurringEvent(args = {}) {
  if (!args.confirm) throw new Error("Для создания повторяющегося события нужен аргумент confirm=true.");
  const rrule = args.rrule || buildIcsRrule({ ...args, repeat: args.repeat || args.frequency || "weekly" });
  return yandexCalendarCreateEvent({ ...args, rrule, confirm: true });
}

async function yandexCalendarList(args = {}) {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
  const baseUrl = await yandexCalendarBaseUrl(token, args);
  const start = toIcsDate(args.start || new Date().toISOString());
  const end = toIcsDate(args.end || new Date(Date.now() + 14 * 86400000).toISOString());
  const body = `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
  const text = await yandexDavRequest(baseUrl, token, { method: "REPORT", headers: { Depth: "1" }, xml: true, body, timeout: 45000 });
  return parseIcsEvents(text, { baseUrl }).slice(0, Number(args.limit || 20));
}

async function yandexCalendarSearch(query, args = {}) {
  const needle = normalizeGeoText(query || args.query || args.title || "");
  const rows = await yandexCalendarList({
    ...args,
    start: args.start || new Date(Date.now() - 90 * 86400000).toISOString(),
    end: args.end || new Date(Date.now() + 365 * 86400000).toISOString(),
    limit: Math.max(200, Number(args.limit || 20) * 10),
  });
  if (!needle) return rows.slice(0, Number(args.limit || 20));
  return rows.filter((row) => normalizeGeoText([
    row.title,
    row.description,
    row.location,
    row.uid,
  ].filter(Boolean).join(" ")).includes(needle)).slice(0, Number(args.limit || 20));
}

async function yandexCalendarGet(query, args = {}) {
  const resolved = await resolveYandexCalendarEvent(query, args);
  if (resolved.status !== "ok") return resolved;
  return stripCalendarPrivateFields(resolved.event);
}

async function yandexCalendarUpdate(query, args = {}) {
  if (!args.confirm) throw new Error("Для изменения события нужен аргумент confirm=true.");
  const resolved = await resolveYandexCalendarEvent(query, args);
  if (resolved.status !== "ok") return resolved;
  const event = resolved.event;
  const start = toIcsDate(args.start || args.date || event.startIso || event.start);
  const end = toIcsDate(args.end || event.endIso || event.end || new Date(new Date(args.start || event.startIso || Date.now()).getTime() + 3600000).toISOString());
  const next = buildIcsEvent({
    uid: event.uid || `${randomUUID()}@iola-cli`,
    start,
    end,
    summary: args.title || args.summary || event.title || "Событие IOLA",
    description: args.description ?? event.description ?? "",
    location: args.location ?? event.location ?? "",
    attendees: args.attendees || args.to || event.attendees || [],
    rrule: args.rrule === null ? "" : (args.rrule || event.rrule || buildIcsRrule(args)),
    reminders: args.reminders || args.reminder || args.alarm ? normalizeCalendarReminders(args.reminders || args.reminder || args.alarm) : event.reminders || [],
  });
  await yandexDavRequest(event.url, await requireYandexOAuthToken("organizer", "Яндекс Календарь"), { method: "PUT", ics: true, body: next, timeout: 45000 });
  return { status: "calendar-event-updated", uid: event.uid, title: args.title || event.title, href: event.href };
}

async function yandexCalendarMove(query, args = {}) {
  if (!args.confirm) throw new Error("Для переноса события нужен аргумент confirm=true.");
  const dateTime = args.start || args.date ? {} : extractDateTimeFromText(args.text || args.source_question || "");
  const start = args.start || args.date || dateTime.start;
  if (!start) throw new Error("Укажите новую дату/время события.");
  const end = args.end || dateTime.end || new Date(new Date(start).getTime() + 3600000).toISOString();
  return yandexCalendarUpdate(query, { ...args, start, end, confirm: true });
}

async function yandexCalendarAddReminder(query, args = {}) {
  if (!args.confirm) throw new Error("Для добавления напоминания нужен аргумент confirm=true.");
  const minutes = Number(args.minutes || args.beforeMinutes || String(args.reminder || "").match(/\d+/u)?.[0] || 15);
  return yandexCalendarUpdate(query, { ...args, reminders: [`-${minutes}`], confirm: true });
}

async function yandexCalendarDelete(query, args = {}) {
  if (!args.confirm) throw new Error("Для удаления события нужен аргумент confirm=true.");
  const resolved = await resolveYandexCalendarEvent(query, args);
  if (resolved.status !== "ok") return resolved;
  const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
  await yandexDavRequest(resolved.event.url, token, { method: "DELETE", timeout: 45000 });
  return { status: "calendar-event-deleted", uid: resolved.event.uid, title: resolved.event.title, href: resolved.event.href };
}

async function resolveYandexCalendarEvent(query, args = {}) {
  const uid = String(args.uid || "").trim();
  const href = String(args.href || "").trim();
  if (href) {
    const token = await requireYandexOAuthToken("organizer", "Яндекс Календарь");
    const url = new URL(href, "https://caldav.yandex.ru/").toString();
    const ics = await yandexDavRequest(url, token, { method: "GET", timeout: 45000 });
    const event = parseIcsEvents(ics, { baseUrl: url.replace(/[^/]+$/u, "") })[0];
    return event ? { status: "ok", event: { ...event, href, url, ics } } : { status: "not-found", query: href };
  }
  const needle = normalizeGeoText(uid || query || args.query || args.title || "");
  const rows = await yandexCalendarSearch("", {
    ...args,
    start: args.startRange || args.start || new Date(Date.now() - 365 * 86400000).toISOString(),
    end: args.endRange || args.end || new Date(Date.now() + 365 * 86400000).toISOString(),
    limit: 500,
  });
  const matches = rows.filter((row) => {
    if (uid && row.uid === uid) return true;
    const haystack = normalizeGeoText([row.title, row.description, row.location, row.start, row.startIso, row.end, row.endIso, row.uid, row.href].filter(Boolean).join(" "));
    return needle && haystack.includes(needle);
  });
  if (!matches.length) return { status: "not-found", kind: "calendar-event", query: query || uid };
  if (matches.length > 1 && !args.selectFirst) return { status: "ambiguous", kind: "calendar-event", query: query || uid, events: matches.slice(0, 10).map(stripCalendarPrivateFields) };
  return { status: "ok", event: matches[0] };
}

async function yandexCalendarBaseUrl(token, args = {}) {
  const calendars = await yandexCalendarCollections(token);
  const selected = pickYandexCalendar(calendars, args);
  if (!selected) throw new Error("В Яндекс Календаре не найдена календарная коллекция.");
  return selected.url;
}

async function yandexCalendarCollections(token) {
  const root = "https://caldav.yandex.ru/";
  const principalXml = await yandexDavRequest(root, token, {
    method: "PROPFIND",
    headers: { Depth: "0" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal/></d:prop></d:propfind>",
  });
  const principalHref = extractDavHref(principalXml, "current-user-principal");
  if (!principalHref) throw new Error("Яндекс Календарь не вернул current-user-principal.");
  const homeXml = await yandexDavRequest(new URL(principalHref, root).toString(), token, {
    method: "PROPFIND",
    headers: { Depth: "0" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><c:calendar-home-set/></d:prop></d:propfind>",
  });
  const homeHref = extractDavHref(homeXml, "calendar-home-set");
  if (!homeHref) throw new Error("Яндекс Календарь не вернул calendar-home-set.");
  const listXml = await yandexDavRequest(new URL(homeHref, root).toString(), token, {
    method: "PROPFIND",
    headers: { Depth: "1" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>",
  });
  return extractCalendarCollections(listXml).map((row) => ({ ...row, url: new URL(row.href, root).toString() }));
}

function pickYandexCalendar(calendars, args = {}) {
  const query = normalizeGeoText(args.calendar || args.calendarName || args.name || "");
  if (query) {
    const found = calendars.find((row) => normalizeGeoText(`${row.name} ${row.href}`).includes(query));
    if (found) return found;
  }
  return calendars.find((row) => !/\/(?:inbox|outbox)\//iu.test(row.href)) || calendars[0] || null;
}

async function yandexDocsStatus() {
  const info = await yandexDiskInfo();
  await ensureYandexDiskDir(`${CLOUD_DEFAULT_REMOTE_DIR}/docs`, { allowExisting: true });
  return { status: "ok", provider: "yandex-disk", folder: `${CLOUD_DEFAULT_REMOTE_DIR}/docs`, totalSpace: info.totalSpace, usedSpace: info.usedSpace };
}

async function yandexDocsList(args = {}) {
  const folder = normalizeCloudUserPath(args.path || args.folder || `${CLOUD_DEFAULT_REMOTE_DIR}/docs`, "yandex-disk");
  const rows = await yandexDiskListRecursive(folder, { depth: Number(args.depth || 3), limit: Number(args.limit || 100) }).catch(() => []);
  return rows.filter(isYandexDocumentResource).slice(0, Number(args.limit || 50));
}

async function yandexDocsFind(query, args = {}) {
  const needle = normalizeGeoText(query || args.query || "");
  const rows = await yandexDocsList({ ...args, limit: Math.max(200, Number(args.limit || 20) * 10) });
  if (!needle) return rows.slice(0, Number(args.limit || 20));
  return rows.filter((row) => normalizeGeoText(`${row.name} ${row.path}`).includes(needle)).slice(0, Number(args.limit || 20));
}

async function yandexDocsCreateText(args = {}) {
  if (!args.confirm) throw new Error("Для создания документа нужен аргумент confirm=true.");
  const text = String(args.text || args.content || "").trim();
  if (!text) throw new Error("Текст документа пустой.");
  const ext = normalizeYandexDocExtension(args.format || args.ext || path.extname(args.path || args.remotePath || ""));
  const title = slugYandexDiskName(args.title || args.name || `document-${timestampForFile()}`);
  const remotePath = normalizeCloudUserPath(args.path || args.remotePath || `${CLOUD_DEFAULT_REMOTE_DIR}/docs/${title}${title.endsWith(ext) ? "" : ext}`, "yandex-disk");
  const saved = await yandexDiskSaveText(text, remotePath);
  return { ...saved, status: "document-created", title: path.posix.basename(remotePath), remote: remotePath };
}

async function yandexDocsRead(target, args = {}) {
  const doc = await resolveYandexDoc(target, args);
  if (doc.status !== "ok") return doc;
  if (!/\.(txt|md|csv|json|html)$/iu.test(doc.path)) {
    return { status: "binary-document", remote: doc.path, name: doc.name, message: "Этот документ не текстовый. Его можно скачать, переименовать, удалить или опубликовать ссылкой." };
  }
  return yandexDiskReadText(doc.path, args);
}

async function yandexDocsShare(target, args = {}) {
  if (!args.confirm) throw new Error("Для публикации документа нужен аргумент confirm=true.");
  const doc = await resolveYandexDoc(target, args);
  if (doc.status !== "ok") return doc;
  return yandexDiskShareWithQr(doc.path, { ...args, confirm: true });
}

async function yandexDocsRename(target, newName, args = {}) {
  if (!args.confirm) throw new Error("Для переименования документа нужен аргумент confirm=true.");
  const doc = await resolveYandexDoc(target, args);
  if (doc.status !== "ok") return doc;
  if (!newName) throw new Error("Укажите новое имя документа.");
  return yandexDiskRename(doc.path, newName, { ...args, confirm: true, overwrite: args.overwrite !== false });
}

async function yandexDocsDelete(target, args = {}) {
  if (!args.confirm) throw new Error("Для удаления документа нужен аргумент confirm=true.");
  const doc = await resolveYandexDoc(target, args);
  if (doc.status !== "ok") return doc;
  return yandexDiskDelete(doc.path, args);
}

async function resolveYandexDoc(target, args = {}) {
  const value = String(target || "").trim();
  if (value.startsWith("/")) {
    const statRow = await yandexDiskStat(value);
    return isYandexDocumentResource(statRow) ? { status: "ok", ...statRow } : { status: "not-document", path: value };
  }
  const rows = await yandexDocsFind(value, { ...args, limit: 10 });
  if (!rows.length) return { status: "not-found", query: value };
  if (rows.length > 1 && !args.selectFirst) return { status: "ambiguous", query: value, docs: rows.slice(0, 10) };
  return { status: "ok", ...rows[0] };
}

function isYandexDocumentResource(row = {}) {
  return row.type !== "dir" && /\.(docx|xlsx|pptx|pdf|txt|md|html|csv|json)$/iu.test(row.name || row.path || "");
}

function normalizeYandexDocExtension(value) {
  const ext = String(value || "").replace(/^\./u, "").toLocaleLowerCase("en-US");
  if (["txt", "md", "html", "csv", "json"].includes(ext)) return `.${ext}`;
  return ".md";
}

async function yandexContactsStatus() {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Контакты");
  const url = await yandexContactsBaseUrl(token);
  const text = await yandexDavRequest(url, token, { method: "PROPFIND", headers: { Depth: "0" }, xml: true, body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/></d:prop></d:propfind>" });
  return { status: "ok", url, displayName: stripXmlTags(text.match(/<[^:>]*:?displayname[^>]*>([\s\S]*?)<\/[^:>]*:?displayname>/iu)?.[1] || "") || "contacts" };
}

async function yandexContactsList(args = {}) {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Контакты");
  const url = await yandexContactsBaseUrl(token);
  const body = "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:getetag/><d:getcontenttype/></d:prop></d:propfind>";
  const text = await yandexDavRequest(url, token, { method: "PROPFIND", headers: { Depth: "1" }, xml: true, body, timeout: 45000 });
  const hrefs = extractVcardHrefs(text).slice(0, Number(args.limit || 50));
  const rows = [];
  for (const href of hrefs) {
    const card = await yandexDavRequest(new URL(href, "https://carddav.yandex.ru/").toString(), token, { method: "GET", timeout: 30000 }).catch(() => "");
    rows.push(...parseVCards(card).map((row) => args.full ? { ...row, href, card } : row));
  }
  return rows.slice(0, Number(args.limit || 50));
}

async function yandexContactsSearch(query, args = {}) {
  const normalized = normalizeGeoText(query);
  const rows = await yandexContactsList({ limit: Math.max(1000, Number(args.limit || 20) * 10) });
  if (!normalized) return rows.slice(0, Number(args.limit || 20));
  return rows.filter((row) => contactMatchesQuery(row, normalized)).slice(0, Number(args.limit || 20));
}

async function resolveYandexMailRecipientFromContacts(query) {
  const normalized = normalizeContactLookupText(query);
  if (!normalized) return { status: "not-found", contacts: [] };
  const rows = await yandexContactsList({ limit: 300 });
  const matches = rows.filter((row) => contactMatchesQuery(row, normalized)).slice(0, 10);
  if (!matches.length) return { status: "not-found", contacts: [] };
  const withEmail = matches.filter((row) => row.email);
  if (withEmail.length === 1) return { status: "ok", contact: withEmail[0] };
  if (withEmail.length > 1) return { status: "ambiguous", contacts: withEmail };
  return matches.length === 1
    ? { status: "no-email", contact: matches[0] }
    : { status: "ambiguous", contacts: matches };
}

async function yandexContactsAddEmail(query, email, args = {}) {
  if (!args.confirm) throw new Error("Для изменения контакта нужен аргумент confirm=true.");
  if (!query) throw new Error("Укажите имя или часть имени контакта.");
  if (!email || !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(String(email))) throw new Error("Укажите корректный email.");
  const result = await yandexContactsUpdate(query, { ...args, email, mode: "add-email" });
  if (result.status === "updated") return { status: "updated", name: result.name, email };
  return result;
}

async function yandexContactsGet(query, args = {}) {
  const resolved = await resolveYandexContact(query, args);
  if (resolved.status !== "ok") return resolved;
  const { card: _card, ...contact } = resolved.contact;
  return { status: "ok", ...contact };
}

async function yandexContactsUpdate(query, args = {}) {
  if (!args.confirm) throw new Error("Для изменения контакта нужен аргумент confirm=true.");
  if (!query) throw new Error("Укажите имя, email или телефон контакта.");
  const resolved = await resolveYandexContact(query, args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  let card = contact.card;
  if (args.name || args.fullName) {
    card = upsertVcardProperty(card, "FN", args.name || args.fullName, { replace: true });
    card = upsertVcardProperty(card, "N", `${escapeVcardValue(args.name || args.fullName)};;;;`, { replace: true, raw: true });
  }
  if (args.email) card = upsertVcardProperty(card, "EMAIL;TYPE=INTERNET", String(args.email).trim(), { replace: args.overwriteEmail || args.overwrite || args.mode === "set-email" });
  if (args.phone) card = upsertVcardProperty(card, "TEL;TYPE=CELL", String(args.phone).trim(), { replace: args.overwritePhone || args.overwrite || args.mode === "set-phone" });
  if (args.address) card = upsertVcardProperty(card, "ADR;TYPE=HOME", `;;;;${escapeVcardValue(args.address)};;`, { replace: args.overwriteAddress || args.overwrite || args.mode === "set-address", raw: true });
  if (args.note) card = upsertVcardProperty(card, "NOTE", args.note, { replace: args.overwriteNote || args.overwrite || args.mode === "set-note" });
  if (args.birthday) card = upsertVcardProperty(card, "BDAY", normalizeVcardBirthday(args.birthday), { replace: true });
  if (args.org) card = upsertVcardProperty(card, "ORG", args.org, { replace: args.overwriteOrg || args.overwrite || args.mode === "set-org" });
  if (args.title) card = upsertVcardProperty(card, "TITLE", args.title, { replace: true });
  if (args.categories || args.group) card = upsertVcardProperty(card, "CATEGORIES", Array.isArray(args.categories) ? args.categories.join(",") : (args.categories || args.group), { replace: Boolean(args.overwriteCategories) });
  if (args.removeEmail) card = removeVcardProperty(card, "EMAIL", args.removeEmail === true ? "" : args.removeEmail);
  if (args.removePhone) card = removeVcardProperty(card, "TEL", args.removePhone === true ? "" : args.removePhone);
  if (card === contact.card) return { status: "unchanged", name: contact.name, email: contact.email, phone: contact.phone };
  await saveYandexContactCard(contact.href, card);
  const parsed = parseVCards(card)[0] || {};
  return { status: "updated", ...parsed, href: contact.href };
}

async function yandexContactsDelete(query, args = {}) {
  if (!args.confirm) throw new Error("Для удаления контакта нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(query, args);
  if (resolved.status !== "ok") return resolved;
  const token = await requireYandexOAuthToken("organizer", "Яндекс Контакты");
  await yandexDavRequest(new URL(resolved.contact.href, "https://carddav.yandex.ru/").toString(), token, { method: "DELETE", timeout: 45000 });
  return { status: "deleted", name: resolved.contact.name, email: resolved.contact.email, phone: resolved.contact.phone };
}

async function yandexContactsCreate(args = {}) {
  if (!args.confirm) throw new Error("Для создания контакта нужен аргумент confirm=true.");
  const name = String(args.name || args.email || "").trim();
  const email = String(args.email || "").trim();
  const phone = String(args.phone || "").trim();
  if (!name) throw new Error("Имя контакта обязательно.");
  if (email && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(email)) throw new Error("Укажите корректный email.");
  if (!email && !phone) throw new Error("Для контакта нужен хотя бы email или телефон.");
  const token = await requireYandexOAuthToken("organizer", "Яндекс Контакты");
  const baseUrl = await yandexContactsBaseUrl(token);
  const uid = `${randomUUID()}@iola-cli`;
  const card = buildVcard({
    uid,
    name,
    email,
    phone,
    address: args.address,
    note: args.note,
    birthday: args.birthday,
    org: args.org || args.organization,
    title: args.title || args.position,
    categories: args.categories || args.group,
  });
  await yandexDavRequest(new URL(`${encodeURIComponent(uid)}.vcf`, baseUrl).toString(), token, {
    method: "PUT",
    headers: { "content-type": "text/vcard; charset=utf-8" },
    body: card,
    timeout: 45000,
  });
  return { status: "created", name, email, phone, uid };
}

async function yandexContactsExport(format, args = {}) {
  const rows = await yandexContactsList({ limit: Number(args.limit || 1000), full: true });
  const safeFormat = format === "csv" ? "csv" : "vcard";
  const output = args.output || path.join(CONFIG_DIR, `yandex-contacts-${timestampForFile()}.${safeFormat === "csv" ? "csv" : "vcf"}`);
  const text = safeFormat === "csv"
    ? contactsToCsv(rows)
    : rows.map((row) => row.card).filter(Boolean).join("\r\n");
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, text, "utf8");
  saveArtifact("yandex-contacts-export", output, output, { rows: rows.length, format: safeFormat });
  return { status: "exported", output: path.resolve(output), rows: rows.length, format: safeFormat };
}

async function yandexContactsFindIncomplete(args = {}) {
  const rows = await yandexContactsList({ limit: Number(args.limit || 500) });
  return rows.filter((row) => {
    if (args.field === "email") return !row.email;
    if (args.field === "phone") return !row.phone;
    if (args.field === "address") return !row.address;
    return !row.email || !row.phone || !row.name;
  }).slice(0, Number(args.limit || 50));
}

async function yandexContactsFindDuplicates(args = {}) {
  const rows = await yandexContactsList({ limit: Number(args.limit || 1000) });
  const groups = new Map();
  for (const row of rows) {
    const keys = [
      row.email ? `email:${row.email.toLocaleLowerCase("en-US")}` : "",
      row.phone ? `phone:${normalizePhone(row.phone)}` : "",
      row.name ? `name:${normalizeContactLookupText(row.name)}` : "",
    ].filter((key) => key && !key.endsWith(":"));
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }
  const seen = new Set();
  const duplicates = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const signature = group.map((row) => row.href || `${row.name}:${row.email}:${row.phone}`).sort().join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    duplicates.push({ status: "duplicate-group", key, count: group.length, contacts: group.slice(0, 10) });
  }
  return duplicates.slice(0, Number(args.limit || 20));
}

async function yandexContactsBackupToDisk(args = {}) {
  if (!args.confirm) throw new Error("Для резервной копии контактов на Диск нужен аргумент confirm=true.");
  const format = args.format === "csv" ? "csv" : "vcard";
  const rows = await yandexContactsList({ limit: Number(args.limit || 1000), full: true });
  const remotePath = args.path || `${CLOUD_DEFAULT_REMOTE_DIR}/contacts/yandex-contacts-${timestampForFile()}.${format === "csv" ? "csv" : "vcf"}`;
  const text = format === "csv" ? contactsToCsv(rows) : rows.map((row) => row.card).filter(Boolean).join("\r\n");
  const saved = await yandexDiskSaveText(text, remotePath);
  return { provider: "yandex-disk", status: "contacts-backup", remote: saved.remote, rows: rows.length, format };
}

async function yandexContactsImport(format, args = {}) {
  if (!args.confirm) throw new Error("Для импорта контактов нужен аргумент confirm=true.");
  const inputPath = args.path || args.file || args.input;
  if (!inputPath) throw new Error("Укажите файл для импорта.");
  const text = await readFile(path.resolve(inputPath), "utf8");
  const rows = format === "csv" ? parseContactsCsv(text) : parseVCards(text);
  const existing = await yandexContactsList({ limit: 1000 });
  const existingEmails = new Set(existing.flatMap((row) => row.emails || []).map((email) => email.toLocaleLowerCase("en-US")));
  const existingPhones = new Set(existing.flatMap((row) => row.phones || []).map(normalizePhone).filter(Boolean));
  const created = [];
  const skipped = [];
  for (const row of rows.slice(0, Number(args.limit || 200))) {
    const email = row.email || row.emails?.[0] || "";
    const phone = row.phone || row.phones?.[0] || "";
    const emailKey = email.toLocaleLowerCase("en-US");
    const phoneKey = normalizePhone(phone);
    if ((!email && !phone) || (emailKey && existingEmails.has(emailKey)) || (phoneKey && existingPhones.has(phoneKey))) {
      skipped.push(row);
      continue;
    }
    const createdRow = await yandexContactsCreate({
      name: row.name || email || phone,
      email,
      phone,
      address: row.address,
      note: row.note,
      birthday: row.birthday,
      org: row.org,
      title: row.title,
      categories: row.categories,
      confirm: true,
    });
    created.push(createdRow);
    if (emailKey) existingEmails.add(emailKey);
    if (phoneKey) existingPhones.add(phoneKey);
  }
  return { status: "contacts-imported", format, input: path.resolve(inputPath), created: created.length, skipped: skipped.length };
}

async function yandexContactsBirthdaysToCalendar(args = {}) {
  if (!args.confirm) throw new Error("Для создания событий дней рождения нужен аргумент confirm=true.");
  const rows = await yandexContactsList({ limit: Number(args.limit || 1000) });
  const withBirthday = rows.filter((row) => row.birthday);
  const created = [];
  for (const contact of withBirthday.slice(0, Number(args.maxCreate || 50))) {
    const next = nextBirthdayDate(contact.birthday);
    if (!next) continue;
    const result = await yandexCalendarCreateEvent({
      title: `День рождения: ${contact.name || contact.email || contact.phone}`,
      start: next.start,
      end: next.end,
      description: `Контакт: ${formatYandexContact(contact)}`,
      confirm: true,
    });
    created.push(result);
  }
  return { status: "birthday-events-created", created: created.length, totalWithBirthday: withBirthday.length };
}

async function yandexContactSendMail(args = {}) {
  if (!args.confirm) throw new Error("Для отправки письма контакту нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(args.query || args.contact || args.name || "", args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  if (!contact.email) return { status: "no-email", contact: stripYandexContactPrivateFields(contact) };
  const sent = await yandexMailSend({
    to: [contact.email],
    subject: args.subject || "Сообщение от IOLA CLI",
    text: args.text || args.message || "",
    confirm: true,
  });
  return { status: "contact-mail-sent", contact: contact.name || contact.email, to: sent.to, subject: sent.subject };
}

async function yandexContactSendDiskLinkQr(args = {}) {
  if (!args.confirm) throw new Error("Для отправки ссылки контакту нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(args.query || args.contact || args.name || "", args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  if (!contact.email) return { status: "no-email", contact: stripYandexContactPrivateFields(contact) };
  const result = await yandexDiskShareEmail({
    remotePath: args.path || args.remotePath || args.target,
    to: [contact.email],
    subject: args.subject,
    text: args.text || args.message,
    confirm: true,
  });
  return { ...result, status: "contact-disk-link-sent", contact: contact.name || contact.email };
}

async function yandexContactCreateDiskFolder(args = {}) {
  if (!args.confirm) throw new Error("Для создания папки контакта нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(args.query || args.contact || args.name || "", args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  const folder = args.path || `${CLOUD_DEFAULT_REMOTE_DIR}/contacts/${slugYandexDiskName(contact.name || contact.email || contact.phone || "contact")}`;
  await cloudCreateFolder("yandex-disk", folder);
  const cardPath = path.posix.join(folder, "contact.vcf");
  await yandexDiskSaveText(contact.card, cardPath);
  const note = [
    `Контакт: ${contact.name || "-"}`,
    `Email: ${(contact.emails || []).join(", ") || "-"}`,
    `Телефон: ${(contact.phones || []).join(", ") || "-"}`,
    contact.address ? `Адрес: ${contact.address}` : "",
    contact.org ? `Организация: ${contact.org}` : "",
    contact.title ? `Должность: ${contact.title}` : "",
    contact.note ? `Заметка: ${contact.note}` : "",
  ].filter(Boolean).join("\n");
  await yandexDiskSaveText(note, path.posix.join(folder, "README.txt"));
  return { provider: "yandex-disk", status: "contact-folder-created", contact: contact.name || contact.email, remote: folder, cardPath };
}

async function yandexContactCreateCalendarEvent(args = {}) {
  if (!args.confirm) throw new Error("Для создания встречи с контактом нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(args.query || args.contact || args.name || "", args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  if (!contact.email) return { status: "no-email", contact: stripYandexContactPrivateFields(contact) };
  const result = await yandexCalendarCreateEvent({
    ...args,
    title: args.title || `Встреча: ${contact.name || contact.email}`,
    description: [args.description || "", `Контакт: ${contact.name || "-"}`, `Email: ${contact.email}`].filter(Boolean).join("\n"),
    attendees: [contact.email],
    confirm: true,
  });
  return { ...result, status: "contact-calendar-event-created", contact: contact.name || contact.email, attendee: contact.email };
}

async function yandexContactCreateTelemostEvent(args = {}) {
  const result = await yandexContactCreateCalendarEvent({
    ...args,
    title: args.title || `Телемост: ${args.contact || args.name || args.query || "контакт"}`,
    description: [args.description || "", "Телемост: создайте ссылку в Яндекс Календаре, если интерфейс календаря предложит видеовстречу."].filter(Boolean).join("\n"),
    confirm: true,
  });
  return { ...result, status: "contact-telemost-event-created" };
}

async function yandexContactFromPublicEntity(args = {}) {
  if (!args.confirm) throw new Error("Для создания контакта из городского слоя нужен аргумент confirm=true.");
  const layer = normalizeEntityLayer(args.layer || (/(сад|детсад)/iu.test(args.query || "") ? "kindergartens" : "schools"));
  const sourceQuery = args.query || args.name || args.inn || "";
  const number = String(sourceQuery).match(/№?\s*(\d{1,4})/u)?.[1] || "";
  const query = number
    ? (layer === "kindergartens" ? `детский сад ${number}` : `школа ${number}`)
    : sourceQuery;
  const rows = await searchPublicEntities({ layer, query, limit: 5 });
  if (!rows.length) return { status: "not-found", query: args.query || args.name || args.inn || "" };
  const entity = rows[0];
  const name = args.contactName || entity.name || entity.fns_short_name || args.query;
  const email = entity.email || "";
  const phone = entity.phone || "";
  if (!email && !phone) return { status: "no-contact-fields", entity };
  return yandexContactsCreate({
    name,
    email,
    phone,
    address: entity.address,
    org: entity.name,
    note: `Создано из открытого слоя ${layer}. ИНН: ${entity.inn || "-"}.`,
    confirm: true,
  });
}

async function yandexContactFullPack(args = {}) {
  if (!args.confirm) throw new Error("Для полного сценария по контакту нужен аргумент confirm=true.");
  const resolved = await resolveYandexContact(args.query || args.contact || args.name || "", args);
  if (resolved.status !== "ok") return resolved;
  const contact = resolved.contact;
  const folder = await yandexContactCreateDiskFolder({ query: contact.email || contact.name || contact.phone, confirm: true, selectFirst: true });
  const noteText = [
    `# ${contact.name || contact.email || contact.phone}`,
    "",
    `Email: ${contact.email || "-"}`,
    `Телефон: ${contact.phone || "-"}`,
    `Адрес: ${contact.address || "-"}`,
    `Организация: ${contact.org || "-"}`,
    "",
    args.note || args.text || "Пакет контакта создан IOLA CLI.",
  ].join("\n");
  const doc = await yandexDocsCreateText({ path: path.posix.join(folder.remote, "meeting-note.md"), text: noteText, confirm: true });
  const shared = await yandexDiskShareWithQr(folder.remote, { confirm: true });
  const dateTime = args.start || args.date ? { start: args.start || args.date, end: args.end } : extractDateTimeFromText(args.text || args.source_question || "");
  let event = null;
  if (args.createEvent !== false && contact.email) {
    event = await yandexCalendarCreateEvent({
      ...dateTime,
      title: args.title || `Встреча: ${contact.name || contact.email}`,
      description: [`Папка контакта: ${folder.remote}`, `Ссылка: ${shared.publicUrl}`, args.note || ""].filter(Boolean).join("\n"),
      attendees: [contact.email],
      confirm: true,
    });
  }
  let sent = null;
  if ((args.send || args.email) && contact.email) {
    sent = await yandexMailSend({
      to: [contact.email],
      subject: args.subject || `Материалы IOLA: ${contact.name || contact.email}`,
      text: [args.message || "Подготовил материалы.", `Ссылка: ${shared.publicUrl}`, `QR-код: ${shared.qrPublicUrl}`].join("\n"),
      confirm: true,
    });
  }
  return { status: "contact-full-pack-created", contact: contact.name || contact.email, folder: folder.remote, doc: doc.remote, publicUrl: shared.publicUrl, qrPublicUrl: shared.qrPublicUrl, event: event?.uid || "", sentTo: sent?.to || [] };
}

async function resolveYandexContact(query, args = {}) {
  const rows = await yandexContactsList({ limit: Math.max(500, Number(args.limit || 100)), full: true });
  const normalized = normalizeContactLookupText(query || args.query || args.name || args.email || args.phone || "");
  const matches = rows.filter((row) => contactMatchesQuery(row, normalized)).slice(0, 20);
  if (!matches.length) return { status: "not-found", query };
  const exact = pickExactYandexContactMatch(matches, query, args);
  if (exact) return { status: "ok", contact: exact };
  if (matches.length > 1 && !args.selectFirst) return { status: "ambiguous", query, contacts: matches.map(stripYandexContactPrivateFields) };
  return { status: "ok", contact: matches[0] };
}

function pickExactYandexContactMatch(matches, query, args = {}) {
  const text = String(query || args.email || args.phone || args.name || "").trim();
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0]?.toLocaleLowerCase("en-US");
  if (email) return matches.find((row) => row.emails?.some((item) => item.toLocaleLowerCase("en-US") === email));
  const phone = normalizePhone(args.phone || text);
  if (phone.length >= 7) return matches.find((row) => row.phones?.some((item) => normalizePhone(item).endsWith(phone) || phone.endsWith(normalizePhone(item))));
  const normalized = normalizeContactLookupText(text);
  return matches.find((row) => normalizeContactLookupText(row.name) === normalized) || null;
}

function stripYandexContactPrivateFields(row = {}) {
  const { card: _card, ...rest } = row;
  return rest;
}

async function saveYandexContactCard(href, card) {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Контакты");
  await yandexDavRequest(new URL(href, "https://carddav.yandex.ru/").toString(), token, {
    method: "PUT",
    headers: { "content-type": "text/vcard; charset=utf-8" },
    body: ensureVcardCrlf(card),
    timeout: 45000,
  });
}

function buildVcard(args = {}) {
  const uid = args.uid || `${randomUUID()}@iola-cli`;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${uid}`,
    `FN:${escapeVcardValue(args.name || args.email || args.phone || "Контакт")}`,
    `N:${escapeVcardValue(args.name || args.email || args.phone || "Контакт")};;;;`,
    args.email ? `EMAIL;TYPE=INTERNET:${String(args.email).trim()}` : "",
    args.phone ? `TEL;TYPE=CELL:${escapeVcardValue(args.phone)}` : "",
    args.address ? `ADR;TYPE=HOME:;;;;${escapeVcardValue(args.address)};;` : "",
    args.org ? `ORG:${escapeVcardValue(args.org)}` : "",
    args.title ? `TITLE:${escapeVcardValue(args.title)}` : "",
    args.birthday ? `BDAY:${normalizeVcardBirthday(args.birthday)}` : "",
    args.note ? `NOTE:${escapeVcardValue(args.note)}` : "",
    args.categories ? `CATEGORIES:${escapeVcardValue(Array.isArray(args.categories) ? args.categories.join(",") : args.categories)}` : "",
    "END:VCARD",
    "",
  ].filter((line) => line !== "");
  return lines.join("\r\n");
}

function upsertVcardEmail(card, email, options = {}) {
  return upsertVcardProperty(card, "EMAIL;TYPE=INTERNET", email, { replace: Boolean(options.overwrite) });
}

function upsertVcardProperty(card, property, value, options = {}) {
  const text = String(card || "").replace(/\r/g, "").trim();
  if (!text.includes("BEGIN:VCARD")) throw new Error("Контакт не похож на vCard.");
  const propName = String(property || "").split(";")[0].toLocaleUpperCase("en-US");
  const rawValue = options.raw ? String(value || "") : escapeVcardValue(value);
  if (!rawValue) return text;
  const line = `${property}:${rawValue}`;
  const pattern = new RegExp(`^${escapeRegExp(propName)}[^:]*:[^\\n]*`, "imu");
  if (pattern.test(text)) {
    if (!options.replace) return text;
    return text.replace(pattern, line);
  }
  return text.replace(/\nEND:VCARD/iu, `\n${line}\nEND:VCARD`);
}

function removeVcardProperty(card, property, value = "") {
  const text = String(card || "").replace(/\r/g, "").trim();
  const propName = String(property || "").split(";")[0].toLocaleUpperCase("en-US");
  const lines = text.split(/\n/u);
  const needle = String(value || "").toLocaleLowerCase("ru-RU");
  const next = lines.filter((line) => {
    if (!new RegExp(`^${escapeRegExp(propName)}(?:[;:]|$)`, "iu").test(line)) return true;
    if (!needle) return false;
    return !line.toLocaleLowerCase("ru-RU").includes(needle);
  });
  return next.join("\n");
}

function escapeVcardValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function contactMatchesQuery(contact, normalizedQuery) {
  const query = normalizeContactLookupText(normalizedQuery);
  const contactText = normalizeContactLookupText([
    contact.name,
    contact.email,
    ...(contact.emails || []),
    contact.phone,
    ...(contact.phones || []),
    contact.address,
    contact.org,
    contact.title,
    contact.note,
    contact.categories,
  ].filter(Boolean).join(" "));
  const queryPhone = normalizePhone(normalizedQuery);
  if (queryPhone.length >= 7 && [...(contact.phones || []), contact.phone].some((phone) => {
    const contactPhone = normalizePhone(phone);
    return contactPhone.length >= 7 && (contactPhone.includes(queryPhone) || queryPhone.includes(contactPhone));
  })) return true;
  const normalizedQueryText = query;
  if (!contactText || !normalizedQueryText) return false;
  if (contactText.includes(normalizedQueryText)) return true;
  const queryTokens = normalizedQueryText.split(/\s+/u).filter(Boolean);
  const contactTokens = contactText.split(/\s+/u).filter(Boolean);
  return queryTokens.every((queryToken) => contactTokens.some((contactToken) => contactToken.startsWith(queryToken.slice(0, Math.max(4, Math.min(queryToken.length, 6)))) || queryToken.startsWith(contactToken.slice(0, Math.max(4, Math.min(contactToken.length, 6))))));
}

function normalizeContactLookupText(value) {
  return normalizeGeoText(String(value || "").replace(/\b(?:кому|контакт|письмо|сообщение)\b/giu, " ")).trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]+/g, "");
}

function normalizeVcardBirthday(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/u);
  if (ru) {
    const year = ru[3] ? (ru[3].length === 2 ? `20${ru[3]}` : ru[3]) : "1900";
    return `${year}-${String(ru[2]).padStart(2, "0")}-${String(ru[1]).padStart(2, "0")}`;
  }
  return text;
}

function contactsToCsv(rows) {
  const headers = ["name", "email", "emails", "phone", "phones", "address", "org", "title", "birthday", "note", "categories"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => contactsCsvCell(Array.isArray(row[key]) ? row[key].join("; ") : row[key])).join(",")),
  ].join("\n");
}

function contactsCsvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function parseContactsCsv(text) {
  const rows = parseSimpleCsv(text);
  return rows.map((row) => ({
    name: row.name || row.Name || row["Имя"] || row["ФИО"] || "",
    email: row.email || row.Email || row["Почта"] || row["Email"] || "",
    phone: row.phone || row.Phone || row["Телефон"] || "",
    address: row.address || row.Address || row["Адрес"] || "",
    org: row.org || row.organization || row["Организация"] || "",
    title: row.title || row.position || row["Должность"] || "",
    birthday: row.birthday || row.Birthday || row["День рождения"] || "",
    note: row.note || row.Note || row["Заметка"] || "",
    categories: row.categories || row.group || row["Группа"] || "",
  })).filter((row) => row.name || row.email || row.phone);
}

function parseSimpleCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitContactsCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitContactsCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function splitContactsCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < String(line || "").length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function nextBirthdayDate(value) {
  const normalized = normalizeVcardBirthday(value);
  const match = normalized.match(/^\d{4}-(\d{2})-(\d{2})$/u)
    || normalized.match(/^\d{4}(\d{2})(\d{2})$/u)
    || normalized.match(/^(\d{2})-(\d{2})$/u)
    || normalized.match(/^(\d{2})(\d{2})$/u);
  if (!match) return null;
  const now = new Date();
  let date = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), 9, 0, 0);
  if (date < now) date = new Date(now.getFullYear() + 1, Number(match[1]) - 1, Number(match[2]), 9, 0, 0);
  return { start: date.toISOString(), end: new Date(date.getTime() + 3600000).toISOString() };
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function yandexContactsBaseUrl(token) {
  const root = "https://carddav.yandex.ru/";
  const principalXml = await yandexDavRequest(root, token, {
    method: "PROPFIND",
    headers: { Depth: "0" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:current-user-principal/></d:prop></d:propfind>",
  });
  const principalHref = extractDavHref(principalXml, "current-user-principal");
  if (!principalHref) throw new Error("Яндекс Контакты не вернули current-user-principal.");
  const homeXml = await yandexDavRequest(new URL(principalHref, root).toString(), token, {
    method: "PROPFIND",
    headers: { Depth: "0" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:card=\"urn:ietf:params:xml:ns:carddav\"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>",
  });
  const homeHref = extractDavHref(homeXml, "addressbook-home-set");
  if (!homeHref) throw new Error("Яндекс Контакты не вернули addressbook-home-set.");
  const listXml = await yandexDavRequest(new URL(homeHref, root).toString(), token, {
    method: "PROPFIND",
    headers: { Depth: "1" },
    xml: true,
    body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>",
  });
  const addressBookHref = extractAddressBookCollectionHref(listXml);
  if (!addressBookHref) throw new Error("В Яндекс Контактах не найдена адресная книга.");
  return new URL(addressBookHref, root).toString();
}

async function yandexTelemostStatus() {
  const calendar = await yandexCalendarStatus();
  return {
    status: "calendar-fallback",
    provider: "yandex-telemost",
    calendar: calendar.displayName,
    message: "Для обычного OAuth-подключения CLI использует календарное событие. Прямой Telemost API проверяется отдельно и может быть доступен только аккаунтам/организациям Яндекс 360.",
  };
}

async function yandexTelemostCreateEvent(args = {}) {
  if (!args.confirm) throw new Error("Для создания встречи нужен аргумент confirm=true.");
  const telemost = await tryCreateYandexTelemostMeeting(args).catch((error) => ({
    status: "telemost-api-unavailable",
    error: error instanceof Error ? error.message : String(error),
  }));
  const description = [
    args.description || "",
    "",
    telemost.joinUrl ? `Ссылка Телемоста: ${telemost.joinUrl}` : "Телемост: прямое создание ссылки через API недоступно для текущего OAuth-подключения. Событие создано в календаре как встреча; ссылку можно добавить вручную в Яндекс Календаре.",
  ].join("\n").trim();
  const event = await yandexCalendarCreateEvent({
    ...args,
    title: args.title || args.summary || "Телемост IOLA",
    description,
    location: telemost.joinUrl || args.location || "Яндекс Телемост",
    confirm: true,
  });
  return { ...event, status: telemost.joinUrl ? "telemost-event-created" : "telemost-calendar-fallback-created", telemost };
}

async function tryCreateYandexTelemostMeeting(args = {}) {
  const token = await requireYandexOAuthToken("organizer", "Яндекс Телемост");
  const endpoints = [
    "https://cloud-api.yandex.net/v1/telemost/meetings",
    "https://api360.yandex.net/v1/telemost/meetings",
  ];
  let lastError = "";
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: args.title || args.summary || "Телемост IOLA",
        description: args.description || "",
      }),
      signal: AbortSignal.timeout(15000),
    }).catch((error) => ({ ok: false, status: 0, statusText: error.message, text: async () => error.message }));
    const text = await response.text().catch(() => "");
    if (response.ok) {
      const payload = text ? JSON.parse(text) : {};
      return {
        status: "telemost-api-created",
        endpoint,
        id: payload.id || payload.meeting_id || "",
        joinUrl: payload.join_url || payload.url || payload.link || payload.meeting_url || "",
        raw: payload,
      };
    }
    lastError = `${endpoint}: ${response.status} ${response.statusText} ${sanitizeSecretFromText(text.slice(0, 500), token)}`;
    if (![404, 405].includes(Number(response.status))) break;
  }
  throw new Error(lastError || "Telemost API недоступен.");
}

function buildIcsEvent({ uid, start, end, summary, description, location, attendees = [], rrule = "", reminders = [] }) {
  const escape = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const attendeeLines = (Array.isArray(attendees) ? attendees : [attendees])
    .map((email) => String(email || "").trim())
    .filter((email) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(email))
    .map((email) => `ATTENDEE;CN=${escape(email)};ROLE=REQ-PARTICIPANT:mailto:${email}`);
  const reminderBlocks = normalizeCalendarReminders(reminders).map((minutes) => [
    "BEGIN:VALARM",
    `TRIGGER:-PT${Math.max(1, Math.abs(Number(minutes) || 15))}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(summary || "Напоминание")}`,
    "END:VALARM",
  ].join("\r\n"));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IOLA CLI//Yandex Calendar//RU",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escape(summary)}`,
    description ? `DESCRIPTION:${escape(description)}` : "",
    location ? `LOCATION:${escape(location)}` : "",
    rrule ? `RRULE:${rrule}` : "",
    ...attendeeLines,
    ...reminderBlocks,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].filter(Boolean).join("\r\n");
}

function toIcsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Некорректная дата: ${value}`);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
}

function parseIcsEvents(xmlOrIcs, options = {}) {
  const text = String(xmlOrIcs || "");
  const responses = text.split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  if (responses.length) {
    return responses.flatMap((response) => {
      const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || "")).trim();
      const calendarData = response.match(/<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/iu)?.[1] || response;
      return parseIcsEvents(calendarData, options).map((row) => ({
        ...row,
        href: row.href || href,
        url: row.url || (href ? new URL(href, options.baseUrl || "https://caldav.yandex.ru/").toString() : ""),
      }));
    });
  }
  const decoded = decodeXml(stripXmlTags(text));
  return decoded.split("BEGIN:VEVENT").slice(1).map((chunk) => {
    const lines = unfoldIcsLines(`BEGIN:VEVENT${chunk}`);
    const uid = icsValue(lines, "UID");
    const start = icsValue(lines, "DTSTART");
    const end = icsValue(lines, "DTEND");
    return {
      uid,
      title: unescapeIcsValue(icsValue(lines, "SUMMARY")),
      start,
      end,
      startIso: icsDateToIso(start),
      endIso: icsDateToIso(end),
      location: unescapeIcsValue(icsValue(lines, "LOCATION")),
      description: unescapeIcsValue(icsValue(lines, "DESCRIPTION")),
      rrule: icsValue(lines, "RRULE"),
      attendees: icsValues(lines, "ATTENDEE").map((value) => value.replace(/^mailto:/iu, "")),
      reminders: parseIcsReminderMinutes(lines),
      ics: decoded.includes("BEGIN:VCALENDAR") ? decoded : "",
    };
  }).filter((item) => item.uid || item.title);
}

function unfoldIcsLines(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function icsValues(lines, property) {
  const prop = String(property || "").toLocaleUpperCase("en-US");
  return lines
    .filter((line) => line.toLocaleUpperCase("en-US").startsWith(`${prop};`) || line.toLocaleUpperCase("en-US").startsWith(`${prop}:`))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);
}

function icsValue(lines, property) {
  return icsValues(lines, property)[0] || "";
}

function unescapeIcsValue(value) {
  return String(value || "")
    .replace(/\\n/giu, "\n")
    .replace(/\\,/gu, ",")
    .replace(/\\;/gu, ";")
    .replace(/\\\\/gu, "\\")
    .trim();
}

function icsDateToIso(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/u);
  if (!match) return "";
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4] || "00"}:${match[5] || "00"}:${match[6] || "00"}${text.endsWith("Z") ? "Z" : ""}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseIcsReminderMinutes(lines) {
  return lines
    .filter((line) => /^TRIGGER:/iu.test(line))
    .map((line) => Number(line.match(/PT(\d+)M/iu)?.[1] || 0))
    .filter(Boolean);
}

function normalizeCalendarReminders(value) {
  const rows = Array.isArray(value) ? value : String(value || "").split(/[;,]/u);
  return rows.map((item) => Number(String(item).match(/\d+/u)?.[0] || 0)).filter(Boolean);
}

function buildIcsRrule(args = {}) {
  const repeat = String(args.repeat || args.frequency || "").toLocaleLowerCase("ru-RU");
  if (!repeat && !args.count && !args.until) return "";
  const freq = /день|daily|day/iu.test(repeat) ? "DAILY"
    : /месяц|monthly|month/iu.test(repeat) ? "MONTHLY"
      : /год|year|yearly|annual/iu.test(repeat) ? "YEARLY"
        : "WEEKLY";
  const parts = [`FREQ=${freq}`];
  if (args.count) parts.push(`COUNT=${Number(args.count)}`);
  if (args.until) parts.push(`UNTIL=${toIcsDate(args.until)}`);
  return parts.join(";");
}

function extractDavHref(xml, propertyName) {
  const pattern = new RegExp(`<[^:>]*:?${propertyName}[^>]*>[\\s\\S]*?<[^:>]*:?href[^>]*>([\\s\\S]*?)<\\/[^:>]*:?href>`, "iu");
  const value = String(xml || "").match(pattern)?.[1] || "";
  return decodeXml(stripXmlTags(value)).trim();
}

function extractCalendarCollectionHref(xml) {
  const responses = String(xml || "").split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  for (const response of responses) {
    if (!/<[^:>]*:?calendar(?:\s|>|\/)/iu.test(response)) continue;
    const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || "")).trim();
    if (href && !/\/(?:inbox|outbox)\//iu.test(href)) return href;
  }
  return "";
}

function extractCalendarCollections(xml) {
  const responses = String(xml || "").split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  const rows = [];
  for (const response of responses) {
    if (!/<[^:>]*:?calendar(?:\s|>|\/)/iu.test(response)) continue;
    const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || "")).trim();
    if (!href || /\/(?:inbox|outbox)\//iu.test(href)) continue;
    const name = stripXmlTags(response.match(/<[^:>]*:?displayname[^>]*>([\s\S]*?)<\/[^:>]*:?displayname>/iu)?.[1] || "").trim() || path.posix.basename(href.replace(/\/$/u, ""));
    rows.push({ provider: "yandex-calendar", href, name, type: "calendar" });
  }
  return rows;
}

function stripCalendarPrivateFields(row = {}) {
  const { ics: _ics, url: _url, ...rest } = row;
  return rest;
}

function extractAddressBookCollectionHref(xml) {
  const responses = String(xml || "").split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  for (const response of responses) {
    if (!/<[^:>]*:?addressbook(?:\s|>|\/)/iu.test(response)) continue;
    const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || "")).trim();
    if (href) return href;
  }
  return "";
}

function extractVcardHrefs(xml) {
  const responses = String(xml || "").split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  const rows = [];
  for (const response of responses) {
    if (!/text\/x-vcard|text\/vcard/iu.test(response)) continue;
    const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || "")).trim();
    if (href) rows.push(href);
  }
  return rows;
}

function parseVCards(xmlOrCards) {
  const decoded = decodeXml(stripXmlTags(xmlOrCards)).replace(/\r/g, "");
  return decoded.split("BEGIN:VCARD").slice(1).map((chunk) => {
    const card = `BEGIN:VCARD\n${chunk}`.replace(/\n+/g, "\n").trim();
    const lines = unfoldVcardLines(chunk);
    const emails = vcardValues(lines, "EMAIL");
    const phones = vcardValues(lines, "TEL");
    const name = cleanVcardName(vcardValue(lines, "FN") || vcardValue(lines, "N"), emails[0] || phones[0] || "");
    const address = cleanVcardAddress(vcardValue(lines, "ADR"));
    const row = {
      uid: vcardValue(lines, "UID"),
      name,
      email: emails[0] || "",
      emails,
      phone: phones[0] || "",
      phones,
      address,
      org: cleanVcardName(vcardValue(lines, "ORG")),
      title: cleanVcardName(vcardValue(lines, "TITLE")),
      note: unescapeVcardValue(vcardValue(lines, "NOTE")),
      birthday: vcardValue(lines, "BDAY"),
      categories: vcardValue(lines, "CATEGORIES"),
      card: ensureVcardCrlf(card),
    };
    return row;
  }).filter((item) => item.name || item.email || item.phone);
}

function cleanVcardName(value, fallback = "") {
  const text = unescapeVcardValue(value).replace(/;/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /^[\s;]+$/u.test(String(value || ""))) return fallback || "";
  return text;
}

function unfoldVcardLines(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function vcardValues(lines, property) {
  const prop = String(property || "").toLocaleUpperCase("en-US");
  return lines
    .filter((line) => line.toLocaleUpperCase("en-US").startsWith(`${prop};`) || line.toLocaleUpperCase("en-US").startsWith(`${prop}:`))
    .map((line) => unescapeVcardValue(line.slice(line.indexOf(":") + 1).trim()))
    .filter(Boolean);
}

function vcardValue(lines, property) {
  return vcardValues(lines, property)[0] || "";
}

function cleanVcardAddress(value) {
  return unescapeVcardValue(value).split(";").map((part) => part.trim()).filter(Boolean).join(", ");
}

function unescapeVcardValue(value) {
  return String(value || "")
    .replace(/\\n/giu, "\n")
    .replace(/\\,/gu, ",")
    .replace(/\\;/gu, ";")
    .replace(/\\\\/gu, "\\")
    .trim();
}

function ensureVcardCrlf(value) {
  return String(value || "").replace(/\r/g, "").replace(/\n/g, "\r\n").trim() + "\r\n";
}

function normalizeYandexServiceList(values) {
  const aliases = {
    id: "identity",
    login: "identity",
    "профиль": "identity",
    "диск": "disk",
    "яндекс-диск": "disk",
    yandexdisk: "disk",
    "yandex-disk": "disk",
    "почта": "mail",
    "календарь": "calendar",
    "контакты": "contacts",
    "вики": "wiki",
    "трекер": "tracker",
    "формы": "forms",
    "документы": "docs",
    "телемост": "telemost",
    "облако": "cloud",
    "карты": "maps",
    "такси": "taxi",
    "маркет": "market",
    "доставка": "delivery",
    all: "all",
    "все": "all",
  };
  const result = [];
  for (const raw of values.flatMap((item) => String(item || "").split(","))) {
    const normalized = raw.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) continue;
    const id = aliases[normalized] || normalized;
    if (id === "all") {
      result.push(...Object.keys(YANDEX_CONNECTOR_SERVICES));
      continue;
    }
    if (!YANDEX_CONNECTOR_SERVICES[id]) {
      throw new Error(`Неизвестный сервис Яндекса: ${raw}. Список: iola yandex services`);
    }
    result.push(id);
  }
  return [...new Set(result)];
}

async function setupCloudProvider(providerValue, options = {}) {
  const provider = normalizeCloudProvider(providerValue);
  if (!process.stdin.isTTY) throw new Error("Для настройки облака запустите команду в интерактивном терминале.");
  const secrets = await loadSecrets();
  secrets.cloud = secrets.cloud || {};

  if (provider === "yandex-disk") {
    console.log("Яндекс Диск использует OAuth-токен пользователя с доступом к Диску.");
    console.log("Инструкция: https://github.com/adm-iola/iola-cli/wiki/Облачные-диски");
    const token = (await askText("Введите OAuth-токен Яндекс Диска: ")).trim();
    if (!token) throw new Error("Токен пустой, сохранение отменено.");
    secrets.cloud[provider] = { token };
  } else if (provider === "mailru-cloud") {
    console.log("Облако Mail.ru подключается через WebDAV и пароль внешнего приложения.");
    console.log("Инструкция: https://github.com/adm-iola/iola-cli/wiki/Облачные-диски");
    const username = (await askText("Введите email Mail.ru: ")).trim();
    const password = (await askText("Введите пароль внешнего приложения/WebDAV: ")).trim();
    if (!username || !password) throw new Error("Email или пароль пустой, сохранение отменено.");
    secrets.cloud[provider] = { username, password, baseUrl: options.baseUrl || "https://webdav.cloud.mail.ru" };
  }

  await saveSecrets(secrets);
  const config = await loadConfig();
  await saveConfig({ cloud: { ...(config.cloud || {}), activeProvider: provider } });
  console.log(`Облачный диск сохранен и выбран: ${provider}`);
  await printCloudStatus({ check: true });
}

async function printCloudStatus(options = {}) {
  const config = await loadConfig();
  const secrets = await loadSecrets();
  const rows = ["yandex-disk", "mailru-cloud"].map((provider) => ({
    provider,
    active: config.cloud?.activeProvider === provider ? "yes" : "no",
    configured: secrets.cloud?.[provider] ? "yes" : "no",
    root: cloudRootForProvider(provider, config),
  }));
  printTable(rows, [["provider", "Провайдер"], ["active", "Активен"], ["configured", "Настроен"], ["root", "Папка"]]);
  if (options.check) {
    for (const row of rows.filter((item) => item.configured === "yes")) {
      try {
        const listed = await cloudList(row.provider, cloudRootForProvider(row.provider), { allowMissingRoot: true });
        console.log(`${row.provider}: ok (${listed.length} объектов в корневой папке IOLA или папка доступна)`);
      } catch (error) {
        console.log(`${row.provider}: error - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

function normalizeCloudProvider(value) {
  const text = String(value || "").toLocaleLowerCase("ru-RU").trim();
  if (!text || text === "yandex" || text === "yandex-disk" || text === "яндекс" || text === "яндекс-диск") return "yandex-disk";
  if (text === "mailru" || text === "mailru-cloud" || text === "mail" || text === "mail.ru" || text === "облако-mail") return "mailru-cloud";
  throw new Error("Поддерживаются облака: yandex-disk, mailru-cloud.");
}

async function getCloudProvider(value) {
  if (value) return normalizeCloudProvider(value);
  const config = await loadConfig();
  const provider = normalizeCloudProvider(config.cloud?.activeProvider || "yandex-disk");
  await requireCloudCredentials(provider);
  return provider;
}

async function requireCloudCredentials(provider) {
  const secrets = await loadSecrets();
  const credentials = secrets.cloud?.[provider];
  if (!credentials) throw new Error(`Облачный диск не настроен: ${provider}. Запустите: iola cloud setup ${provider}`);
  return credentials;
}

function cloudRootForProvider(provider, config = null) {
  const loaded = config || readConfigLayerSync(CONFIG_FILE) || {};
  return loaded.cloud?.providers?.[provider]?.root || DEFAULT_AI_CONFIG.cloud.providers[provider]?.root || CLOUD_DEFAULT_REMOTE_DIR;
}

async function cloudList(provider, remotePath, options = {}) {
  if (provider === "yandex-disk") return yandexDiskList(remotePath, options);
  if (provider === "mailru-cloud") return mailruCloudList(remotePath, options);
  throw new Error(`Провайдер не поддерживается: ${provider}`);
}

async function cloudUpload(provider, localPath, remotePath, options = {}) {
  if (provider === "yandex-disk") return yandexDiskUpload(localPath, remotePath, options);
  if (provider === "mailru-cloud") return mailruCloudUpload(localPath, remotePath, options);
  throw new Error(`Провайдер не поддерживается: ${provider}`);
}

async function cloudDownload(provider, remotePath, outputPath) {
  if (provider === "yandex-disk") return yandexDiskDownload(remotePath, outputPath);
  if (provider === "mailru-cloud") return mailruCloudDownload(remotePath, outputPath);
  throw new Error(`Провайдер не поддерживается: ${provider}`);
}

async function cloudFind(provider, query, options = {}) {
  if (provider === "yandex-disk") return yandexDiskFind(query, options);
  if (provider === "mailru-cloud") {
    const rows = await mailruCloudList(options.path || CLOUD_DEFAULT_REMOTE_DIR);
    return rows.filter((row) => normalizeGeoText(`${row.name} ${row.path}`).includes(normalizeGeoText(query))).slice(0, Number(options.limit || 50));
  }
  throw new Error(`Провайдер не поддерживается: ${provider}`);
}

async function cloudCreateFolder(provider, remotePath) {
  if (provider === "yandex-disk") {
    await ensureYandexDiskDir(remotePath, { allowExisting: true });
    return { provider, path: normalizeYandexDiskPath(remotePath), status: "created-or-exists" };
  }
  if (provider === "mailru-cloud") {
    await ensureMailruCloudDir(remotePath);
    return { provider, path: remotePath, status: "created-or-exists" };
  }
  throw new Error(`Провайдер не поддерживается: ${provider}`);
}

async function cloudShare(provider, remotePath) {
  if (provider === "yandex-disk") return yandexDiskShare(remotePath);
  throw new Error("Публичные ссылки через CLI сейчас поддерживаются только для Яндекс Диска.");
}

async function yandexDiskRequest(method, apiPath, options = {}) {
  const credentials = await requireCloudCredentials("yandex-disk");
  const url = new URL(`https://cloud-api.yandex.net/v1/disk${apiPath}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `OAuth ${credentials.token}`,
      ...(options.headers || {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(Number(options.timeout || 30000)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Yandex Disk request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, credentials.token)}`);
  }
  if (response.status === 204) return {};
  const text = await response.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function yandexDiskList(remotePath, options = {}) {
  await ensureYandexDiskDir(remotePath, { allowExisting: true, allowMissingRoot: Boolean(options.allowMissingRoot) });
  const payload = await yandexDiskRequest("GET", "/resources", { query: { path: normalizeYandexDiskPath(remotePath), limit: 100 } });
  const items = payload._embedded?.items || [];
  return items.map((item) => ({
    type: item.type === "dir" ? "dir" : "file",
    name: item.name || path.basename(item.path || ""),
    path: denormalizeYandexDiskPath(item.path || ""),
    size: item.size || "-",
  }));
}

async function yandexDiskFind(query, options = {}) {
  const needle = normalizeGeoText(query);
  const rows = await yandexDiskListRecursive(options.path || CLOUD_DEFAULT_REMOTE_DIR, { depth: Number(options.depth || 4), limit: Math.max(100, Number(options.limit || 50) * 5) });
  return rows
    .filter((item) => normalizeGeoText(`${item.name} ${item.path}`).includes(needle))
    .slice(0, Number(options.limit || 50));
}

async function yandexDiskStat(remotePath) {
  if (!remotePath) throw new Error("Путь на Яндекс Диске обязателен.");
  const payload = await yandexDiskRequest("GET", "/resources", {
    query: {
      path: normalizeYandexDiskPath(remotePath),
      fields: "name,path,type,size,created,modified,mime_type,public_url,preview,md5,sha256,embedded",
    },
  });
  return formatYandexDiskResource(payload);
}

async function yandexDiskExists(remotePath) {
  try {
    const stat = await yandexDiskStat(remotePath);
    return { provider: "yandex-disk", path: stat.path, exists: true, type: stat.type, name: stat.name };
  } catch (error) {
    if (/404|DiskNotFoundError|Path not found/iu.test(String(error?.message || ""))) {
      return { provider: "yandex-disk", path: remotePath, exists: false };
    }
    throw error;
  }
}

async function yandexDiskReadText(remotePath, options = {}) {
  if (!remotePath) throw new Error("Путь к текстовому файлу на Яндекс Диске обязателен.");
  const maxBytes = Number(options.maxBytes || 200000);
  const download = await yandexDiskRequest("GET", "/resources/download", { query: { path: normalizeYandexDiskPath(remotePath) } });
  const response = await fetch(download.href, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Yandex Disk read failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`Файл слишком большой для чтения: ${buffer.length} байт. Лимит: ${maxBytes}.`);
  return { provider: "yandex-disk", remote: remotePath, text: buffer.toString("utf8"), size: buffer.length };
}

async function yandexDiskMove(from, to, options = {}) {
  if (!options.confirm) throw new Error("Для перемещения на Яндекс Диске нужен аргумент confirm=true.");
  if (!from || !to) throw new Error("Для перемещения нужны from и to.");
  await ensureYandexDiskDir(path.dirname(to), { allowExisting: true });
  await yandexDiskRequest("POST", "/resources/move", {
    query: { from: normalizeYandexDiskPath(from), path: normalizeYandexDiskPath(to), overwrite: Boolean(options.overwrite) },
    timeout: 60000,
  });
  return { provider: "yandex-disk", status: "moved", from, remote: to };
}

async function yandexDiskCopy(from, to, options = {}) {
  if (!options.confirm) throw new Error("Для копирования на Яндекс Диске нужен аргумент confirm=true.");
  if (!from || !to) throw new Error("Для копирования нужны from и to.");
  await ensureYandexDiskDir(path.dirname(to), { allowExisting: true });
  await yandexDiskRequest("POST", "/resources/copy", {
    query: { from: normalizeYandexDiskPath(from), path: normalizeYandexDiskPath(to), overwrite: Boolean(options.overwrite) },
    timeout: 60000,
  });
  return { provider: "yandex-disk", status: "copied", from, remote: to };
}

async function yandexDiskRename(remotePath, newName, options = {}) {
  if (!remotePath || !newName) throw new Error("Для переименования нужны путь и новое имя.");
  const current = denormalizeYandexDiskPath(normalizeYandexDiskPath(remotePath));
  const target = path.posix.join(path.posix.dirname(current), slugYandexDiskName(newName));
  return yandexDiskMove(remotePath, target, { ...options, confirm: true });
}

async function yandexDiskTrashList(remotePath = "", options = {}) {
  const query = { limit: Number(options.limit || 100) };
  if (remotePath) query.path = normalizeYandexDiskPath(remotePath);
  const payload = await yandexDiskRequest("GET", "/trash/resources", { query });
  const items = payload._embedded?.items || [];
  return items.map(formatYandexDiskResource);
}

async function yandexDiskRestore(remotePath, options = {}) {
  if (!options.confirm) throw new Error("Для восстановления из корзины нужен аргумент confirm=true.");
  if (!remotePath) throw new Error("Путь в корзине обязателен.");
  await yandexDiskRequest("PUT", "/trash/resources/restore", {
    query: { path: normalizeYandexDiskPath(remotePath), name: options.name || "", overwrite: Boolean(options.overwrite) },
    timeout: 60000,
  });
  return { provider: "yandex-disk", status: "restored", remote: remotePath };
}

async function yandexDiskEmptyTrash(options = {}) {
  if (!options.confirm) throw new Error("Для очистки корзины нужен аргумент confirm=true.");
  await yandexDiskRequest("DELETE", "/trash/resources", {
    query: { path: options.path ? normalizeYandexDiskPath(options.path) : "" },
    timeout: 60000,
  });
  return { provider: "yandex-disk", status: "trash-empty-requested", remote: options.path || "trash" };
}

function formatYandexDiskResource(item = {}) {
  return {
    provider: "yandex-disk",
    type: item.type === "dir" ? "dir" : "file",
    name: item.name || path.basename(item.path || ""),
    path: denormalizeYandexDiskPath(item.path || ""),
    remote: denormalizeYandexDiskPath(item.path || ""),
    size: item.size || 0,
    mimeType: item.mime_type || "",
    created: item.created || "",
    modified: item.modified || "",
    publicUrl: item.public_url || "",
    md5: item.md5 || "",
    sha256: item.sha256 || "",
  };
}

function slugYandexDiskName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    || `item-${timestampForFile()}`;
}

async function yandexDiskListRecursive(remotePath, options = {}) {
  const depth = Number(options.depth || 4);
  const limit = Number(options.limit || 200);
  const rows = [];
  await yandexDiskWalk(remotePath, rows, depth, limit);
  return rows;
}

async function yandexDiskWalk(remotePath, rows, depth, limit) {
  if (rows.length >= limit || depth < 0) return;
  const items = await yandexDiskList(remotePath).catch(() => []);
  for (const item of items) {
    if (rows.length >= limit) break;
    rows.push(item);
    if (item.type === "dir") await yandexDiskWalk(item.path, rows, depth - 1, limit);
  }
}

async function yandexDiskUpload(localPath, remotePath, options = {}) {
  const resolved = path.resolve(localPath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Это не файл: ${localPath}`);
  await ensureYandexDiskDir(path.dirname(remotePath), { allowExisting: true });
  const upload = await yandexDiskRequest("GET", "/resources/upload", { query: { path: normalizeYandexDiskPath(remotePath), overwrite: options.overwrite !== false } });
  const bytes = await readFile(resolved);
  const response = await fetch(upload.href, { method: upload.method || "PUT", body: bytes, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Yandex Disk upload failed: ${response.status} ${response.statusText}`);
  return { provider: "yandex-disk", local: resolved, remote: remotePath, size: info.size };
}

async function yandexDiskDownload(remotePath, outputPath) {
  const download = await yandexDiskRequest("GET", "/resources/download", { query: { path: normalizeYandexDiskPath(remotePath) } });
  const response = await fetch(download.href, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Yandex Disk download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, buffer);
  return { provider: "yandex-disk", remote: remotePath, local: resolved, size: buffer.length };
}

async function yandexDiskShare(remotePath) {
  await yandexDiskRequest("PUT", "/resources/publish", { query: { path: normalizeYandexDiskPath(remotePath) } });
  const payload = await yandexDiskRequest("GET", "/resources", { query: { path: normalizeYandexDiskPath(remotePath), fields: "name,path,public_url" } });
  return { provider: "yandex-disk", remote: remotePath, publicUrl: payload.public_url || "-" };
}

async function yandexDiskShareWithQr(remotePath, options = {}) {
  if (!options.confirm) throw new Error("Для публикации ссылки и QR нужен аргумент confirm=true.");
  if (!remotePath) throw new Error("Путь на Яндекс Диске обязателен.");
  const shared = await yandexDiskShare(remotePath);
  const qrRemotePath = options.qrPath || buildYandexDiskQrPath(remotePath);
  const tempPath = path.join(CONFIG_DIR, `qr-${Date.now()}.png`);
  await mkdir(CONFIG_DIR, { recursive: true });
  try {
    await createQrPng(shared.publicUrl, tempPath);
    await yandexDiskUpload(tempPath, qrRemotePath, { overwrite: true });
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
  const qrShared = await yandexDiskShare(qrRemotePath);
  return {
    provider: "yandex-disk",
    status: "shared-with-qr",
    remote: remotePath,
    publicUrl: shared.publicUrl,
    qrRemote: qrRemotePath,
    qrPublicUrl: qrShared.publicUrl,
  };
}

async function yandexDiskShareEmail(args = {}) {
  if (!args.confirm) throw new Error("Для отправки ссылки по почте нужен аргумент confirm=true.");
  const remotePath = args.remotePath || args.path || args.targetFolder || args.target;
  if (!remotePath) throw new Error("Путь на Яндекс Диске обязателен.");
  const to = await resolveYandexShareRecipients(args);
  const shared = await yandexDiskShareWithQr(remotePath, { ...args, confirm: true });
  const subject = args.subject || `Ссылка на Яндекс Диск: ${path.posix.basename(remotePath) || "материалы"}`;
  const text = [
    args.text || args.message || "Здравствуйте. Направляю ссылку на материалы.",
    "",
    `Ссылка: ${shared.publicUrl}`,
    `QR-код: ${shared.qrPublicUrl}`,
    "",
    "QR-код сохранен на Яндекс Диске:",
    shared.qrRemote,
  ].join("\n");
  const sent = await yandexMailSend({ to, subject, text, confirm: true });
  return { ...shared, status: "shared-and-sent", to: sent.to, subject };
}

async function yandexDiskPackageShareEmail(args = {}) {
  if (!args.confirm) throw new Error("Для пакетной отправки папки нужен аргумент confirm=true.");
  const sourcePath = args.sourcePath || args.source || args.from;
  const targetFolder = args.targetFolder || args.target || args.to;
  if (!sourcePath || !targetFolder) throw new Error("Нужны sourcePath и targetFolder.");
  await cloudCreateFolder("yandex-disk", targetFolder);
  const items = await yandexDiskList(sourcePath);
  const mode = /move|перен/iu.test(args.mode || "") ? "move" : "copy";
  const transferred = [];
  for (const item of items.slice(0, Number(args.limit || 100))) {
    const destination = path.posix.join(targetFolder, item.name);
    if (mode === "move") {
      await yandexDiskMove(item.path, destination, { confirm: true, overwrite: args.overwrite !== false });
    } else {
      await yandexDiskCopy(item.path, destination, { confirm: true, overwrite: args.overwrite !== false });
    }
    transferred.push({ from: item.path, to: destination, type: item.type });
  }
  const shared = await yandexDiskShareEmail({
    remotePath: targetFolder,
    to: args.to,
    email: args.email,
    contact: args.contact || args.contactQuery,
    subject: args.subject || `Материалы на Яндекс Диске: ${path.posix.basename(targetFolder)}`,
    text: args.text || args.message || `Собрал материалы в папку ${targetFolder}.`,
    confirm: true,
  });
  return {
    ...shared,
    status: "package-shared-and-sent",
    sourcePath,
    targetFolder,
    mode,
    transferred: transferred.length,
  };
}

async function resolveYandexShareRecipients(args = {}) {
  const emails = Array.isArray(args.to) ? args.to : String(args.to || args.email || "").split(/[;,]/u).map((item) => item.trim()).filter(Boolean);
  if (emails.length) return emails;
  const contactQuery = args.contact || args.contactQuery || args.name || "";
  if (!contactQuery) throw new Error("Укажите email или контакт получателя.");
  const result = await resolveYandexMailRecipientFromContacts(contactQuery);
  if (result.status === "not-found") throw new Error(`В Яндекс Контактах не нашел: ${contactQuery}. Укажите email вручную.`);
  if (result.status === "no-email") throw new Error(`Контакт найден, но email не указан: ${result.contact.name}. Укажите email вручную.`);
  if (result.status === "ambiguous") {
    const rows = result.contacts.map((contact, index) => `${index + 1}. ${contact.name || contact.email || "Контакт"}${contact.email ? `, ${contact.email}` : ", email не указан"}`).join("\n");
    throw new Error(`Нашел несколько контактов для "${contactQuery}". Уточните получателя:\n${rows}`);
  }
  return [result.contact.email];
}

async function createQrPng(text, outputPath) {
  const QRCode = await import("qrcode");
  await QRCode.toFile(outputPath, String(text || ""), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
}

function buildYandexDiskQrPath(remotePath) {
  const current = denormalizeYandexDiskPath(normalizeYandexDiskPath(remotePath));
  const dir = path.posix.dirname(current);
  const base = path.posix.basename(current).replace(/\.[^.]+$/u, "");
  return path.posix.join(dir, `${slugYandexDiskName(base || "link")}-qr.png`);
}

async function ensureYandexDiskDir(remotePath, options = {}) {
  const normalized = normalizeYandexDiskPath(remotePath || CLOUD_DEFAULT_REMOTE_DIR);
  const plain = denormalizeYandexDiskPath(normalized);
  const parts = plain.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await yandexDiskRequest("PUT", "/resources", { query: { path: current } });
    } catch (error) {
      const message = String(error?.message || "");
      if (/409|DiskPathPointsToExistentDirectoryError|уже существует/iu.test(message)) continue;
      if (options.allowMissingRoot && /404/iu.test(message)) continue;
      throw error;
    }
  }
}

function normalizeYandexDiskPath(remotePath) {
  const text = String(remotePath || CLOUD_DEFAULT_REMOTE_DIR).trim().replace(/\\/g, "/");
  if (text.startsWith("disk:") || text.startsWith("app:") || text.startsWith("trash:")) return text;
  return text.startsWith("/") ? text : `/${text}`;
}

function denormalizeYandexDiskPath(remotePath) {
  return String(remotePath || "").replace(/^disk:/u, "").replace(/^app:/u, "") || "/";
}

async function mailruCloudRequest(method, remotePath, options = {}) {
  const credentials = await requireCloudCredentials("mailru-cloud");
  const baseUrl = String(credentials.baseUrl || "https://webdav.cloud.mail.ru").replace(/\/+$/u, "");
  const url = `${baseUrl}${encodeWebDavPath(remotePath)}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
      ...(options.headers || {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(Number(options.timeout || 30000)),
  });
  if (!response.ok && !(method === "MKCOL" && response.status === 405)) {
    const text = await response.text().catch(() => "");
    throw new Error(`Mail.ru Cloud WebDAV request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, credentials.password)}`);
  }
  return response;
}

async function mailruCloudList(remotePath, options = {}) {
  await ensureMailruCloudDir(remotePath, { allowMissingRoot: Boolean(options.allowMissingRoot) });
  const response = await mailruCloudRequest("PROPFIND", remotePath, { headers: { Depth: "1" } });
  const text = await response.text();
  return parseWebDavList(text, remotePath);
}

async function mailruCloudUpload(localPath, remotePath) {
  const resolved = path.resolve(localPath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Это не файл: ${localPath}`);
  await ensureMailruCloudDir(path.dirname(remotePath));
  const bytes = await readFile(resolved);
  await mailruCloudRequest("PUT", remotePath, { body: bytes, timeout: 120000 });
  return { provider: "mailru-cloud", local: resolved, remote: remotePath, size: info.size };
}

async function mailruCloudDownload(remotePath, outputPath) {
  const response = await mailruCloudRequest("GET", remotePath, { timeout: 120000 });
  const buffer = Buffer.from(await response.arrayBuffer());
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, buffer);
  return { provider: "mailru-cloud", remote: remotePath, local: resolved, size: buffer.length };
}

async function ensureMailruCloudDir(remotePath, options = {}) {
  const parts = String(remotePath || CLOUD_DEFAULT_REMOTE_DIR).replace(/\\/g, "/").split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await mailruCloudRequest("MKCOL", current);
    } catch (error) {
      const message = String(error?.message || "");
      if (/405|409/iu.test(message)) continue;
      if (options.allowMissingRoot && /404/iu.test(message)) continue;
      throw error;
    }
  }
}

function encodeWebDavPath(remotePath) {
  const normalized = String(remotePath || "/").replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean).map(encodeURIComponent);
  return `/${segments.join("/")}${normalized.endsWith("/") ? "/" : ""}`;
}

function parseWebDavList(xml, basePath) {
  const responses = String(xml || "").split(/<[^:>]*:?response[^>]*>/iu).slice(1);
  const rows = [];
  for (const response of responses) {
    const href = decodeXml(stripXmlTags(response.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/iu)?.[1] || ""));
    const name = decodeXml(stripXmlTags(response.match(/<[^:>]*:?displayname[^>]*>([\s\S]*?)<\/[^:>]*:?displayname>/iu)?.[1] || "")) || path.basename(href);
    const size = decodeXml(stripXmlTags(response.match(/<[^:>]*:?getcontentlength[^>]*>([\s\S]*?)<\/[^:>]*:?getcontentlength>/iu)?.[1] || ""));
    const isDir = /<[^:>]*:?collection\s*\/?>/iu.test(response);
    const normalizedPath = decodeURIComponent(href || "");
    if (normalizeGeoText(normalizedPath).replace(/\s+/g, "") === normalizeGeoText(basePath).replace(/\s+/g, "")) continue;
    rows.push({ type: isDir ? "dir" : "file", name, path: normalizedPath, size: size || "-" });
  }
  return rows;
}

function stripXmlTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "").trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

async function cloudBackup(provider) {
  const config = await loadConfig();
  const payload = {
    createdAt: new Date().toISOString(),
    version: getPackageVersion(),
    note: "Секреты, API-ключи и токены не включены в резервную копию.",
    config: {
      api: config.api,
      ai: { activeProfile: config.ai?.activeProfile, provider: config.ai?.provider, model: config.ai?.model, profiles: config.ai?.profiles },
      files: config.files,
      skills: config.skills,
      cloud: config.cloud,
    },
  };
  const tempPath = path.join(CONFIG_DIR, `iola-backup-${timestampForFile()}.json`);
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    return cloudUpload(provider, tempPath, `${cloudRootForProvider(provider)}/backup/${path.basename(tempPath)}`, { overwrite: true });
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
      ...YANDEX_TOOLS.map((tool) => ({
        permission: `localTools.${tool}`,
        value: permissions.localTools?.[tool] === true ? "allow" : "deny",
        scope: "yandex-tool",
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

  if (provider === "openai" || provider === "openrouter" || provider === "yandexgpt" || provider === "gigachat") {
    const options = parseOptions(args.slice(1));
    const model = options.model || {
      openai: "gpt-4.1-mini",
      openrouter: "openai/gpt-4.1-mini",
      yandexgpt: "yandexgpt-lite/latest",
      gigachat: "GigaChat-2",
    }[provider];
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
    const envHint = {
      openai: "OPENAI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      yandexgpt: "YANDEXGPT_API_KEY и YANDEXGPT_FOLDER_ID",
      gigachat: "GIGACHAT_AUTH_KEY",
    }[provider];
    console.log(`Также можно использовать переменную окружения ${envHint}.`);
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
  iola ai key set yandexgpt
  iola ai key set gigachat
  iola ai key set openai
  iola ai key set openrouter
  iola ai key status
  iola ai key delete yandexgpt|gigachat|openai|openrouter`);
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

  if (!["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер обязателен: iola ai models iola|ollama|yandexgpt|gigachat|openai|openrouter|codex");
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
    ["releaseDate", "Дата"],
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
    const relayConfig = await getApiProviderNetworkConfig("openai");
    if (getAiNetworkMode(relayConfig) === "gateway") {
      const payload = await callAiRelayModels(relayConfig, apiKey, "OpenAI");
      return (payload.data || [])
        .map(mapOpenAiModel)
        .sort(sortModelsByFreshness);
    }
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`OpenAI models request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return (payload.data || [])
      .map(mapOpenAiModel)
      .sort(sortModelsByFreshness);
  }

  if (provider === "openrouter") {
    const apiKey = await getApiKey("openrouter");
    const relayConfig = await getApiProviderNetworkConfig("openrouter");
    if (apiKey && getAiNetworkMode(relayConfig) === "gateway") {
      const payload = await callAiRelayModels(relayConfig, apiKey, "OpenRouter");
      return (payload.data || [])
        .map(mapOpenRouterModel)
        .sort((left, right) => left.id.localeCompare(right.id));
    }
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return (payload.data || [])
      .map(mapOpenRouterModel)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  if (provider === "yandexgpt") {
    return [
      { id: "yandexgpt-lite/latest", provider: "yandexgpt", note: "быстрая и недорогая модель" },
      { id: "yandexgpt/latest", provider: "yandexgpt", note: "YandexGPT Pro, latest" },
      { id: "yandexgpt/rc", provider: "yandexgpt", note: "YandexGPT Pro, release candidate" },
    ];
  }

  if (provider === "gigachat") {
    return [
      { id: "GigaChat-2", provider: "gigachat", note: "основная модель" },
      { id: "GigaChat-2-Pro", provider: "gigachat", note: "повышенное качество" },
      { id: "GigaChat-2-Max", provider: "gigachat", note: "максимальное качество" },
      { id: "GigaChat", provider: "gigachat", note: "legacy/fallback" },
    ];
  }

  return listCodexModels();
}

async function listCodexModels() {
  const version = await getCommandVersion("codex", ["--version"]);
  const cacheFile = path.join(os.homedir(), ".codex", "models_cache.json");
  try {
    const cache = JSON.parse(await readFile(cacheFile, "utf8"));
    const models = (cache.models || [])
      .filter((model) => model?.slug && (model.visibility === "list" || model.visibility === undefined))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))
      .map((model) => ({
        id: model.slug,
        provider: "codex",
        note: `${model.display_name || model.slug} - ${version}`,
        priority: Number(model.priority || 0),
        contextWindow: model.context_window || model.max_context_window || null,
      }));
    if (models.length > 0) return models;
  } catch {
    // Fallback below covers fresh installs before Codex creates models_cache.json.
  }
  return [
    { id: "gpt-5.5", provider: "codex", note: version },
    { id: "gpt-5.4", provider: "codex", note: version },
    { id: "gpt-5.4-mini", provider: "codex", note: version },
    { id: "gpt-5.3-codex-spark", provider: "codex", note: version },
  ];
}

async function getApiProviderNetworkConfig(provider) {
  const config = await loadConfig();
  const profile = config.ai.profiles?.[provider] || DEFAULT_AI_CONFIG.ai.profiles[provider] || {};
  return {
    provider,
    ...profile,
    aiRelayBaseUrl: profile.aiRelayBaseUrl || config.api?.aiRelayBaseUrl || AI_RELAY_BASE_URL,
  };
}

function mapOpenAiModel(model) {
  const id = String(model.id || "");
  const created = Number(model.created || inferOpenAiModelCreated(id) || 0);
  return {
    id,
    provider: "openai",
    note: model.owned_by || "",
    created,
    releaseDate: formatUnixDate(created),
  };
}

function isOpenAiTextGenerationModel(model) {
  const id = String(model.id || "").toLocaleLowerCase("en-US");
  if (!id) return false;
  if (/^(babbage|davinci|text-|whisper|tts|dall-|omni-|computer-|codex-mini-latest)/.test(id)) return false;
  if (/(image|audio|tts|transcribe|realtime|embedding|moderation|search|instruct|safeguard)/.test(id)) return false;
  if (/^gpt-3\.5/.test(id)) return false;
  return id === "chat-latest"
    || /^gpt-(4|4o|5|5\.)/.test(id)
    || /^o[134](?:-|$)/.test(id);
}

function dedupeDatedOpenAiModels(models) {
  const ids = new Set(models.map((model) => model.id));
  return models.filter((model) => {
    const base = model.id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
    return base === model.id || !ids.has(base);
  });
}

function inferOpenAiModelCreated(id) {
  const match = String(id || "").match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const [, year, month, day] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000);
}

function mapOpenRouterModel(model) {
  const id = String(model.id || "");
  const architecture = model.architecture || {};
  const created = Number(model.created || 0);
  const developer = id.includes("/") ? id.split("/")[0] : "";
  return {
    id,
    provider: "openrouter",
    note: model.name || "",
    developer,
    created,
    releaseDate: formatUnixDate(created),
    modality: architecture.modality || "",
    inputModalities: Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [],
    outputModalities: Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [],
    contextLength: Number(model.context_length || model.top_provider?.context_length || 0),
  };
}

function isOpenRouterTextGenerationModel(model) {
  const inputs = model.inputModalities || [];
  const outputs = model.outputModalities || [];
  if (inputs.length > 0 && !inputs.includes("text")) return false;
  if (outputs.length > 0 && !outputs.includes("text")) return false;
  if (outputs.includes("image") || outputs.includes("audio") || outputs.includes("video")) return false;
  const id = String(model.id || "").toLocaleLowerCase("en-US");
  const note = String(model.note || "").toLocaleLowerCase("en-US");
  return !/\b(image|video|audio|tts|embed|embedding|rerank|moderation|safeguard)\b/.test(`${id} ${note}`);
}

function buildOpenRouterDeveloperChoices(models) {
  const byDeveloper = new Map();
  for (const model of models) {
    if (!model.developer) continue;
    const current = byDeveloper.get(model.developer) || { count: 0 };
    current.count += 1;
    byDeveloper.set(model.developer, current);
  }

  return MAIN_OPENROUTER_DEVELOPERS
    .map(([id, label]) => {
      const stat = byDeveloper.get(id);
      if (!stat) return null;
      return {
        id,
        label,
        count: stat.count,
      };
    })
    .filter(Boolean);
}

function sortModelsByFreshness(left, right) {
  return Number(right.created || 0) - Number(left.created || 0)
    || String(left.id).localeCompare(String(right.id));
}

function formatUnixDate(value) {
  const seconds = Number(value || 0);
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!number) return "";
  if (number >= 1_000_000) return `${Math.round(number / 100_000) / 10}M`;
  if (number >= 1_000) return `${Math.round(number / 100) / 10}K`;
  return String(number);
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
    mode: profile.provider === "codex"
      ? `sandbox=${profile.sandbox || "read-only"}, approval=${profile.approval || "never"}`
      : (profile.provider === "openai" || profile.provider === "openrouter" || profile.provider === "yandexgpt" || profile.provider === "gigachat" ? `network=${getAiNetworkMode(profile)}` : "-"),
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

  if (!["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер должен быть iola, ollama, yandexgpt, gigachat, openai, openrouter или codex.");
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
  if (!defaults) throw new Error(`Неизвестный AI-провайдер: ${provider}`);
  const profile = {
    ...defaults,
    provider,
    model: options.model || defaults.model,
  };

  if (options["base-url"]) {
    profile.baseUrl = options["base-url"];
  }
  if (options["network-mode"]) {
    profile.networkMode = validateAiNetworkMode(options["network-mode"]);
  }
  if (options["relay-url"]) {
    profile.aiRelayBaseUrl = options["relay-url"];
  }

  if (provider === "iola") {
    profile.runtime = options.runtime || defaults.runtime || "ollama";
    profile.baseUrl = options["base-url"] || defaults.baseUrl || "http://127.0.0.1:11434";
    profile.repo = options.repo || defaults.repo || IOLA_ROUTER_HF_REPO;
    profile.ggufRepo = options["gguf-repo"] || defaults.ggufRepo || IOLA_ROUTER_GGUF_REPO;
    profile.ggufFile = options["gguf-file"] || defaults.ggufFile || IOLA_ROUTER_GGUF_FILE;
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

  if (!["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"].includes(provider)) {
    throw new Error("Провайдер должен быть iola, ollama, yandexgpt, gigachat, openai, openrouter, codex или именем AI-профиля.");
  }

  const defaultModel = {
    iola: IOLA_LOCAL_MODEL,
    ollama: config.ai.provider === "ollama" ? config.ai.model : IOLA_LOCAL_OLLAMA_MODEL,
    yandexgpt: config.ai.provider === "yandexgpt" ? config.ai.model : "yandexgpt-lite/latest",
    gigachat: config.ai.provider === "gigachat" ? config.ai.model : "GigaChat-2",
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
  if (["ru", "rus", "russian", "российские", "российская", "россия", "яндекс", "yandex", "yandexgpt", "gigachat", "гигачат"].includes(normalized)) return normalized === "yandexgpt" || normalized === "яндекс" || normalized === "yandex" ? "yandexgpt" : normalized === "gigachat" || normalized === "гигачат" ? "gigachat" : "russian";
  if (["api", "апи"].includes(normalized)) return "api";
  if (normalized === "openai") return "openai";
  if (normalized === "openrouter" || normalized === "router") return "openrouter";
  if (["codex", "кодекс"].includes(normalized)) return "codex";
  return "";
}

async function chooseModelTarget() {
  const active = await getActiveAiSummary();
  console.log("Выберите AI-подключение:");
  console.log(`  1. Локальные модели${active.group === "local" ? " [выбрано]" : ""}`);
  console.log(`  2. Российские AI (YandexGPT/GigaChat)${active.group === "russian" ? " [выбрано]" : ""}`);
  console.log(`  3. API (OpenAI/OpenRouter)${active.group === "api" ? " [выбрано]" : ""}`);
  console.log(`  4. Codex CLI${active.group === "codex" ? " [выбрано]" : ""}`);
  console.log("  0. Отмена");

  const answer = await askText("Номер: ");
  return { 1: "local", 2: "russian", 3: "api", 4: "codex" }[answer.trim()] || "";
}

async function getActiveAiSummary() {
  const config = await loadConfig();
  const name = getActiveProfileName(config);
  const profile = config.ai.profiles?.[name] || {
    provider: config.ai.provider,
    model: config.ai.model,
  };
  const provider = profile.provider || "";
  const group = provider === "iola" || provider === "ollama"
    ? "local"
    : provider === "yandexgpt" || provider === "gigachat"
      ? "russian"
      : provider === "openai" || provider === "openrouter"
        ? "api"
        : provider === "codex"
          ? "codex"
          : "";
  return { name, provider, model: profile.model || "", group };
}

async function openModelTargetMenu(target) {
  if (target === "local") {
    const selection = await chooseLocalModel();
    if (selection?.model) await switchModelTarget(selection.provider, selection.model);
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

  if (target === "yandexgpt" || target === "gigachat") {
    const model = await chooseAiModel(target);
    if (model) await switchModelTarget(target, model);
    return;
  }

  if (target === "russian") {
    const provider = await chooseRussianProvider();
    if (!provider) return;
    const model = await chooseAiModel(provider);
    if (model) await switchModelTarget(provider, model);
    return;
  }

  const provider = await chooseApiProvider();
  if (!provider) return;
  const model = await chooseAiModel(provider);
  if (model) await switchModelTarget(provider, model);
}

async function chooseApiProvider() {
  const config = await loadConfig();
  const active = await getActiveAiSummary();
  const apiProfiles = Object.entries(config.ai.profiles || {})
    .filter(([, profile]) => profile.provider === "openai" || profile.provider === "openrouter")
    .map(([name, profile]) => ({ id: profile.provider, label: `${name}: ${profile.provider} (${profile.model || "-"})${active.provider === profile.provider ? " [выбрано]" : ""}` }));
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

async function chooseRussianProvider() {
  const config = await loadConfig();
  const active = await getActiveAiSummary();
  const russianProfiles = Object.entries(config.ai.profiles || {})
    .filter(([, profile]) => profile.provider === "yandexgpt" || profile.provider === "gigachat")
    .map(([name, profile]) => ({ id: profile.provider, label: `${name}: ${profile.provider} (${profile.model || "-"})${active.provider === profile.provider ? " [выбрано]" : ""}` }));
  const choices = [
    ...russianProfiles,
    { id: "yandexgpt", label: "YandexGPT API" },
    { id: "gigachat", label: "GigaChat API" },
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);

  console.log("Выберите российское AI-подключение:");
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

async function chooseLocalModel() {
  const active = await getActiveAiSummary();
  const models = await listAiModels("ollama");
  const choices = [
    { id: IOLA_LOCAL_MODEL, provider: "iola", label: `${IOLA_LOCAL_MODEL} - IOLA local router${active.provider === "iola" && active.model === IOLA_LOCAL_MODEL ? " [выбрано]" : ""}` },
    ...models
      .filter((model) => model.id !== IOLA_LOCAL_MODEL)
      .map((model) => ({
        id: model.id,
        provider: "ollama",
        label: `${model.id}${model.note ? ` - ${model.note}` : ""}${active.provider === "ollama" && active.model === model.id ? " [выбрано]" : ""}`,
      })),
    { id: "__manual__", provider: "ollama", label: "Другая Ollama-модель: ввести имя вручную" },
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);

  console.log("Выберите локальную модель:");
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice.label}`));
  console.log("  0. Отмена");

  const answer = Number(await askText("Номер: "));
  const selected = choices[answer - 1];
  if (!selected) return null;

  if (selected.id === "__manual__") {
    const model = (await askText("Имя Ollama-модели, например qwen3:4b: ")).trim();
    if (!model) return null;
    return { provider: "ollama", model };
  }

  return { provider: selected.provider, model: selected.id };
}

async function chooseAiModel(provider) {
  const active = await getActiveAiSummary();
  if (provider === "openrouter") {
    return chooseOpenRouterModel();
  }

  if (provider === "openai" || provider === "yandexgpt" || provider === "gigachat") {
    const ready = await ensureApiKeyForModelSelection(provider);
    if (!ready) return "";
  }

  let search = "";
  if (provider === "openai") {
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

  if (provider === "openai") {
    filtered = dedupeDatedOpenAiModels(filtered.filter(isOpenAiTextGenerationModel))
      .sort(sortModelsByFreshness);
  }

  if (filtered.length === 0) {
    console.log("Модели не найдены.");
    return "";
  }

  const limit = provider === "openai" ? 30 : 25;
  if (filtered.length > limit) {
    filtered = filtered.slice(0, limit);
    console.log(`Показаны первые ${limit} моделей.`);
  }

  console.log("Выберите модель:");
  filtered.forEach((model, index) => {
    const date = model.releaseDate ? ` (${model.releaseDate})` : "";
    const selected = active.provider === provider && active.model === model.id ? " [выбрано]" : "";
    console.log(`  ${index + 1}. ${model.id}${date}${model.note ? ` - ${model.note}` : ""}${selected}`);
  });
  console.log("  0. Отмена");

  const answer = Number(await askText("Номер: "));
  return filtered[answer - 1]?.id || "";
}

async function chooseOpenRouterModel() {
  const active = await getActiveAiSummary();
  const ready = await ensureApiKeyForModelSelection("openrouter");
  if (!ready) return "";

  let models;
  try {
    models = await listAiModels("openrouter");
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    return "";
  }

  const textModels = models.filter(isOpenRouterTextGenerationModel);
  if (textModels.length === 0) {
    console.log("Текстовые модели OpenRouter не найдены.");
    return "";
  }

  while (true) {
    const developerChoices = buildOpenRouterDeveloperChoices(textModels);
    console.log("Выберите разработчика моделей OpenRouter:");
    developerChoices.forEach((choice, index) => {
      console.log(`  ${index + 1}. ${choice.label} (${choice.count})`);
    });
    console.log("  0. Отмена");

    const developerAnswer = Number(await askText("Номер: "));
    if (!developerAnswer) return "";

    const selectedDeveloper = developerChoices[developerAnswer - 1];
    if (!selectedDeveloper) continue;
    const filtered = textModels
      .filter((model) => model.developer === selectedDeveloper.id)
      .sort(sortModelsByFreshness)
      .slice(0, 30);

    if (filtered.length === 0) {
      console.log("Модели не найдены.");
      continue;
    }

    console.log("Выберите текстовую модель:");
    filtered.forEach((model, index) => {
      const date = model.releaseDate || "дата неизвестна";
      const context = model.contextLength ? `, ctx ${formatCompactNumber(model.contextLength)}` : "";
      const selected = active.provider === "openrouter" && active.model === model.id ? " [выбрано]" : "";
      console.log(`  ${index + 1}. ${model.id} (${date}${context}) - ${model.note || model.id}${selected}`);
    });
    console.log("  0. Назад");

    const modelAnswer = Number(await askText("Номер: "));
    if (!modelAnswer) continue;
    return filtered[modelAnswer - 1]?.id || "";
  }
}

async function ensureApiKeyForModelSelection(provider) {
  if (!["openai", "openrouter", "yandexgpt", "gigachat"].includes(provider)) return true;
  if (await getApiKey(provider) && (provider !== "yandexgpt" || await getYandexFolderId())) return true;
  if (provider === "yandexgpt") {
    console.log("YandexGPT требует Yandex Cloud Connector: API key и folder ID.");
    if (!process.stdin.isTTY) return false;
    const ok = await askYesNo("Включить Yandex Cloud Connector сейчас? [y/N] ", false);
    if (!ok) {
      console.log("Возврат в меню выбора модели.");
      return false;
    }
    await setupYandexCloudConnector({});
    return Boolean(await getApiKey("yandexgpt") && await getYandexFolderId());
  }
  const label = {
    openai: "OpenAI",
    openrouter: "OpenRouter",
    yandexgpt: "YandexGPT",
    gigachat: "GigaChat",
  }[provider];
  console.log(`${label} API key не найден. Введите ключ, чтобы получить список моделей.`);
  try {
    await setAiKey(provider);
    return Boolean(await getApiKey(provider));
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function chooseAndSaveApiModel(provider) {
  const model = await chooseAiModel(provider);
  if (!model) {
    console.log("Модель не выбрана. Оставлена модель по умолчанию.");
    return;
  }
  await switchModelTarget(provider, model);
}

async function switchModelTarget(target, model) {
  const config = await loadConfig();
  const provider = target === "local" ? "iola" : target;
  if (provider === "iola") {
    await ensureIolaModelFresh({ model, quiet: false });
  }
  if (provider === "ollama") {
    const ready = await ensureOllamaModelAvailable(model, config);
    if (!ready) return;
  }
  const profileName = provider === "ollama" || provider === "iola" ? "local" : provider;
  const currentProfile = (provider === "ollama" || provider === "iola")
    ? buildProfileFromOptions(provider, { model })
    : (config.ai.profiles?.[profileName] || buildProfileFromOptions(provider, { model }));
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
  if (input.isRaw) input.setRawMode(false);
  input.resume();
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function askYesNo(question, defaultValue = false) {
  if (!process.stdin.isTTY) return Boolean(defaultValue);
  const answer = (await askText(question)).trim().toLocaleLowerCase("ru-RU");
  if (!answer) return Boolean(defaultValue);
  if (answer === "y" || answer === "yes" || answer === "д" || answer === "да") return true;
  if (answer === "n" || answer === "no" || answer === "н" || answer === "нет") return false;
  return Boolean(defaultValue);
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

  const envName = {
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    yandexgpt: "YANDEXGPT_API_KEY",
    gigachat: "GIGACHAT_AUTH_KEY",
  }[provider];
  const key = (await askText(`Введите ${envName}: `)).trim();

  if (!key) {
    throw new Error("Ключ пустой, сохранение отменено.");
  }

  const secrets = await loadSecrets();
  if (provider === "yandexgpt") {
    const folderId = (await askText("Введите YANDEXGPT_FOLDER_ID / ID каталога Yandex Cloud: ")).trim();
    if (!folderId) throw new Error("Folder ID пустой, сохранение отменено.");
    secrets[provider] = { apiKey: key, folderId };
  } else if (provider === "gigachat") {
    const scope = (await askText("Scope [GIGACHAT_API_PERS]: ")).trim() || "GIGACHAT_API_PERS";
    secrets[provider] = { apiKey: key, scope };
  } else {
    secrets[provider] = { apiKey: key };
  }
  await saveSecrets(secrets);
  console.log(`Ключ ${provider} сохранен локально: ${SECRETS_FILE}`);
}

async function printAiKeyStatus() {
  const secrets = await loadSecrets();
  const rows = ["yandexgpt", "gigachat", "openai", "openrouter"].map((provider) => {
    const env = {
      openai: process.env.OPENAI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      yandexgpt: process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY,
      gigachat: process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_API_KEY,
    }[provider];
    return {
      provider,
      env: env ? "yes" : "no",
      local: secrets[provider]?.apiKey ? "yes" : "no",
      extra: provider === "yandexgpt"
        ? ((process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID || secrets.yandexgpt?.folderId) ? "folder ok" : "folder missing")
        : (provider === "gigachat" && secrets.gigachat?.scope ? `scope ${secrets.gigachat.scope}` : ""),
    };
  });

  printTable(rows, [
    ["provider", "Провайдер"],
    ["env", "Env"],
    ["local", "Локально"],
    ["extra", "Дополнительно"],
  ]);
}

async function deleteAiKey(provider) {
  assertKeyProvider(provider);
  const secrets = await loadSecrets();
  delete secrets[provider];
  await saveSecrets(secrets);
  console.log(`Локальный ключ ${provider} удален.`);
}

async function handleGeo(args) {
  const [command, subcommand, ...rest] = args;

  if (command === "key") {
    await handleGeoKey([subcommand, ...rest]);
    return;
  }

  if (command === "geocode") {
    await geoGeocode([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "nearby") {
    await geoNearby([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "distance") {
    await geoDistance([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "map-link") {
    await geoMapLink([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "resolve") {
    await geoResolve([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "route-context") {
    await geoRouteContext([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "services") {
    await geoServices([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "doctor" || command === "status") {
    await printGeoKeyStatus({ check: command === "doctor" });
    return;
  }

  throw new Error(`Команды geo:
  iola geo key set yandex
  iola geo key status
  iola geo key doctor
  iola geo key delete yandex
  iola geo geocode "Йошкар-Ола, ул. Петрова, 15"
  iola geo nearby "Йошкар-Ола, ул. Петрова, 15" --dataset all --limit 5
  iola geo distance --from "Йошкар-Ола, ул. Петрова, 15" --to "школа 7"
  iola geo map-link "школа 7"
  iola geo resolve "садик золотой петушок"
  iola geo route-context "школа 7"
  iola geo services "Йошкар-Ола, ул. Петрова, 15"`);
}

async function handleGeoKey(args) {
  const [action, provider = "yandex"] = args;
  if (provider !== "yandex") {
    throw new Error("Сейчас поддерживается только провайдер: yandex");
  }

  if (action === "set") {
    await setYandexGeocoderKey();
    return;
  }

  if (action === "status") {
    await printGeoKeyStatus();
    return;
  }

  if (action === "doctor" || action === "check") {
    await printGeoKeyStatus({ check: true });
    return;
  }

  if (action === "delete") {
    const secrets = await loadSecrets();
    delete secrets.yandexGeocoder;
    await saveSecrets(secrets);
    console.log("Локальный ключ yandex geocoder удален.");
    return;
  }

  throw new Error("Команды geo key: set yandex, status, doctor, delete yandex.");
}

async function setYandexGeocoderKey() {
  if (!process.stdin.isTTY) {
    throw new Error("Для сохранения ключа запустите команду в интерактивном терминале.");
  }

  const key = (await askText("Введите YANDEX_GEOCODER_API_KEY: ")).trim();
  if (!key) throw new Error("Ключ пустой, сохранение отменено.");

  const secrets = await loadSecrets();
  secrets.yandexGeocoder = { apiKey: key };
  await saveSecrets(secrets);
  console.log(`Ключ yandex geocoder сохранен локально: ${SECRETS_FILE}`);

  const shouldCheck = await confirm("Проверить ключ запросом к Yandex Geocoder? [Y/n] ");
  if (shouldCheck) await checkYandexGeocoderKey({ print: true });
}

async function printGeoKeyStatus(options = {}) {
  const key = await getYandexGeocoderKey();
  const rows = [{
    provider: "yandex-geocoder",
    env: (process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY) ? "yes" : "no",
    local: (await loadSecrets()).yandexGeocoder?.apiKey ? "yes" : "no",
    status: key ? "configured" : "missing",
  }];
  printTable(rows, [
    ["provider", "Провайдер"],
    ["env", "Env"],
    ["local", "Локально"],
    ["status", "Статус"],
  ]);
  if (options.check) await checkYandexGeocoderKey({ print: true });
}

async function geoGeocode(args) {
  const query = args.join(" ").trim();
  if (!query) throw new Error('Адрес обязателен. Пример: iola geo geocode "Йошкар-Ола, ул. Петрова, 15"');
  const result = await callYandexGeocoder(query);
  if (!result) {
    console.log("Yandex Geocoder не вернул результат.");
    return;
  }
  printKeyValue(result);
}

async function geoNearby(args) {
  const options = parseOptions(args);
  const query = options._.join(" ").trim();
  if (!query) throw new Error('Адрес обязателен. Пример: iola geo nearby "Йошкар-Ола, ул. Петрова, 15" --dataset schools');
  const answer = await buildNearbyAnswer(query, {
    dataset: normalizeGeoDataset(options.dataset || inferGeoDataset(query)),
    limit: Number(options.limit || 5),
    radius: Number(options.radius || 0),
  });
  console.log(answer);
}

async function geoDistance(args) {
  const options = parseOptions(args);
  const from = options.from || options.address || options._.join(" ").split(/\s+(?:до|и|->)\s+/iu)[0]?.trim();
  const to = options.to || options._.join(" ").split(/\s+(?:до|и|->)\s+/iu)[1]?.trim();
  if (!from || !to) throw new Error('Нужны две точки. Пример: iola geo distance --from "Петрова 15" --to "школа 7"');
  const answer = await buildDistanceAnswer(from, to);
  console.log(answer);
}

async function geoMapLink(args) {
  const query = args.join(" ").trim();
  if (!query) throw new Error('Объект или адрес обязателен. Пример: iola geo map-link "школа 7"');
  const answer = await buildMapLinkAnswer(query);
  console.log(answer);
}

async function geoResolve(args) {
  const query = args.join(" ").trim();
  if (!query) throw new Error('Место или объект обязателен. Пример: iola geo resolve "садик золотой петушок"');
  const answer = await buildPlaceResolverAnswer(query);
  console.log(answer);
}

async function geoRouteContext(args) {
  const query = args.join(" ").trim();
  if (!query) throw new Error('Объект или адрес обязателен. Пример: iola geo route-context "школа 7"');
  const answer = await buildRouteContextAnswer(query);
  console.log(answer);
}

async function geoServices(args) {
  const options = parseOptions(args);
  const query = options._.join(" ").trim();
  if (!query) throw new Error('Адрес обязателен. Пример: iola geo services "Йошкар-Ола, ул. Петрова, 15"');
  const answer = await buildAddressToServicesAnswer(query, { limit: Number(options.limit || 3) });
  console.log(answer);
}

async function checkYandexGeocoderKey(options = {}) {
  try {
    const result = await callYandexGeocoder("Йошкар-Ола");
    if (!result?.coordinates) throw new Error("Yandex Geocoder вернул пустой результат.");
    if (options.print) {
      console.log(`Yandex Geocoder: ok (${result.name || result.address || result.coordinates})`);
    }
    return true;
  } catch (error) {
    if (options.print) {
      console.log(`Yandex Geocoder: error - ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

async function callYandexGeocoder(query) {
  const apiKey = await getYandexGeocoderKey();
  if (!apiKey) {
    throw new Error("Yandex Geocoder API key не найден. Выполните iola geo key set yandex или задайте YANDEX_GEOCODER_API_KEY.");
  }

  const url = new URL("https://geocode-maps.yandex.ru/v1/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("geocode", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "ru_RU");
  url.searchParams.set("results", "1");

  const response = await fetchYandexGeocoderWithRetry(url);

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 403 && /Invalid api key/i.test(text)) {
      throw new Error(`Yandex Geocoder request failed: ${response.status} ${response.statusText}\nInvalid api key. Если ключ только что создан, подождите до 15 минут: Yandex указывает, что активация ключа может занять до 15 минут.`);
    }
    throw new Error(`Yandex Geocoder request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, apiKey)}`);
  }

  const payload = await response.json();
  const member = payload?.response?.GeoObjectCollection?.featureMember?.[0];
  const object = member?.GeoObject;
  if (!object) return null;
  const point = object.Point?.pos || "";
  const [lon, lat] = point.split(/\s+/);
  return {
    name: object.name || "",
    address: object.metaDataProperty?.GeocoderMetaData?.text || object.description || "",
    precision: object.metaDataProperty?.GeocoderMetaData?.precision || "",
    coordinates: lat && lon ? `${lat}, ${lon}` : point,
    map: lat && lon ? `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map` : "",
  };
}

async function fetchYandexGeocoderWithRetry(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (response.status !== 429 || attempt === 2) return response;
      await sleep(700 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(formatProviderFetchError("Yandex Geocoder", lastError));
}

const geoMemoryCache = new Map();

async function buildGeoDirectAnswer(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  if (!isGeoQuestion(normalized)) return "";
  const place = detectEducationPlace(question);
  if (place && !place.supported && /(школ|сош|лице|гимнази|сад|детсад|детск\w*\s+сад|садик)/iu.test(normalized)) {
    return formatUnsupportedEducationGeoPlace(place);
  }

  try {
    if (/(расстояни|как далеко|далеко ли|ближе)/iu.test(normalized)) {
      const pair = extractDistancePair(question);
      if (pair.from && pair.to) return buildDistanceAnswer(pair.from, pair.to);
    }

    if (/(карт[аеу]|ссылк.*карт|открыть.*карт)/iu.test(normalized)) {
      const query = cleanupGeoObjectQuery(question);
      if (query) return buildMapLinkAnswer(query);
    }

    if (/(где находится|как пройти|как добраться|что рядом|ориентир)/iu.test(normalized)) {
      const query = cleanupGeoObjectQuery(question);
      if (query) return buildRouteContextAnswer(query);
    }

    if (/(мой адрес|живу|по адресу)/iu.test(normalized)) {
      const address = extractAddressForNearby(question);
      if (address) return buildAddressToServicesAnswer(address, { limit: 3 });
    }

    if (/(рядом|поблизости|ближайш|ближе|около|возле)/iu.test(normalized)) {
      const address = extractAddressForNearby(question);
      if (address) return buildNearbyAnswer(address, { dataset: normalizeGeoDataset(inferGeoDataset(question)), limit: 5 });
    }

    if (/(уточни место|какой населенный пункт|какой район|фильтр.*район|фильтр.*населен|не путай.*населен)/iu.test(normalized)) {
      const query = cleanupGeoObjectQuery(question);
      if (query) return buildPlaceResolverAnswer(query);
    }
  } catch (error) {
    if (/Yandex Geocoder API key не найден/iu.test(String(error?.message || ""))) return "";
    return `Не смог выполнить geo-запрос: ${error instanceof Error ? error.message : String(error)}`;
  }

  return "";
}

function formatUnsupportedEducationGeoPlace(place) {
  return `В текущих открытых данных iola-cli есть данные городского округа Йошкар-Ола. Данных по ${place.locative || place.label} в подключенных слоях нет, поэтому не могу надежно ответить по этому объекту.`;
}

function isGeoQuestion(normalized) {
  return /(рядом|поблизости|ближайш|ближе|расстояни|как далеко|карт[аеу]|где находится|как пройти|как добраться|мой адрес|живу|по адресу|ориентир|уточни место|какой населенный пункт|какой район|фильтр.*район|фильтр.*населен)/iu.test(normalized);
}

async function buildNearbyAnswer(address, options = {}) {
  const origin = await resolveGeoPoint(address);
  const dataset = normalizeGeoDataset(options.dataset || "all");
  const limit = Math.max(1, Number(options.limit || 5));
  const radius = Number(options.radius || 0);
  const candidates = await getGeoCandidates(dataset);
  const ranked = (await asyncMapLimit(candidates, 6, async (item) => {
    const point = item.address
      ? await geocodeCached(normalizeAddressForGeocoder(item.address)).catch(() => null)
      : await resolveGeoPoint(item.name).catch(() => null);
    if (!point?.lat || !point?.lon) return null;
    const distanceMeters = haversineMeters(origin, point);
    return { ...item, point, distanceMeters };
  })).filter(Boolean)
    .filter((item) => !radius || item.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);

  if (ranked.length === 0) return `Рядом с адресом "${address}" не нашел объектов в подключенных слоях.`;

  return [
    `Ближайшие объекты к адресу: ${origin.address || address}`,
    ...ranked.map((item, index) => `${index + 1}. ${item.name} — ${formatDistance(item.distanceMeters)}${item.address ? `\n   Адрес: ${item.address}` : ""}${item.inn ? `\n   ИНН: ${item.inn}` : ""}${item.point.map ? `\n   Карта: ${item.point.map}` : ""}`),
    `Источник: Yandex Geocoder + слои ${dataset === "all" ? "schools, kindergartens" : dataset}.`,
  ].join("\n");
}

async function buildDistanceAnswer(fromQuery, toQuery) {
  const from = await resolveGeoPoint(fromQuery);
  const to = await resolveGeoPoint(toQuery);
  const distance = haversineMeters(from, to);
  return [
    `Расстояние по прямой: ${formatDistance(distance)}.`,
    `От: ${from.name || from.address || fromQuery}${from.address && from.address !== from.name ? ` (${from.address})` : ""}`,
    `До: ${to.name || to.address || toQuery}${to.address && to.address !== to.name ? ` (${to.address})` : ""}`,
    to.map ? `Карта точки назначения: ${to.map}` : "",
    "Это расстояние по координатам, не маршрут по дорогам.",
  ].filter(Boolean).join("\n");
}

async function buildMapLinkAnswer(query) {
  const point = await resolveGeoPoint(query);
  return [
    point.name || query,
    point.address ? `Адрес: ${point.address}` : "",
    point.coordinates ? `Координаты: ${point.coordinates}` : "",
    point.map ? `Карта: ${point.map}` : "",
  ].filter(Boolean).join("\n");
}

async function buildPlaceResolverAnswer(query) {
  const match = await resolveGeoEntity(query).catch(() => null);
  if (match) {
    return [
      `Нашел объект: ${match.name}`,
      match.address ? `Адрес: ${match.address}` : "",
      match.inn ? `ИНН: ${match.inn}` : "",
      match.layer ? `Слой: ${match.layer}` : "",
      match.map ? `Карта: ${match.map}` : "",
    ].filter(Boolean).join("\n");
  }
  const point = await callYandexGeocoder(query);
  if (!point) return `Не смог уточнить место: ${query}`;
  return [
    `Уточнил место через геокодер: ${point.name || query}`,
    point.address ? `Адрес: ${point.address}` : "",
    point.precision ? `Точность: ${point.precision}` : "",
    point.coordinates ? `Координаты: ${point.coordinates}` : "",
    point.map ? `Карта: ${point.map}` : "",
  ].filter(Boolean).join("\n");
}

async function buildRouteContextAnswer(query) {
  const point = await resolveGeoPoint(query);
  const nearby = await buildNearbyAnswer(point.address || query, { dataset: "all", limit: 3 });
  return [
    `${point.name || query}`,
    point.address ? `Адрес: ${point.address}` : "",
    point.coordinates ? `Координаты: ${point.coordinates}` : "",
    point.map ? `Карта: ${point.map}` : "",
    "",
    nearby,
  ].filter(Boolean).join("\n");
}

async function buildAddressToServicesAnswer(address, options = {}) {
  const limit = Math.max(1, Number(options.limit || 3));
  const schools = await buildNearbyAnswer(address, { dataset: "schools", limit });
  const kindergartens = await buildNearbyAnswer(address, { dataset: "kindergartens", limit });
  return [
    `По адресу "${address}" ближайшие подключенные городские объекты:`,
    "",
    "Школы:",
    stripNearbyHeader(schools),
    "",
    "Детские сады:",
    stripNearbyHeader(kindergartens),
  ].join("\n");
}

function stripNearbyHeader(text) {
  return String(text || "").split("\n").filter((line) => !line.startsWith("Ближайшие объекты к адресу:")).join("\n");
}

async function resolveGeoPoint(query) {
  const entity = await resolveGeoEntity(query).catch(() => null);
  if (entity?.address) {
    const point = await geocodeCached(normalizeAddressForGeocoder(entity.address));
    return mergeGeoEntityPoint(entity, point);
  }
  return geocodeCached(query);
}

async function resolveGeoEntity(query) {
  const dataset = normalizeGeoDataset(inferGeoDataset(query));
  let candidates = await getGeoCandidates(dataset);
  const normalized = normalizeGeoText(query);
  const number = extractEntityNumberFromQuestion(query, dataset === "kindergartens" ? "kindergartens" : "schools");
  const place = detectEducationPlace(query);
  if (place && !place.supported) return null;
  if (place?.supported) {
    const placeMatches = candidates.filter((item) => geoItemMatchesPlace(item, place));
    if (placeMatches.length > 0) candidates = placeMatches;
  }
  if (number) {
    const exactNumberMatches = candidates.filter((item) => itemNameHasNumber(item, number));
    if (exactNumberMatches.length === 1) {
      const point = exactNumberMatches[0].address ? await geocodeCached(normalizeAddressForGeocoder(exactNumberMatches[0].address)).catch(() => null) : null;
      return mergeGeoEntityPoint(exactNumberMatches[0], point);
    }
    if (exactNumberMatches.length > 1) {
      const scoped = place?.supported
        ? exactNumberMatches.filter((item) => geoItemMatchesPlace(item, place))
        : exactNumberMatches;
      const bestExact = scoped[0] || exactNumberMatches[0];
      const point = bestExact.address ? await geocodeCached(normalizeAddressForGeocoder(bestExact.address)).catch(() => null) : null;
      return mergeGeoEntityPoint(bestExact, point);
    }
  }
  const scored = candidates.map((item) => ({ ...item, score: scoreGeoCandidate(item, normalized, number, place) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const point = best.address ? await geocodeCached(normalizeAddressForGeocoder(best.address)).catch(() => null) : null;
  return mergeGeoEntityPoint(best, point);
}

function mergeGeoEntityPoint(entity, point) {
  if (!point) return entity;
  return {
    ...entity,
    geoName: point.name || "",
    geocodedAddress: point.address || "",
    precision: point.precision || "",
    coordinates: point.coordinates || "",
    map: point.map || "",
    lat: point.lat,
    lon: point.lon,
  };
}

function scoreGeoCandidate(item, normalizedQuery, number, place) {
  const name = normalizeGeoText(item.name);
  const address = normalizeGeoText(item.address);
  let score = 0;
  if (number && itemNameHasNumber(item, number)) score += 20;
  for (const token of normalizeGeoText(normalizedQuery).split(/\s+/).filter((part) => part.length >= 3)) {
    if (name.includes(token)) score += 3;
    if (address.includes(token)) score += 1;
  }
  if (place?.supported && geoItemMatchesPlace(item, place)) score += 8;
  if (/(сад|детсад|садик)/iu.test(normalizedQuery) && item.layer === "kindergartens") score += 5;
  if (/(школ|лице|гимнази)/iu.test(normalizedQuery) && item.layer === "schools") score += 5;
  return score;
}

function geoItemMatchesPlace(item, place) {
  if (!place?.supported) return false;
  const haystack = normalizeGeoText(`${item.name || ""} ${item.address || ""}`);
  const aliases = [place.label, ...(place.aliases || [])].map(normalizeGeoText).filter(Boolean);
  return aliases.some((alias) => haystack.includes(alias));
}

async function getGeoCandidates(dataset = "all") {
  const layers = dataset === "all" ? ["schools", "kindergartens"] : [dataset];
  const result = [];
  for (const layer of layers) {
    const items = normalizeItems(await fetchAllApiItems(`${await getApiBaseUrl()}/${DATASETS[layer].endpoint}`))
      .map(selectPublicSummary)
      .filter((item) => item.name || item.address)
      .map((item) => ({ ...item, layer }));
    result.push(...items);
  }
  return result;
}

async function geocodeCached(query) {
  const key = normalizeGeoText(query);
  if (geoMemoryCache.has(key)) return geoMemoryCache.get(key);
  const value = await callYandexGeocoder(query);
  if (!value) throw new Error(`Yandex Geocoder не вернул результат для: ${query}`);
  const parsed = parseCoordinates(value.coordinates);
  const point = { ...value, ...parsed };
  geoMemoryCache.set(key, point);
  return point;
}

function parseCoordinates(coordinates) {
  const [lat, lon] = String(coordinates || "").split(",").map((part) => Number(part.trim()));
  return { lat, lon };
}

async function asyncMapLimit(items, limit, mapper) {
  const source = Array.from(items || []);
  if (source.length === 0) return [];
  const results = new Array(source.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, source.length)) }, async () => {
    while (next < source.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(source[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = toRadians(Number(b.lat) - Number(a.lat));
  const deltaLon = toRadians(Number(b.lon) - Number(a.lon));
  const x = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "-";
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} км`;
}

function normalizeGeoDataset(value) {
  const text = String(value || "").toLocaleLowerCase("ru-RU");
  if (text === "schools" || /школ|лице|гимнази/.test(text)) return "schools";
  if (text === "kindergartens" || /сад|детсад|садик/.test(text)) return "kindergartens";
  return "all";
}

function inferGeoDataset(text) {
  const normalized = String(text || "").toLocaleLowerCase("ru-RU");
  if (/(сад|детсад|садик)/iu.test(normalized)) return "kindergartens";
  if (/(школ|лице|гимнази)/iu.test(normalized)) return "schools";
  return "all";
}

function extractAddressForNearby(question) {
  const text = String(question || "").trim();
  const match = text.match(/(?:рядом с|рядом|около|возле|поблизости от|живу на|мой адрес|по адресу)\s+(.+)/iu);
  if (match?.[1]) return cleanupGeoAddress(match[1].split(/[,;]\s*(?:какие|что|где|кто|дай|покажи)/iu)[0]);
  return cleanupGeoAddress(text);
}

function extractDistancePair(question) {
  const text = String(question || "").trim();
  const explicit = {
    from: text.match(/(?:от|from)\s+(.+?)\s+(?:до|к|to)\s+(.+)/iu)?.[1],
    to: text.match(/(?:от|from)\s+(.+?)\s+(?:до|к|to)\s+(.+)/iu)?.[2],
  };
  if (explicit.from && explicit.to) return { from: cleanupGeoAddress(explicit.from), to: cleanupGeoAddress(explicit.to) };
  const parts = text.split(/\s+(?:и|до|->)\s+/iu).map(cleanupGeoAddress).filter(Boolean);
  return { from: parts[0] || "", to: parts[1] || "" };
}

function cleanupGeoObjectQuery(text) {
  return cleanupGeoAddress(String(text || "")
    .replace(/^(?:где находится|как пройти|как добраться|покажи|дай|открой|найди|ссылку на карту|ссылка на карту)\s+/iu, "")
    .replace(/\b(?:на карте|карту|карта|рядом|что рядом|ориентиры?)\b/giu, ""));
}

function cleanupGeoAddress(text) {
  return String(text || "")
    .replace(/[?.!]+$/u, "")
    .replace(/(^|\s)улице(?=\s|$)/giu, "$1улица")
    .replace(/\b(?:какие|какой|какая|есть|ближайшие|ближайший|школы|школа|детские сады|детский сад|садики|садик|объекты|городские|учреждения|рядом|поблизости)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressForGeocoder(address) {
  const source = String(address || "").trim();
  if (!source) return source;
  let text = source
    .replace(/^\s*\d{6},?\s*/u, "")
    .replace(/\bРоссия,\s*/iu, "")
    .replace(/\bРоссийская Федерация,\s*/iu, "")
    .replace(/\bРеспублика Марий Эл,\s*/iu, "")
    .replace(/\bгородской округ\s+город\s+Йошкар-Ола,\s*/iu, "")
    .replace(/\bГОРОД ЙОШКАР-ОЛА,\s*/iu, "")
    .replace(/\bЙошкар-Ола\s+г,\s*/iu, "")
    .replace(/\bгород\s+Йошкар-Ола,\s*/iu, "Йошкар-Ола, ")
    .replace(/\bсело\s+Сем[её]новка,\s*/iu, "Йошкар-Ола, Семёновка, ")
    .replace(/\bдом\s+/giu, "д. ")
    .replace(/\bулица\s+/giu, "ул. ")
    .replace(/([А-ЯЁ])\.(?=[А-ЯЁ])/gu, "$1. ")
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
  if (!/(йошкар|сем[её]новк)/iu.test(text)) text = `Йошкар-Ола, ${text}`;
  return text;
}

function normalizeGeoText(text) {
  return String(text || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function getYandexGeocoderKey() {
  if (process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY) {
    return process.env.YANDEX_GEOCODER_API_KEY || process.env.YANDEX_MAPS_API_KEY;
  }
  const secrets = await loadSecrets();
  return secrets.yandexCloud?.geocoderApiKey || secrets.yandexGeocoder?.apiKey || "";
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

async function upsertCronJob(scheduleText, command, options = {}) {
  initDatabase();
  const db = openDatabase();
  try {
    const existing = db.prepare("SELECT id FROM cron_jobs WHERE command = ? ORDER BY id DESC LIMIT 1").get(command);
    if (existing?.id) {
      db.prepare("UPDATE cron_jobs SET schedule_text = ?, enabled = 1 WHERE id = ?").run(scheduleText, existing.id);
      return Number(existing.id);
    }
    if (options.replaceCommand) {
      db.prepare("DELETE FROM cron_jobs WHERE command = ?").run(command);
    }
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

function deleteCronJobsByCommand(command) {
  initDatabase();
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM cron_jobs WHERE command = ?").run(command);
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
  const everyDays = normalized.match(/кажд(?:ые|ую)\s+(\d+)\s*(?:дн|день|дня|дней)/u) || normalized.match(/every\s+(\d+)\s*(?:d|day|days)/u);
  if (everyDays) {
    return !lastRun || now.getTime() - lastRun.getTime() >= Number(everyDays[1]) * 24 * 60 * 60 * 1000;
  }
  if (normalized.includes("каждый день") || normalized.includes("daily")) {
    const time = normalized.match(/(\d{1,2}):(\d{2})/u);
    if (time) {
      const dueAt = new Date(now);
      dueAt.setHours(Number(time[1]), Number(time[2]), 0, 0);
      const ranToday = lastRun && lastRun.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
      return now >= dueAt && !ranToday;
    }
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
  if (!["openai", "openrouter", "yandexgpt", "gigachat"].includes(provider)) {
    throw new Error("Провайдер должен быть yandexgpt, gigachat, openai или openrouter.");
  }
}

async function chooseAiProvider() {
  console.log("Выберите режим AI:");
  console.log("1. Локальная модель IOLA");
  console.log("2. Ollama");
  console.log("3. YandexGPT API");
  console.log("4. GigaChat API");
  console.log("5. OpenAI API");
  console.log("6. OpenRouter API");
  console.log("7. Codex/MCP");

  const answer = (await askText("Введите номер [1]: ")).trim() || "1";
  return {
    1: "iola",
    2: "ollama",
    3: "yandexgpt",
    4: "gigachat",
    5: "openai",
    6: "openrouter",
    7: "codex",
  }[answer] || "iola";
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
  const ggufRepo = options["gguf-repo"] || IOLA_ROUTER_GGUF_REPO;
  const ggufFile = options["gguf-file"] || IOLA_ROUTER_GGUF_FILE;
  const modelDir = options["model-dir"] || IOLA_MODEL_DIR;
  const profileName = options.name || "local";
  const optional = Boolean(options.optional);
  const runtime = options.runtime || "ollama";
  const model = options.model || IOLA_LOCAL_MODEL;

  if (optional && process.env.CI === "true") {
    return;
  }

  try {
    await ensureIolaModelFresh({
      runtime,
      repo,
      ggufRepo,
      ggufFile,
      modelDir,
      model,
      force: Boolean(options.force),
      quiet: Boolean(options.quiet),
    });
  } catch (error) {
    if (!optional) throw error;
    console.warn(`IOLA local model не установлена: ${error instanceof Error ? error.message : String(error)}`);
  }

  const config = await loadConfig();
  const localProfile = {
    provider: "iola",
    model,
    runtime,
    baseUrl: "http://127.0.0.1:11434",
    repo,
    ggufRepo,
    ggufFile,
    modelDir,
  };
  const shouldActivate = !options["preserve-active"];
  const previousActiveProfile = getActiveProfileName(config);
  const nextActiveProfile = shouldActivate ? profileName : previousActiveProfile;
  const nextActiveConfig = nextActiveProfile === profileName
    ? localProfile
    : (config.ai.profiles?.[nextActiveProfile] || config.ai.profiles?.[previousActiveProfile] || localProfile);
  await saveConfig({
    ai: {
      ...config.ai,
      activeProfile: nextActiveProfile,
      provider: nextActiveConfig.provider,
      model: nextActiveConfig.model,
      baseUrl: nextActiveConfig.baseUrl || config.ai.baseUrl,
      profiles: {
        ...(config.ai.profiles || {}),
        [profileName]: localProfile,
      },
    },
  });

  if (options.quiet) return;
  console.log("");
  console.log("IOLA local mode готов:");
  console.log(`  runtime: ${runtime === "transformers" ? "Python transformers/peft" : "Ollama GGUF"}`);
  console.log(`  model: ${model}`);
  console.log(`  Hugging Face: ${runtime === "transformers" ? repo : ggufRepo}`);
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
  const casualAnswer = buildCasualDirectAnswer(question);
  if (casualAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: casualAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, casualAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: casualAnswer.length, sessionId, direct: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, casualAnswer, "utf8");
    }
    if (!options.quiet) console.log(casualAnswer);
    return casualAnswer;
  }
  const userSkillAnswer = await buildUserSkillDirectAnswer(question);
  if (userSkillAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: userSkillAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, userSkillAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: userSkillAnswer.length, sessionId, direct: true, skill: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, userSkillAnswer, "utf8");
    }
    if (!options.quiet) console.log(userSkillAnswer);
    return userSkillAnswer;
  }
  if (/(контакт|адресн)/iu.test(question) && !isExplicitYandexDiskPathDelete(question)) {
    const yandexContactAnswer = await buildYandexDirectAnswer(question, context.history || history);
    if (yandexContactAnswer) {
      if (historyEnabled) {
        recordAskHistory({ question, answer: yandexContactAnswer, providerConfig, dataContext, error: "", sessionId });
        appendSessionExchange(sessionId, question, yandexContactAnswer, dataContext, "");
      }
      emitEvent(options, "answer", { length: yandexContactAnswer.length, sessionId, direct: true, yandex: true });
      if (options.output) {
        await assertPermission("writeFiles");
        await writeFile(options.output, yandexContactAnswer, "utf8");
      }
      if (!options.quiet) console.log(yandexContactAnswer);
      return yandexContactAnswer;
    }
  }
  const cloudAnswer = await buildCloudDirectAnswer(question);
  if (cloudAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: cloudAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, cloudAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: cloudAnswer.length, sessionId, direct: true, cloud: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, cloudAnswer, "utf8");
    }
    if (!options.quiet) console.log(cloudAnswer);
    return cloudAnswer;
  }
  const yandexAnswer = await buildYandexDirectAnswer(question, context.history || history);
  if (yandexAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: yandexAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, yandexAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: yandexAnswer.length, sessionId, direct: true, yandex: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, yandexAnswer, "utf8");
    }
    if (!options.quiet) console.log(yandexAnswer);
    return yandexAnswer;
  }
  const geoAnswer = await buildGeoDirectAnswer(question);
  if (geoAnswer) {
    if (historyEnabled) {
      recordAskHistory({ question, answer: geoAnswer, providerConfig, dataContext, error: "", sessionId });
      appendSessionExchange(sessionId, question, geoAnswer, dataContext, "");
    }
    emitEvent(options, "answer", { length: geoAnswer.length, sessionId, direct: true, geo: true });
    if (options.output) {
      await assertPermission("writeFiles");
      await writeFile(options.output, geoAnswer, "utf8");
    }
    if (!options.quiet) console.log(geoAnswer);
    return geoAnswer;
  }
  const directAnswer = await buildDirectDataAnswer(question, dataContext);
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

  if (!options.quiet) printAiAnswer(answer);
  return answer;
}

async function buildDirectDataAnswer(question, dataContext) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  const requestedFields = detectDirectDataFields(normalized);
  if (requestedFields.length === 0) return "";
  const educationAnswer = await buildDeterministicEducationAnswer(question, requestedFields);
  if (educationAnswer) return educationAnswer;
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

async function buildYandexDirectAnswer(question, history = []) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  const previousAssistantText = [...(history || [])].reverse().find((item) => item.role === "assistant")?.content || "";
  const mailContext = /Яндекс Почта|Письмо #|\bUID\b|#\d{3,}/iu.test(previousAssistantText);
  const mailFollowup = mailContext && isYandexMailFollowupQuestion(normalized, question);
  if (!isYandexServiceQuestion(normalized) && !mailFollowup) return "";
  try {
    if (mailFollowup && (isYandexMailReadRequest(normalized) || isYandexMailSelectionQuestion(question))) {
      const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText)
        || await getLatestYandexMailUid({ unread: /непрочитан/iu.test(normalized) });
      const row = await yandexMailRead(uid);
      if (!row || row.status === "not-found") return `Письмо #${uid} не найдено.`;
      return formatYandexMailRead(row);
    }

    if (isYandexIdentityQuestion(normalized)) {
      const profile = await getYandexIdentityProfile();
      return [
        "Подключен Yandex ID:",
        `Логин: ${profile.login || "-"}`,
        `Имя: ${profile.displayName || "-"}`,
        `Email: ${profile.defaultEmail || "-"}`,
      ].join("\n");
    }

    if (/(яндекс\s*go|яндекс\s*го|такси|deeplink|диплинк|ссылк.*маршрут)/iu.test(normalized)
      && /(маршрут|ссылк|откуда|куда|поездк|такси|от\s+.+\s+до\s+)/iu.test(normalized)) {
      const route = extractYandexGoRouteFromText(question);
      if (!route.from || !route.to) {
        return 'Для ссылки Яндекс Go нужны два адреса. Пример: "такси от Медведево, Школьная 15 до Медведево, Советская 20".';
      }
      await ensureYandexGoGeocoderReady();
      const result = await buildYandexGoDeeplinkFromOptions({ from: route.from, to: route.to, tariff: route.tariff });
      return formatYandexGoDeeplinkResult(result);
    }

    if (/(дайджест|сводк)/iu.test(normalized) && /(яндекс|почт|календар|контакт|диск)/iu.test(normalized)) {
      if (/(включ|запусти|начни|поставь|создай)/iu.test(normalized) && /(кажд|ежеднев|авто|регуляр)/iu.test(normalized)) {
        const time = question.match(/(\d{1,2}:\d{2})/u)?.[1] || "09:00";
        const result = await yandexDailyDigestEnable({ time, email: /email|почт[уы]|письм/iu.test(normalized), save: true });
        return `Ежедневный дайджест включен: каждый день ${result.time}.`;
      }
      if (/(выключ|отключ|останов|убери)/iu.test(normalized)) {
        await yandexDailyDigestDisable();
        return "Ежедневный дайджест выключен.";
      }
      const result = await yandexDailyDigestTick({ force: true, save: true, email: /отправь|email|почт[уы]/iu.test(normalized) });
      return [result.text, result.remote ? `\nСохранено: ${result.remote}` : ""].join("").trim();
    }

    if (/(календар|событи|встреч)/iu.test(normalized) && /(напомин|уведом|следи|монитор|авто|регуляр)/iu.test(normalized)) {
      if (/(включ|запусти|начни|поставь|создай)/iu.test(normalized)) {
        const minutes = Number(question.match(/(\d+)\s*(?:мин|минут)/iu)?.[1] || 15);
        await yandexCalendarRemindersEnable(minutes);
        return `Проверка календарных напоминаний включена: каждые ${minutes} минут.`;
      }
      if (/(выключ|отключ|останов|убери)/iu.test(normalized)) {
        await yandexCalendarRemindersDisable();
        return "Проверка календарных напоминаний выключена.";
      }
      const result = await yandexCalendarRemindersTick({ force: true });
      if (!result.events.length) return "Ближайших событий для напоминания нет.";
      return ["Ближайшие события:", ...result.events.map((row, index) => `${index + 1}. ${row.title || row.uid} — ${row.startIso || row.start || "-"}`)].join("\n");
    }

    if (/(диск|яндекс.?диск|документ)/iu.test(normalized) && /(провер|обслуж|maintenance|аудит|регуляр|авто)/iu.test(normalized)) {
      if (/(включ|запусти|начни|поставь|создай)/iu.test(normalized)) {
        const days = Number(question.match(/(\d+)\s*(?:дн|день|дня|дней)/iu)?.[1] || 7);
        await yandexDiskMaintenanceEnable(days);
        return `Проверка Яндекс Диска включена: каждые ${days} дней.`;
      }
      if (/(выключ|отключ|останов|убери)/iu.test(normalized)) {
        await yandexDiskMaintenanceDisable();
        return "Проверка Яндекс Диска выключена.";
      }
      const result = await yandexDiskMaintenanceTick({ force: true });
      return `Проверка Яндекс Диска выполнена. Документов: ${result.docs}, публичных ссылок: ${result.publicLinks}. Отчет: ${result.remote}.`;
    }

    if (/(контакт|адресн)/iu.test(normalized) && !mailFollowup && !isExplicitYandexDiskPathDelete(question)) {
      return await buildYandexContactsDirectAnswer(question, normalized);
    }

    if (mailFollowup || /(почт|письм|email|e-mail|спам|чернов|отправлен|исходящ|корзин)/iu.test(normalized)) {
      if (/(авто|автомат|кажд|период|монитор|следи|проверяй|проверку|режим)/iu.test(normalized) && /(включ|запусти|начни|поставь|создай)/iu.test(normalized)) {
        const minutes = Number(String(question || "").match(/(\d+)\s*(?:мин|минут)/iu)?.[1] || 5);
        await yandexMailWatchEnable(minutes);
        return `Автопроверка новых писем включена: каждые ${minutes} минут.`;
      }
      if (/(авто|автомат|кажд|период|монитор|следи|проверяй|проверку|режим)/iu.test(normalized) && /(выключ|отключ|останов|убери)/iu.test(normalized)) {
        await yandexMailWatchDisable();
        return "Автопроверка новых писем выключена.";
      }
      if (/(проверь|получи|есть).{0,40}(нов|свеж)/iu.test(normalized)) {
        const result = await yandexMailWatchTick({ force: true });
        if (!result.newMessages.length) return "Новых писем нет.";
        return ["Новые письма:", ...result.newMessages.map((row, index) => `${index + 1}. ${formatYandexMailSummary(row)}`)].join("\n");
      }
      if (/(папк|ящик|mailbox|folder)/iu.test(normalized) && /(покажи|список|какие|есть)/iu.test(normalized)) {
        const folders = await yandexMailFolders();
        if (!folders.length) return "Папки Яндекс Почты не найдены.";
        return ["Папки Яндекс Почты:", ...folders.map((folder, index) => `${index + 1}. ${folder.name}${folder.special ? ` (${folder.special})` : ""}`)].join("\n");
      }
      if (/(статус|проверь|работает|доступ)/iu.test(normalized)) {
        const result = await yandexMailStatus();
        return `Яндекс Почта подключена: ${result.email}. Входящие: ${result.inbox?.exists ?? "-"}.`;
      }
      if (/(ответь|ответить|напиши\s+ответ)/iu.test(normalized)) {
        const reply = parseYandexMailReplyRequest(question, previousAssistantText);
        if (!reply.uid || !reply.text) return "Для ответа укажите письмо и текст. Пример: ответь на письмо #2382 текст: спасибо, получил.";
        const result = await yandexMailReply({ ...reply, confirm: true });
        return `Ответ отправлен на письмо #${result.replyToUid}: ${result.to.join(", ")}. Тема: ${result.subject}.`;
      }
      if (/(перешли|переслать|перешли\s+письмо|fwd|forward)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        const to = [...String(question || "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)].map((match) => match[0]);
        if (!uid || !to.length) return "Для пересылки укажите письмо и получателя. Пример: перешли письмо #2382 user@example.com.";
        const result = await yandexMailForward({ uid, to, confirm: true });
        return `Письмо переслано: ${result.to.join(", ")}. Тема: ${result.subject}.`;
      }
      if (/(сохрани|запиши).{0,60}(диск|яндекс.?диск|облак)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Какое письмо сохранить на Диск? Укажите номер из списка или UID.";
        const result = await yandexMailSaveToDisk(uid, { mailbox: extractYandexMailboxName(question) || "INBOX" });
        return `Письмо #${uid} сохранено на Яндекс Диск: ${result.remote || result.path}.`;
      }
      if (/(пакет|комплект|встреч).{0,80}(письм|письма)|(?:письм|письма).{0,80}(пакет|комплект|встреч)/iu.test(normalized) && /(диск|ссылк|qr|календар|встреч)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Из какого письма создать пакет? Укажите номер из списка или UID.";
        const result = await yandexMailMeetingPack(uid, { mailbox: extractYandexMailboxName(question) || "INBOX", ...extractDateTimeFromText(question), confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(создай|добавь).{0,40}(событи|встреч|календар)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Из какого письма создать событие? Укажите номер из списка или UID.";
        const result = await yandexMailCreateCalendarEvent(uid, { mailbox: extractYandexMailboxName(question) || "INBOX", confirm: true });
        return `Событие создано в Яндекс Календаре: ${result.title || result.uid}.`;
      }
      if (/(добавь|создай|сохрани).{0,50}(отправител|автор|контакт)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Из какого письма добавить отправителя в контакты? Укажите номер из списка или UID.";
        const result = await yandexMailSenderToContact(uid, { mailbox: extractYandexMailboxName(question) || "INBOX", confirm: true });
        return `Контакт создан: ${result.name}, ${result.email}.`;
      }
      if (/(школ|сад|детсад|инн|городск|сло[йи]|йошкар)/iu.test(normalized) && /(письм|письма|письме)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "По какому письму проверить городские слои? Укажите номер из списка или UID.";
        const rows = await yandexMailCityContext(uid, { mailbox: extractYandexMailboxName(question) || "INBOX" });
        if (!rows.length) return "В письме не нашел совпадений со слоями школ и детских садов.";
        return ["Нашел в городских слоях:", ...rows.map((row, index) => `${index + 1}. ${row.name}${row.inn ? `, ИНН ${row.inn}` : ""}${row.address ? `, ${row.address}` : ""}`)].join("\n");
      }
      if (/(адрес|карт|место|где)/iu.test(normalized) && /(письм|письма|письме)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Из какого письма взять адрес? Укажите номер из списка или UID.";
        const rows = await yandexMailMapAddresses(uid, { mailbox: extractYandexMailboxName(question) || "INBOX" });
        if (!rows.length) return "В письме не нашел адресов для карты.";
        return ["Адреса из письма:", ...rows.map((row, index) => `${index + 1}. ${row.resolved || row.address}${row.map ? `\n${row.map}` : ""}`)].join("\n");
      }
      if (/(создай|добавь).{0,30}(задач|напомин)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "По какому письму создать задачу? Укажите номер из списка или UID.";
        const result = await yandexMailCreateTask(uid, { mailbox: extractYandexMailboxName(question) || "INBOX" });
        return `Задача создана #${result.id}: ${result.title}.`;
      }
      if (/(удали|удалить|перемести\s+в\s+корзин)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Какое письмо удалить? Укажите номер из списка или UID, например: удали письмо #2382.";
        const mailbox = await resolveYandexMailbox(extractYandexMailboxName(question) || "INBOX");
        const result = await yandexMailDelete(uid, { mailbox, confirm: true });
        return `Письмо #${result.uid} перемещено в корзину: ${result.to}.`;
      }
      if (/(пометь|отметь|сделай)/iu.test(normalized) && /(прочитан|непрочитан)/iu.test(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText);
        if (!uid) return "Какое письмо пометить? Укажите номер из списка или UID.";
        const seen = !/непрочитан/iu.test(normalized);
        const mailbox = await resolveYandexMailbox(extractYandexMailboxName(question) || "INBOX");
        const result = await yandexMailMark(uid, seen, { mailbox });
        return `Письмо #${result.uid} помечено как ${seen ? "прочитанное" : "непрочитанное"}.`;
      }
      if (/(отправь|отправить|напиши|пошли)/iu.test(normalized) && !/(отправлен|исходящ)/iu.test(normalized)) {
        const draft = parseYandexMailSendRequest(question);
        if (!draft.to.length && draft.contactQuery) {
          const contactResult = await resolveYandexMailRecipientFromContacts(draft.contactQuery);
          if (contactResult.status === "not-found") return `В Яндекс Контактах не нашел: ${draft.contactQuery}. Укажите email вручную.`;
          if (contactResult.status === "no-email") return `Контакт найден, но email не указан: ${contactResult.contact.name}. Укажите email вручную.`;
          if (contactResult.status === "ambiguous") {
            return [
              `Нашел несколько контактов для "${draft.contactQuery}". Уточните, кому отправить:`,
              ...contactResult.contacts.map((contact, index) => `${index + 1}. ${contact.name || contact.email || "Контакт"}${contact.email ? `, ${contact.email}` : ", email не указан"}`),
            ].join("\n");
          }
          draft.to = [contactResult.contact.email];
        }
        if (!draft.to.length || !draft.text) {
          return "Для отправки письма укажите получателя и текст. Пример: отправь письмо user@example.com тема: Привет текст: Проверка.";
        }
        const result = await yandexMailSend({ ...draft, confirm: true });
        let contactNote = "";
        if (draft.contactQuery && result.to[0] && process.stdin.isTTY) {
          const contactResult = await resolveYandexMailRecipientFromContacts(draft.contactQuery).catch(() => null);
          if (contactResult?.status === "no-email") {
            const shouldAdd = await askYesNo(`Добавить ${result.to[0]} в контакт "${contactResult.contact.name}"? [y/N] `, false);
            if (shouldAdd) {
              const update = await yandexContactsAddEmail(draft.contactQuery, result.to[0], { confirm: true, selectFirst: true });
              contactNote = update.status === "updated" ? `\nEmail добавлен в контакт: ${update.name || draft.contactQuery}.` : "";
            }
          }
        }
        return `Письмо отправлено: ${result.to.join(", ")}. Тема: ${result.subject}.${contactNote}`;
      }
      if (/(сколько|количеств|есть\s+ли)/iu.test(normalized) && /непрочитан/iu.test(normalized)) {
        const mailbox = await resolveYandexMailbox(extractYandexMailboxName(question) || "INBOX");
        const count = await yandexMailCount({ mailbox, unread: true });
        if (!count) return "Непрочитанных писем нет.";
        const latest = await yandexMailList({ mailbox, limit: 1, unread: true });
        return [
          `Непрочитанных писем: ${count}.`,
          latest[0] ? `Самое свежее: ${formatYandexMailSummary(latest[0])}` : "",
        ].filter(Boolean).join("\n");
      }
      if (isYandexMailReadRequest(normalized)) {
        const uid = resolveYandexMailUidFromQuestion(question, previousAssistantText)
          || await getLatestYandexMailUid({ unread: /непрочитан/iu.test(normalized) });
        if (!uid) return "Писем для чтения не найдено.";
        const row = await yandexMailRead(uid, { mailbox: await resolveYandexMailbox(extractYandexMailboxName(question) || "INBOX") });
        if (!row || row.status === "not-found") return `Письмо #${uid} не найдено.`;
        return formatYandexMailRead(row);
      }
      const mailbox = await resolveYandexMailbox(extractYandexMailboxName(question) || "INBOX");
      const rows = /(найди|поиск)/iu.test(normalized)
        ? await yandexMailSearch(cleanupYandexQuery(question), { mailbox, limit: 10 })
        : await yandexMailList({ mailbox, limit: 10, unread: /непрочитан/iu.test(normalized) });
      if (!rows.length) return "Писем по запросу не найдено.";
      return ["Яндекс Почта:", ...rows.map((row, index) => `${index + 1}. ${formatYandexMailSummary(row)}`)].join("\n");
    }

    if (/(документ|документы|docs|360)/iu.test(normalized) && /(яндекс|диск|облак|360|docs)/iu.test(normalized)) {
      if (/(статус|проверь|работает|доступ)/iu.test(normalized)) {
        const result = await yandexDocsStatus();
        return `Яндекс Документы через Диск подключены. Папка: ${result.folder}.`;
      }
      if (/(создай|сделай|запиши|сохрани)/iu.test(normalized)) {
        const text = extractShareMessage(question) || cleanupCloudSaveText(question);
        if (!text) return "Укажите текст документа. Пример: создай документ на Яндекс Диске текст: ...";
        const result = await yandexDocsCreateText({
          title: extractYandexDocTitle(question),
          text,
          format: /html/iu.test(normalized) ? "html" : /txt|текстов/iu.test(normalized) ? "txt" : "md",
          confirm: true,
        });
        return `Документ создан на Яндекс Диске: ${result.remote}.`;
      }
      if (/(прочитай|открой|покажи\s+текст)/iu.test(normalized)) {
        const result = await yandexDocsRead(extractCloudPath(question) || cleanupYandexQuery(question), {});
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(ссылк|поделись|опубликуй|qr|qr-код)/iu.test(normalized)) {
        const result = await yandexDocsShare(extractCloudPath(question) || cleanupYandexQuery(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(переимен|rename)/iu.test(normalized)) {
        const result = await yandexDocsRename(extractCloudPath(question) || cleanupYandexQuery(question), extractCloudNewName(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(удали|удалить)/iu.test(normalized)) {
        const result = await yandexDocsDelete(extractCloudPath(question) || cleanupYandexQuery(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      const rows = /(найди|поиск)/iu.test(normalized)
        ? await yandexDocsFind(cleanupYandexQuery(question), { limit: 20 })
        : await yandexDocsList({ limit: 20 });
      if (!rows.length) return "Документы на Яндекс Диске не найдены.";
      return ["Документы на Яндекс Диске:", ...rows.map((row, index) => `${index + 1}. ${row.name} — ${row.path}`)].join("\n");
    }

    if (/(календар|событи|встреч|телемост)/iu.test(normalized)) {
      if (/(статус|проверь|работает|доступ)/iu.test(normalized) && /(календар|телемост)/iu.test(normalized)) {
        const result = /телемост/iu.test(normalized) ? await yandexTelemostStatus() : await yandexCalendarStatus();
        return /телемост/iu.test(normalized)
          ? `${result.message} Календарь: ${result.calendar || "-"}.`
          : `Яндекс Календарь подключен: ${result.displayName || result.url}. Календарей: ${result.calendars || 1}.`;
      }
      if (/(какие|список).{0,30}(календар|календари)|календари/iu.test(normalized)) {
        const rows = await yandexCalendarCalendars({ limit: 20 });
        if (!rows.length) return "Календари Яндекса не найдены.";
        return ["Яндекс Календари:", ...rows.map((row, index) => `${index + 1}. ${row.name} — ${row.href}`)].join("\n");
      }
      if (/(напомин|уведом)/iu.test(normalized) && /(добав|постав|создай)/iu.test(normalized)) {
        const minutes = Number(question.match(/(\d+)\s*(?:мин|минут)/iu)?.[1] || 15);
        const result = await yandexCalendarAddReminder(cleanupCalendarEventQuery(question), { minutes, confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(создай|добавь|запланируй|назначь)/iu.test(normalized)) {
        const dateTime = extractDateTimeFromText(question);
        const title = extractCalendarTitle(question) || (/телемост/iu.test(normalized) ? "Телемост IOLA" : "Событие IOLA");
        const args = { ...dateTime, title, description: extractShareMessage(question) || "", confirm: true };
        const result = /телемост/iu.test(normalized)
          ? await yandexTelemostCreateEvent(args)
          : /кажд|еженед|ежеднев|ежемесяч|повтор/iu.test(normalized)
            ? await yandexCalendarCreateRecurringEvent({ ...args, ...extractCalendarRepeat(question), confirm: true })
            : await yandexCalendarCreateEvent(args);
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(перенеси|перемести|измени\s+время|смени\s+время)/iu.test(normalized)) {
        const result = await yandexCalendarMove(cleanupCalendarEventQuery(question), { ...extractDateTimeFromText(question), confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(переимен|измени\s+назв|смени\s+назв)/iu.test(normalized)) {
        const result = await yandexCalendarUpdate(cleanupCalendarEventQuery(question), { title: extractCalendarTitle(question), confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(удали|удалить|отмени|отменить)/iu.test(normalized)) {
        const result = await yandexCalendarDelete(cleanupCalendarEventQuery(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(найди|поиск|где|покажи).{0,40}(событи|встреч|телемост)/iu.test(normalized)) {
        const rows = await yandexCalendarSearch(cleanupCalendarEventQuery(question), { limit: 20 });
        if (!rows.length) return "События в Яндекс Календаре по запросу не найдены.";
        return ["Яндекс Календарь:", ...rows.map((row, index) => `${index + 1}. ${row.title || "(без названия)"} — ${row.startIso || row.start || "-"}${row.location ? `, ${row.location}` : ""}`)].join("\n");
      }
      const rows = await yandexCalendarList({ limit: 10 });
      if (!rows.length) return "В ближайшие дни событий в Яндекс Календаре не найдено.";
      return ["Яндекс Календарь:", ...rows.map((row, index) => `${index + 1}. ${row.title || "(без названия)"} — ${row.startIso || row.start || "-"}${row.location ? `, ${row.location}` : ""}`)].join("\n");
    }

    if (/(контакт|адресн)/iu.test(normalized)) {
      if (/(дубликат|повтор)/iu.test(normalized)) {
        const rows = await yandexContactsFindDuplicates({ limit: 20 });
        if (!rows.length) return "Дубликаты контактов не найдены.";
        return rows.map((row) => formatToolResult({ rows: [row], outputs: [] }, {})).join("\n");
      }
      if (/(неполн|без\s+email|без\s+почт|без\s+телефон|без\s+адрес)/iu.test(normalized)) {
        const field = /без\s+(?:email|почт)/iu.test(normalized) ? "email" : /без\s+телефон/iu.test(normalized) ? "phone" : /без\s+адрес/iu.test(normalized) ? "address" : "";
        const rows = await yandexContactsFindIncomplete({ field, limit: 30 });
        if (!rows.length) return "Неполные контакты по этому признаку не найдены.";
        return ["Неполные контакты:", ...rows.map((row, index) => `${index + 1}. ${formatYandexContact(row)}`)].join("\n");
      }
      if (/(экспорт|выгруз|сохрани|резерв|backup|бэкап)/iu.test(normalized) && /(диск|яндекс.?диск|облак)/iu.test(normalized)) {
        const result = await yandexContactsBackupToDisk({ format: /csv/iu.test(normalized) ? "csv" : "vcard", confirm: true });
        return `Контакты сохранены на Яндекс Диск: ${result.remote}. Записей: ${result.rows}.`;
      }
      if (/(экспорт|выгруз)/iu.test(normalized)) {
        const result = await yandexContactsExport(/csv/iu.test(normalized) ? "csv" : "vcard", {});
        return `Контакты экспортированы: ${result.output}. Записей: ${result.rows}.`;
      }
      if (/(создай|добавь|запиши|сохрани)\s+контакт/iu.test(normalized)) {
        const draft = parseYandexContactCreateRequest(question);
        if (!draft.name || (!draft.email && !draft.phone)) return "Для создания контакта укажите имя и email или телефон.";
        const result = await yandexContactsCreate({ ...draft, confirm: true });
        return `Контакт создан: ${formatYandexContact(result)}.`;
      }
      if (/(удали|удалить).{0,40}контакт/iu.test(normalized)) {
        const query = cleanupYandexContactActionQuery(question);
        const result = await yandexContactsDelete(query, { confirm: true });
        if (result.status === "ambiguous") return [`Нашел несколько контактов. Уточните:`, ...result.contacts.map((contact, index) => `${index + 1}. ${formatYandexContact(contact)}`)].join("\n");
        if (result.status === "not-found") return `Контакт не найден: ${query}.`;
        return `Контакт удален: ${formatYandexContact(result)}.`;
      }
      if (/(добав|запиши|сохрани).{0,40}(email|e-mail|почт)/iu.test(normalized)) {
        const email = String(question || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
        const query = cleanupYandexContactEmailTarget(question, email);
        if (!email || !query) return "Укажите контакт и email. Пример: добавь email petrov@example.com к контакту Петров.";
        const result = await yandexContactsAddEmail(query, email, { confirm: true });
        if (result.status === "not-found") return `Контакт не найден: ${query}.`;
        if (result.status === "has-email") return `У контакта уже есть email: ${result.contact.name}, ${result.contact.email}.`;
        if (result.status === "ambiguous") {
          return [
            `Нашел несколько контактов для "${query}". Уточните контакт:`,
            ...result.contacts.map((contact, index) => `${index + 1}. ${contact.name || contact.email || "Контакт"}${contact.email ? `, ${contact.email}` : ""}`),
          ].join("\n");
        }
        return `Email добавлен в контакт: ${result.name || query}, ${result.email}.`;
      }
      if (/(добав|запиши|сохрани).{0,40}(телефон|номер)/iu.test(normalized)) {
        const phone = String(question || "").match(/(?:\+?\d[\d\s()\-]{6,}\d)/u)?.[0]?.trim() || "";
        const query = cleanupYandexContactActionQuery(question.replace(phone, " "));
        if (!phone || !query) return "Укажите контакт и телефон.";
        const result = await yandexContactsUpdate(query, { phone, mode: "add-phone", confirm: true });
        if (result.status !== "updated") return formatToolResult({ rows: [result], outputs: [] }, {});
        return `Телефон добавлен: ${formatYandexContact(result)}.`;
      }
      if (/(добав|запиши|сохрани).{0,40}(адрес)/iu.test(normalized)) {
        const address = question.match(/(?:адрес|по адресу)\s*:?\s*(.+)$/iu)?.[1]?.trim() || "";
        const query = cleanupYandexContactActionQuery(question.replace(address, " "));
        if (!address || !query) return "Укажите контакт и адрес.";
        const result = await yandexContactsUpdate(query, { address, mode: "add-address", confirm: true });
        if (result.status !== "updated") return formatToolResult({ rows: [result], outputs: [] }, {});
        return `Адрес добавлен: ${formatYandexContact(result)}.`;
      }
      if (/(добав|запиши|сохрани).{0,40}(заметк|коммент|примеч)/iu.test(normalized)) {
        const note = question.match(/(?:заметк\p{L}*|коммент\p{L}*|примеч\p{L}*)\s*:?\s*(.+)$/iu)?.[1]?.trim() || "";
        const query = cleanupYandexContactActionQuery(question.replace(note, " "));
        if (!note || !query) return "Укажите контакт и текст заметки.";
        const result = await yandexContactsUpdate(query, { note, mode: "add-note", confirm: true });
        if (result.status !== "updated") return formatToolResult({ rows: [result], outputs: [] }, {});
        return `Заметка добавлена: ${formatYandexContact(result)}.`;
      }
      if (/(создай|сделай).{0,40}(папк).{0,40}(контакт)/iu.test(normalized)) {
        const query = cleanupYandexContactActionQuery(question);
        const result = await yandexContactCreateDiskFolder({ query, confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(отправь|пошли).{0,80}(ссылк|qr|qr-код|диск|яндекс.?диск)/iu.test(normalized)) {
        const remotePath = extractCloudPath(question);
        const contact = cleanupYandexContactActionQuery(question.replace(remotePath || "", " "));
        const result = await yandexContactSendDiskLinkQr({ contact, path: remotePath, confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(отправь|пошли|напиши).{0,40}(письм|сообщ)/iu.test(normalized)) {
        const draft = parseYandexMailSendRequest(question);
        const result = await yandexContactSendMail({ contact: draft.contactQuery || cleanupYandexContactActionQuery(question), subject: draft.subject, text: draft.text, confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(создай|добавь|запланируй).{0,40}(встреч|событи|календар|телемост)/iu.test(normalized)) {
        const dateTime = extractDateTimeFromText(question);
        const query = cleanupYandexContactActionQuery(question);
        const result = /телемост/iu.test(normalized)
          ? await yandexContactCreateTelemostEvent({ query, ...dateTime, confirm: true })
          : await yandexContactCreateCalendarEvent({ query, ...dateTime, confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(статус|проверь|работает|доступ)/iu.test(normalized)) {
        const result = await yandexContactsStatus();
        return `Яндекс Контакты подключены: ${result.displayName || result.url}.`;
      }
      const query = cleanupYandexQuery(question);
      const rows = /(найди|поиск)/iu.test(normalized) && query
        ? await yandexContactsSearch(query, { limit: 10 })
        : await yandexContactsList({ limit: 20 });
      if (!rows.length) return "Контакты по запросу не найдены.";
      return ["Яндекс Контакты:", ...rows.map((row, index) => `${index + 1}. ${formatYandexContact(row)}`)].join("\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^(?:Для Yandex Go deeplink|Для Cloud Connector нужен|Для YandexGPT нужны)/u.test(message)) return message;
    return `Не смог выполнить запрос к сервисам Яндекса: ${message}`;
  }
  return "";
}

async function buildYandexContactsDirectAnswer(question, normalized = "") {
  const text = normalized || String(question || "").toLocaleLowerCase("ru-RU");
  if (/(авто|автомат|регуляр|кажд|период|обслужив|проверяй|проверку)/iu.test(text) && /(контакт)/iu.test(text) && /(включ|запусти|начни|поставь|создай)/iu.test(text)) {
    const days = Number(String(question || "").match(/(\d+)\s*(?:дн|день|дня|дней)/iu)?.[1] || 7);
    const result = await yandexContactsMaintenanceEnable(days, { backup: /(backup|бэкап|резерв|диск)/iu.test(text) });
    return `Регулярная проверка контактов включена: каждые ${result.days} дней. Backup на Диск: ${result.backup ? "yes" : "no"}.`;
  }
  if (/(авто|автомат|регуляр|кажд|период|обслужив|проверяй|проверку)/iu.test(text) && /(контакт)/iu.test(text) && /(выключ|отключ|останов|убери)/iu.test(text)) {
    await yandexContactsMaintenanceDisable();
    return "Регулярная проверка контактов выключена.";
  }
  if (/(обслужив|провер|диагност|doctor)/iu.test(text) && /(контакт)/iu.test(text) && /(сейчас|запусти|сделай|проверь)/iu.test(text)) {
    const result = await yandexContactsMaintenanceTick({ force: true, backup: /(backup|бэкап|резерв)/iu.test(text) });
    return [
      "Проверка контактов выполнена:",
      `Всего: ${result.total}`,
      `Неполных: ${result.incomplete}`,
      `Групп дубликатов: ${result.duplicateGroups}`,
      result.backupRemote ? `Backup: ${result.backupRemote}` : "",
    ].filter(Boolean).join("\n");
  }
  if (/(дубликат|повтор)/iu.test(text)) {
    const rows = await yandexContactsFindDuplicates({ limit: 20 });
    if (!rows.length) return "Дубликаты контактов не найдены.";
    return rows.map((row) => formatToolResult({ rows: [row], outputs: [] }, {})).join("\n");
  }
  if (/(неполн|без\s+email|без\s+почт|без\s+телефон|без\s+адрес)/iu.test(text)) {
    const field = /без\s+(?:email|почт)/iu.test(text) ? "email" : /без\s+телефон/iu.test(text) ? "phone" : /без\s+адрес/iu.test(text) ? "address" : "";
    const rows = await yandexContactsFindIncomplete({ field, limit: 30 });
    if (!rows.length) return "Неполные контакты по этому признаку не найдены.";
    return ["Неполные контакты:", ...rows.map((row, index) => `${index + 1}. ${formatYandexContact(row)}`)].join("\n");
  }
  if (/(экспорт|выгруз|сохрани|резерв|backup|бэкап)/iu.test(text) && /(диск|яндекс.?диск|облак)/iu.test(text)) {
    const result = await yandexContactsBackupToDisk({ format: /csv/iu.test(text) ? "csv" : "vcard", confirm: true });
    return `Контакты сохранены на Яндекс Диск: ${result.remote}. Записей: ${result.rows}.`;
  }
  if (/(импорт|импортируй|загрузи).{0,40}контакт/iu.test(text)) {
    const inputPath = extractLocalInputPath(question) || question.match(/(?:из|файл)\s+([^\s]+(?:\.csv|\.vcf|\.vcard))/iu)?.[1] || "";
    if (!inputPath) return "Укажите файл CSV или vCard для импорта контактов.";
    const result = await yandexContactsImport(/\.csv$/iu.test(inputPath) ? "csv" : "vcard", { path: inputPath, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(дн[еиь]\s+рожден|день\s+рождени|дней\s+рождени|birthday)/iu.test(text) && /(календар|событи|напомин)/iu.test(text)) {
    const result = await yandexContactsBirthdaysToCalendar({ confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(создай|добавь|запиши|сохрани)\s+контакт/iu.test(text) && /(школ|детск\w*\s+сад|детсад|садик|инн)/iu.test(text)) {
    const result = await yandexContactFromPublicEntity({ query: cleanupYandexContactActionQuery(question), confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(экспорт|выгруз)/iu.test(text)) {
    const result = await yandexContactsExport(/csv/iu.test(text) ? "csv" : "vcard", {});
    return `Контакты экспортированы: ${result.output}. Записей: ${result.rows}.`;
  }
  if (/(создай|добавь|запиши|сохрани)\s+контакт/iu.test(text)) {
    const draft = parseYandexContactCreateRequest(question);
    if (!draft.name || (!draft.email && !draft.phone)) return "Для создания контакта укажите имя и email или телефон.";
    const result = await yandexContactsCreate({ ...draft, confirm: true });
    return `Контакт создан: ${formatYandexContact(result)}.`;
  }
  if (/(удали|удалить).{0,40}контакт/iu.test(text)) {
    const query = extractEmailAddress(question) || String(question || "").match(/(?:\+?\d[\d\s()\-]{6,}\d)/u)?.[0]?.trim() || cleanupYandexContactActionQuery(question);
    const result = await yandexContactsDelete(query, { confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(email|e-mail|почт)/iu.test(text)) {
    const email = String(question || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
    const query = cleanupYandexContactEmailTarget(question, email);
    if (!email || !query) return "Укажите контакт и email. Пример: добавь email petrov@example.com к контакту Петров.";
    const result = await yandexContactsAddEmail(query, email, { confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(удали|удалить|убери).{0,40}(email|e-mail|почт)/iu.test(text)) {
    const email = String(question || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
    const query = cleanupYandexContactEmailTarget(question, email) || cleanupYandexContactActionQuery(question);
    if (!query) return "Укажите контакт, у которого удалить email.";
    const result = await yandexContactsUpdate(query, { removeEmail: email || true, mode: "remove-email", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(телефон|номер)/iu.test(text)) {
    const phone = String(question || "").match(/(?:\+?\d[\d\s()\-]{6,}\d)/u)?.[0]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(phone, " "));
    if (!phone || !query) return "Укажите контакт и телефон.";
    const result = await yandexContactsUpdate(query, { phone, mode: "add-phone", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(удали|удалить|убери).{0,40}(телефон|номер)/iu.test(text)) {
    const phone = String(question || "").match(/(?:\+?\d[\d\s()\-]{6,}\d)/u)?.[0]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(phone, " "));
    if (!query) return "Укажите контакт, у которого удалить телефон.";
    const result = await yandexContactsUpdate(query, { removePhone: phone || true, mode: "remove-phone", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(переимен|измени\s+имя|смени\s+имя)/iu.test(text) && /(контакт)/iu.test(text)) {
    const newName = question.match(/(?:в|на|как)\s+["«]?([^"».,!?]+)["»]?\s*$/iu)?.[1]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(newName, " "));
    if (!query || !newName) return "Укажите контакт и новое имя.";
    const result = await yandexContactsUpdate(query, { name: newName, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(день\s+рожд|дат[ау]\s+рожд|birthday)/iu.test(text)) {
    const birthday = question.match(/(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?|\d{4}-\d{2}-\d{2})/u)?.[1] || "";
    const query = cleanupYandexContactActionQuery(question.replace(birthday, " "));
    if (!birthday || !query) return "Укажите контакт и дату рождения.";
    const result = await yandexContactsUpdate(query, { birthday, mode: "add-birthday", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(организац|должност)/iu.test(text)) {
    const org = question.match(/(?:организац\p{L}*|орг)\s*:?\s*(.*?)(?=\s+должност\p{L}*\s*:|$)/iu)?.[1]?.trim() || "";
    const title = question.match(/должност\p{L}*\s*:?\s*(.+)$/iu)?.[1]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(org, " ").replace(title, " "));
    if (!query || (!org && !title)) return "Укажите контакт и организацию или должность.";
    const result = await yandexContactsUpdate(query, { org, title, mode: "add-org", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(адрес)/iu.test(text)) {
    const address = question.match(/(?:адрес|по адресу)\s*:?\s*(.+)$/iu)?.[1]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(address, " "));
    if (!address || !query) return "Укажите контакт и адрес.";
    const result = await yandexContactsUpdate(query, { address, mode: "add-address", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(добав|запиши|сохрани).{0,40}(заметк|коммент|примеч)/iu.test(text)) {
    const note = question.match(/(?:заметка|комментарий|примечание)\s*:\s*(.+)$/iu)?.[1]?.trim() || "";
    const query = cleanupYandexContactActionQuery(question.replace(note, " "));
    if (!note || !query) return "Укажите контакт и текст заметки.";
    const result = await yandexContactsUpdate(query, { note, mode: "add-note", confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(создай|сделай).{0,40}(папк).{0,40}(контакт)/iu.test(text)) {
    const query = cleanupYandexContactActionQuery(question);
    const result = await yandexContactCreateDiskFolder({ query, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(полный|комплект|пакет|подготовь).{0,80}(контакт|клиент|человек)/iu.test(text) || /(контакт|клиент|человек).{0,80}(полный|комплект|пакет)/iu.test(text)) {
    const query = cleanupYandexContactActionQuery(question);
    const result = await yandexContactFullPack({ query, ...extractDateTimeFromText(question), note: extractShareMessage(question), confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(отправь|пошли).{0,80}(ссылк|qr|qr-код|диск|яндекс.?диск)/iu.test(text)) {
    const remotePath = extractCloudPath(question);
    const contact = cleanupYandexContactActionQuery(question.replace(remotePath || "", " "));
    const result = await yandexContactSendDiskLinkQr({ contact, path: remotePath, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(отправь|пошли|напиши).{0,40}(письм|сообщ)/iu.test(text)) {
    const draft = parseYandexMailSendRequest(question);
    const result = await yandexContactSendMail({ contact: draft.contactQuery || cleanupYandexContactActionQuery(question), subject: draft.subject, text: draft.text, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(создай|добавь|запланируй).{0,40}(встреч|событи|календар|телемост)/iu.test(text)) {
    const dateTime = extractDateTimeFromText(question);
    const query = cleanupYandexContactActionQuery(question);
    const result = /телемост/iu.test(text)
      ? await yandexContactCreateTelemostEvent({ query, ...dateTime, confirm: true })
      : await yandexContactCreateCalendarEvent({ query, ...dateTime, confirm: true });
    return formatToolResult({ rows: [result], outputs: [] }, {});
  }
  if (/(статус|проверь|работает|доступ)/iu.test(text)) {
    const result = await yandexContactsStatus();
    return `Яндекс Контакты подключены: ${result.displayName || result.url}.`;
  }
  const query = cleanupYandexQuery(question);
  const rows = /(найди|поиск|покажи|посмотри)/iu.test(text) && query
    ? await yandexContactsSearch(query, { limit: 10 })
    : await yandexContactsList({ limit: 20 });
  if (!rows.length) return "Контакты по запросу не найдены.";
  return ["Яндекс Контакты:", ...rows.map((row, index) => `${index + 1}. ${formatYandexContact(row)}`)].join("\n");
}

async function buildUserSkillDirectAnswer(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  if (!/(skill|скилл|скил|навык)/iu.test(normalized)) return "";
  if (/(шаблон|template|вариант)/iu.test(normalized) && /(покажи|список|какие|list)/iu.test(normalized)) {
    const rows = userSkillTemplates();
    return ["Шаблоны skills:", ...rows.map((row) => `- ${row.name}: ${row.description}`)].join("\n");
  }
  if (/(preview|предпросмотр|покажи\s+как)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question) || "user-skill";
    const template = normalizeUserSkillName(question.match(/(?:шаблон|template)\s+([a-z0-9а-яё_-]+)/iu)?.[1] || "");
    return buildUserSkillPreview({ name, template, instructions: question });
  }
  if (/(проверь|validate|doctor|валидац)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question);
    if (!name) return "Какой skill проверить? Укажите имя.";
    const result = await userSkillValidate(name);
    return ["Проверка skill:", ...result.checks.map((row) => `${row.status}: ${row.check} - ${row.message}`)].join("\n");
  }
  if (/(обнови|измени|update|edit)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question);
    if (!name) return "Какой skill обновить? Укажите имя.";
    const result = await userSkillUpdate(name, { instructions: question, tools: inferUserSkillTools(question), confirm: true });
    return `Skill обновлен: ${result.name}\nФайл: ${result.file}`;
  }
  if (/(создай|добавь|сделай|create|new)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question) || "user-skill";
    const result = await userSkillCreate({
      name,
      description: extractUserSkillDescription(question, name),
      instructions: question,
      tools: inferUserSkillTools(question),
      template: normalizeUserSkillName(question.match(/(?:шаблон|template)\s+([a-z0-9а-яё_-]+)/iu)?.[1] || ""),
      enable: true,
      confirm: true,
    });
    return `Skill создан: ${result.name}\nФайл: ${result.file}\nSkill включен.`;
  }
  if (/(выключ|отключ|disable)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question);
    if (!name) return "Какой skill выключить? Укажите имя.";
    const result = await userSkillSetEnabled(name, false);
    return `Skill ${result.name}: disabled`;
  }
  if (/(включ|enable)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question);
    if (!name) return "Какой skill включить? Укажите имя.";
    const result = await userSkillSetEnabled(name, true);
    return `Skill ${result.name}: enabled`;
  }
  if (/(удали|удалить|remove|delete)/iu.test(normalized)) {
    const name = extractUserSkillNameFromQuestion(question);
    if (!name) return "Какой skill удалить? Укажите имя.";
    const result = await userSkillDelete(name, { confirm: true });
    return `Skill удален: ${result.name}`;
  }
  if (/(список|покажи|какие|list)/iu.test(normalized)) {
    const skills = listSkills(await loadConfig()).filter((skill) => skill.source === "user");
    if (!skills.length) return "Пользовательских skills пока нет.";
    return ["Пользовательские skills:", ...skills.map((skill) => `- ${skill.name}: ${skill.description}`)].join("\n");
  }
  return "";
}

function isYandexServiceQuestion(normalized) {
  return /(яндекс|яндес|язндекс|язндекс|яндкс|yandex|почт|письм|календар|контакт|телемост|документ|docs|360|спам|чернов|отправлен|исходящ|корзин|такси|яндекс\s*go|яндекс\s*го|геокод|cloud|клауд)/iu.test(String(normalized || ""));
}

function isYandexIdentityQuestion(normalized) {
  const text = String(normalized || "");
  return /(аккаунт|аккант|акант|акаунт|акк?аунт|профил|логин|кто подключен|какой.*подключ|email|e-mail)/iu.test(text)
    && /(яндекс|яндес|язндекс|язндекс|яндкс|yandex)/iu.test(text);
}

function isYandexMailFollowupQuestion(normalized, question) {
  return isYandexMailReadRequest(normalized)
    || isYandexMailSelectionQuestion(question)
    || /(ответь|ответить|напиши\s+ответ|удали|удалить|перемести\s+в\s+корзин|пометь|отметь|сделай)/iu.test(String(normalized || ""))
    || /(самое\s+свеж|последн|получи|получить|текст\s+(?:то\s+)?(?:письм|где)|содержим)/iu.test(String(normalized || ""));
}

function cleanupYandexQuery(question) {
  const stop = /^(?:в|на|у|из|для|по|про|о|об|обо|яндекс|yandex|найди|поиск|покажи|посмотри|проверь|почт\p{L}*|письм\p{L}*|календар\p{L}*|контакт\p{L}*)$/iu;
  return String(question || "")
    .replace(/[?.!]+$/u, "")
    .split(/[^\p{L}\p{N}@._+-]+/gu)
    .filter((token) => token && !stop.test(token))
    .join(" ")
    .trim();
}

function extractYandexMailboxName(question) {
  const text = String(question || "").toLocaleLowerCase("ru-RU");
  if (/(спам|spam|junk)/iu.test(text)) return "spam";
  if (/(чернов|draft)/iu.test(text)) return "drafts";
  if (/(отправлен|исходящ|sent)/iu.test(text)) return "sent";
  if (/(корзин|удален|удалён|trash|bin)/iu.test(text)) return "trash";
  const explicit = String(question || "").match(/(?:папк[аиуы]?|mailbox|folder)\s+["'«]?([^"'».,!?]+)["'»]?/iu)?.[1];
  return explicit ? explicit.trim() : "";
}

function extractYandexMailUid(question) {
  const text = String(question || "");
  const explicit = text.match(/(?:#|uid\s*|письм[оа]?\s*)?(\d{3,})/iu)?.[1];
  return explicit ? Number(explicit) : 0;
}

function isYandexMailSelectionQuestion(question) {
  return /^\s*\d{1,3}\.?\s*$/u.test(String(question || ""));
}

function resolveYandexMailUidFromQuestion(question, previousAssistantText = "") {
  const explicitUid = extractYandexMailUid(question);
  if (explicitUid) return explicitUid;
  const ordinal = String(question || "").match(/^\s*(\d{1,3})\.?\s*$/u)?.[1];
  if (ordinal) {
    const uid = extractYandexMailUidByOrdinal(previousAssistantText, Number(ordinal));
    if (uid) return uid;
  }
  const actionOrdinal = String(question || "").match(/(?:удали|удалить|пометь|отметь|сделай|ответь|ответить)\s+#?(\d{1,3})\.?(?!\d)/iu)?.[1];
  if (actionOrdinal) {
    const uid = extractYandexMailUidByOrdinal(previousAssistantText, Number(actionOrdinal));
    if (uid) return uid;
  }
  if (/(самое\s+свеж|последн|получи|получить|текст\s+(?:то\s+)?(?:письм|где)|содержим)/iu.test(String(question || ""))) {
    return extractFirstYandexMailUid(previousAssistantText);
  }
  return 0;
}

function extractYandexMailUidByOrdinal(text, ordinal) {
  if (!ordinal || ordinal < 1) return 0;
  const rows = String(text || "").split(/\r?\n/u);
  for (const row of rows) {
    const match = row.match(/^\s*(\d{1,3})\.\s+#(\d{3,})/u);
    if (match && Number(match[1]) === ordinal) return Number(match[2]);
  }
  return 0;
}

function extractFirstYandexMailUid(text) {
  return Number(String(text || "").match(/#(\d{3,})/u)?.[1] || 0);
}

function isYandexMailReadRequest(normalizedQuestion) {
  return /(^|\s)(прочитай|прочти|открой|раскрой|прочитаем|получи|получить)(\s|$)/iu.test(normalizedQuestion)
    || /(покажи\s+содерж|о чем|о чём|текст\s+(?:то\s+)?(?:письм|где)|содержим)/iu.test(normalizedQuestion);
}

function isExplicitYandexDiskPathDelete(question) {
  const text = String(question || "");
  return /(удали|удалить|перемести\s+в\s+корзин)/iu.test(text)
    && /(яндекс.?диск|диск|облак|\/IOLA\/)/iu.test(text)
    && Boolean(extractCloudPath(text));
}

function parseYandexMailReplyRequest(question, previousAssistantText = "") {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  const uid = resolveYandexMailUidFromQuestion(text, previousAssistantText);
  const bodyMatch = text.match(/(?:текст|body|сообщение)\s*:\s*(.*)$/iu)
    || text.match(/(?:ответь|ответить|напиши\s+ответ)(?:\s+на\s+письмо\s+#?\d+|\s+#?\d+)?\s*:?\s*(.*)$/iu);
  return {
    uid,
    text: (bodyMatch?.[1] || "").trim(),
    mailbox: extractYandexMailboxName(question) || "INBOX",
  };
}

async function getLatestYandexMailUid(options = {}) {
  const rows = await yandexMailList({ limit: 1, unread: Boolean(options.unread) });
  return rows[0]?.uid || 0;
}

function parseYandexMailSendRequest(question) {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)].map((match) => match[0]);
  const subjectMatch = text.match(/(?:тема|subject)\s*:\s*(.*?)(?=\s+(?:текст|body|сообщение)\s*:|$)/iu);
  const bodyMatch = text.match(/(?:текст|body|сообщение)\s*:\s*(.*)$/iu);
  const contactMatch = text.match(/^(?:отправь|отправить|напиши|пошли)\s+(.+?)(?:\s+письмо|\s+сообщение|\s+текст\s*:|\s+напомни|\s+скажи|$)/iu);
  const withoutCommand = text
    .replace(/^(?:отправь|отправить|напиши|пошли)\s+(?:письмо\s+)?/iu, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "")
    .trim();
  return {
    to: emails,
    subject: (subjectMatch?.[1] || "Сообщение от IOLA CLI").trim(),
    text: (bodyMatch?.[1] || cleanupYandexMailBodyText(!subjectMatch ? withoutCommand : "")).trim(),
    contactQuery: cleanupYandexContactQuery((contactMatch?.[1] || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "")),
  };
}

function cleanupYandexMailBodyText(value) {
  return String(value || "")
    .replace(/^.+?\s+(?:письмо|сообщение)\s+/iu, "")
    .trim();
}

function cleanupYandexContactQuery(value) {
  return String(value || "")
    .replace(/\b(?:письмо|сообщение|текст|напомни|скажи|ему|ей)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupYandexContactEmailTarget(question, email) {
  return String(question || "")
    .replace(email || "", " ")
    .replace(/\b(?:добавь|добавить|запиши|сохрани|email|e-mail|почту|почта|к|ко|контакту|контакт)\b/giu, " ")
    .replace(/[,:;.!?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYandexContactCreateRequest(question) {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
  const phone = text.match(/(?:\+?\d[\d\s()\-]{6,}\d)/u)?.[0]?.trim() || "";
  const nameMatch = text.match(/(?:контакт|контакта)\s+["«]?([^"»:,]+)["»]?/iu)
    || text.match(/(?:создай|добавь|запиши|сохрани)\s+["«]?([^"»:,]+?)["»]?\s+(?:контакт|email|телефон|номер|почт)/iu);
  const address = text.match(/(?:адрес|по адресу)\s*:?\s*(.*?)(?=\s+(?:заметка|телефон|email|почта|организация|должность)\s*:|$)/iu)?.[1]?.trim() || "";
  const note = text.match(/(?:заметка|примечание)\s*:?\s*(.*)$/iu)?.[1]?.trim() || "";
  const org = text.match(/(?:организация|орг)\s*:?\s*(.*?)(?=\s+(?:заметка|телефон|email|почта|должность)\s*:|$)/iu)?.[1]?.trim() || "";
  const title = text.match(/(?:должность)\s*:?\s*(.*?)(?=\s+(?:заметка|телефон|email|почта|организация)\s*:|$)/iu)?.[1]?.trim() || "";
  const rawName = (nameMatch?.[1] || text.replace(email, " ").replace(phone, " "))
    .replace(/\b(?:email|e-mail|почта|телефон|номер|адрес|заметка|организация|должность)\b[\s\S]*$/iu, "")
    .trim();
  return {
    name: cleanupYandexContactQuery(rawName),
    email,
    phone,
    address,
    note,
    org,
    title,
  };
}

function cleanupYandexContactActionQuery(question) {
  const stopWords = new Set([
    "и", "к", "ко", "с", "со", "у", "для", "из", "на", "в", "во", "сегодня", "завтра", "послезавтра", "час", "часа", "часов", "день", "дня", "рождения", "рождение", "дату", "дата", "диске", "облаке", "контакт", "контакта", "контакту", "контактом", "адресная", "книга", "создай", "сделай",
    "добавь", "добавить", "запиши", "сохрани", "удали", "удалить", "папку", "папка", "отправь", "пошли",
    "напиши", "письмо", "сообщение", "ссылку", "ссылка", "qr", "qr-код", "диск", "яндекс", "телемост",
    "встречу", "встреча", "событие", "календарь", "телефон", "номер", "адрес", "заметка", "заметку", "комментарий",
    "примечание", "тема", "текст",
  ]);
  return String(question || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/(?:\+?\d[\d\s()\-]{6,}\d)/gu, " ")
    .replace(/\/[^\s"»]+/gu, " ")
    .replace(/[,:;.!?«»"()]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token && !stopWords.has(token.toLocaleLowerCase("ru-RU")))
    .join(" ")
    .trim();
}

function formatYandexMailSummary(row) {
  return `#${row.uid} ${row.subject || "(без темы)"}${row.from ? `, от ${row.from}` : ""}${row.date ? `, ${row.date}` : ""}`;
}

function formatYandexMailRead(row) {
  const body = String(row.snippet || "").trim();
  return [
    `Письмо #${row.uid}`,
    `От: ${row.from || "-"}`,
    `Тема: ${row.subject || "(без темы)"}`,
    row.date ? `Дата: ${row.date}` : "",
    "",
    body ? `Текст: ${body.slice(0, 2000)}` : "Текст письма пустой или не распознан.",
  ].filter((line) => line !== "").join("\n");
}

function slugForFile(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "item";
}

function extractDisplayName(value) {
  const text = decodeMimeHeader(String(value || "").trim());
  return text.match(/^(.+?)\s*<[^<>]+>/u)?.[1]?.replace(/^["']|["']$/g, "").trim() || "";
}

function extractDateTimeFromText(value) {
  const text = String(value || "").toLocaleLowerCase("ru-RU");
  let date = null;
  if (/завтра/u.test(text)) date = new Date(Date.now() + 86400000);
  if (/послезавтра/u.test(text)) date = new Date(Date.now() + 2 * 86400000);
  const explicit = text.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/u);
  if (explicit) {
    const year = explicit[3] ? Number(explicit[3].length === 2 ? `20${explicit[3]}` : explicit[3]) : new Date().getFullYear();
    date = new Date(year, Number(explicit[2]) - 1, Number(explicit[1]), 9, 0, 0);
  }
  const time = text.match(/(?:в\s*)?(\d{1,2})[:.](\d{2})/u) || text.match(/(?:в\s+)(\d{1,2})\s*(?:час|ч\b)?/u);
  if (!date && time) date = new Date();
  if (date && time) {
    date.setHours(Number(time[1]), Number(time[2] || 0), 0, 0);
  }
  if (!date) return {};
  const start = date.toISOString();
  const end = new Date(date.getTime() + 3600000).toISOString();
  const location = extractLikelyAddresses(value)[0] || "";
  return { start, end, location };
}

function extractEducationQueriesFromText(value) {
  const text = String(value || "");
  const queries = [];
  for (const match of text.matchAll(/(?:школ[ауыи]?|сош|гимнази[яи]|лице[йя])\s*№?\s*(\d{1,3})/giu)) queries.push(`школа ${match[1]}`);
  for (const match of text.matchAll(/(?:детск\w*\s+сад|детсад|садик)\s*№?\s*(\d{1,3})/giu)) queries.push(`детский сад ${match[1]}`);
  for (const match of text.matchAll(/\bинн\s*(\d{10,12})\b/giu)) queries.push(match[1]);
  return [...new Set(queries)];
}

function extractLikelyAddresses(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  const rows = [];
  const patterns = [
    /(?:адрес|по адресу|место)\s*:?\s*([^.!?\n]{8,120})/giu,
    /((?:ул\.?|улица|проспект|пр-т|бульвар|пер\.?|переулок)\s+[^.!?\n,]{3,80}(?:,\s*(?:д\.?\s*)?\d+[а-яa-z]?)?)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const address = String(match[1] || "").trim().replace(/[;,]+$/u, "");
      if (address.length >= 8 && !/https?:|www\.|@/iu.test(address) && /(ул\.?|улица|проспект|пр-т|бульвар|пер\.?|переулок|дом|д\.|\d)/iu.test(address)) rows.push(address);
    }
  }
  return [...new Set(rows)].slice(0, 10);
}

function dedupeBy(rows, keyFn) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

async function buildCloudDirectAnswer(question) {
  if (!isCloudQuestion(question)) return "";
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  try {
    const provider = await getCloudProvider();
    if (provider === "yandex-disk" && /(документ|docs|360)/iu.test(normalized)) {
      if (/(ссылк|поделись|опубликуй|qr|qr-код)/iu.test(normalized)) {
        const result = await yandexDocsShare(extractCloudPath(question) || cleanupCloudQuery(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(создай|сделай|запиши|сохрани)/iu.test(normalized)) {
        const text = extractShareMessage(question) || cleanupCloudSaveText(question);
        if (!text) return "Укажите текст документа.";
        const result = await yandexDocsCreateText({ title: extractYandexDocTitle(question), text, confirm: true });
        return `Документ создан на Яндекс Диске: ${result.remote}.`;
      }
      if (/(прочитай|открой|покажи\s+текст)/iu.test(normalized)) {
        const result = await yandexDocsRead(extractCloudPath(question) || cleanupCloudQuery(question), {});
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(переимен|rename)/iu.test(normalized)) {
        const result = await yandexDocsRename(extractCloudPath(question) || cleanupCloudQuery(question), extractCloudNewName(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(удали|удалить)/iu.test(normalized)) {
        const result = await yandexDocsDelete(extractCloudPath(question) || cleanupCloudQuery(question), { confirm: true });
        return formatToolResult({ rows: [result], outputs: [] }, {});
      }
      if (/(найди|поиск)/iu.test(normalized)) {
        const rows = await yandexDocsFind(cleanupCloudQuery(question), { limit: 20 });
        if (!rows.length) return "Документы на Яндекс Диске не найдены.";
        return ["Документы на Яндекс Диске:", ...rows.map((row, index) => `${index + 1}. ${row.name} — ${row.path}`)].join("\n");
      }
      const rows = await yandexDocsList({ limit: 20 });
      if (!rows.length) return "Документы на Яндекс Диске не найдены.";
      return ["Документы на Яндекс Диске:", ...rows.map((row, index) => `${index + 1}. ${row.name} — ${row.path}`)].join("\n");
    }
    if (provider === "yandex-disk" && /(мест[оа]|сколько.*занято|сколько.*свобод|инфо|статус)/iu.test(normalized)) {
      const info = await yandexDiskInfo();
      return [
        "Яндекс Диск:",
        `Занято: ${formatBytes(info.usedSpace)} из ${formatBytes(info.totalSpace)}.`,
        `Корзина: ${formatBytes(info.trashSize)}.`,
      ].join("\n");
    }
    if (provider === "yandex-disk" && /(перенеси|перемести|скопируй|копир).{0,80}(из|с).{0,30}папк/iu.test(normalized) && /(ссылк|qr|qr-код|почт|email|контакт|@)/iu.test(normalized)) {
      const packageRequest = parseYandexDiskPackageRequest(question);
      if (!packageRequest.sourcePath || !packageRequest.targetFolder) return "Укажите исходную и целевую папку на Яндекс Диске.";
      if (!packageRequest.email && !packageRequest.contact) return "Укажите email или контакт, кому отправить ссылку.";
      const result = await yandexDiskPackageShareEmail({
        ...packageRequest,
        confirm: true,
      });
      return [
        `${result.mode === "move" ? "Перенес" : "Скопировал"} объектов: ${result.transferred}.`,
        `Папка: ${result.targetFolder}`,
        `Отправил: ${result.to.join(", ")}.`,
        `Ссылка: ${result.publicUrl}`,
        `QR-код: ${result.qrPublicUrl}`,
      ].join("\n");
    }
    if (provider === "yandex-disk" && /(корзин|удаленн|удалённ)/iu.test(normalized) && /(покажи|список|что|есть)/iu.test(normalized)) {
      const rows = await yandexDiskTrashList("", { limit: 20 });
      if (!rows.length) return "Корзина Яндекс Диска пуста.";
      return ["Корзина Яндекс Диска:", ...rows.map((row, index) => `${index + 1}. ${row.type === "dir" ? "папка" : "файл"} ${row.name} — ${row.path}`)].join("\n");
    }
    if (provider === "yandex-disk" && /(есть\s+ли|существует|проверь).{0,40}(файл|папк|\/)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу или папке на Яндекс Диске.";
      const result = await yandexDiskExists(normalizeCloudUserPath(remotePath, provider));
      return result.exists ? `На Яндекс Диске найдено: ${result.path} (${result.type}).` : `На Яндекс Диске не найдено: ${result.path}.`;
    }
    if (provider === "yandex-disk" && /(свойств|карточк|метадан|размер|информац).{0,40}(файл|папк|\/)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу или папке на Яндекс Диске.";
      const result = await yandexDiskStat(normalizeCloudUserPath(remotePath, provider));
      return [
        `${result.type === "dir" ? "Папка" : "Файл"}: ${result.name}`,
        `Путь: ${result.path}`,
        `Размер: ${formatBytes(result.size)}`,
        result.modified ? `Изменен: ${result.modified}` : "",
        result.mimeType ? `Тип: ${result.mimeType}` : "",
        result.publicUrl ? `Публичная ссылка: ${result.publicUrl}` : "",
      ].filter(Boolean).join("\n");
    }
    if (provider === "yandex-disk" && /(очисти|очистить).{0,30}корзин/iu.test(normalized)) {
      const result = await yandexDiskEmptyTrash({ confirm: true });
      return `Очистка корзины запрошена: ${result.remote}.`;
    }
    if (provider === "yandex-disk" && /(восстанов|верни).{0,40}(корзин|диск|файл|папк)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь объекта в корзине Яндекс Диска.";
      const result = await yandexDiskRestore(normalizeCloudUserPath(remotePath, provider), { confirm: true });
      return `Восстановил из корзины: ${result.remote}.`;
    }
    if (/(созда|сдела|добав).{0,30}(папк|директор)/iu.test(normalized) || /(папк|директор).{0,30}(созда|сдела|добав)/iu.test(normalized)) {
      const folderName = extractCloudFolderName(question) || "Новая папка";
      const remotePath = normalizeCloudUserPath(folderName, provider);
      const result = await cloudCreateFolder(provider, remotePath);
      return `Папка создана или уже была на облачном диске: ${result.path}`;
    }

    if (/(покажи|список|что.+лежит|файлы|папки)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question) || cloudRootForProvider(provider);
      const rows = await cloudList(provider, normalizeCloudUserPath(remotePath, provider));
      if (rows.length === 0) return `В папке ${normalizeCloudUserPath(remotePath, provider)} нет данных.`;
      return [
        `Облачный диск ${provider}, папка ${normalizeCloudUserPath(remotePath, provider)}:`,
        ...rows.slice(0, 20).map((row, index) => `${index + 1}. ${row.type === "dir" ? "папка" : "файл"} ${row.name} — ${row.path}`),
      ].join("\n");
    }

    if (/(найди|поиск|где лежит)/iu.test(normalized)) {
      const query = cleanupCloudQuery(question);
      const rows = await cloudFind(provider, query, { path: cloudRootForProvider(provider), limit: 10 });
      if (rows.length === 0) return `На облачном диске не нашел: ${query}`;
      return [
        `Нашел на облачном диске ${provider}:`,
        ...rows.map((row, index) => `${index + 1}. ${row.name} — ${row.path}`),
      ].join("\n");
    }

    if (provider === "yandex-disk" && /(сними|убери|закрой).{0,30}(ссылк|публик)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу или папке на Яндекс Диске.";
      const result = await yandexDiskUnshare(normalizeCloudUserPath(remotePath, provider));
      return `Публичная ссылка снята: ${result.remote}.`;
    }

    if (provider === "yandex-disk" && /(отправь|отправить|пошли|перешли).{0,80}(ссылк|qr|qr-код|код)/iu.test(normalized) && /(почт|email|e-mail|контакт|@)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу или папке на Яндекс Диске.";
      const recipient = extractShareRecipient(question);
      if (!recipient.email && !recipient.contact) return "Укажите email или имя контакта, кому отправить ссылку.";
      const result = await yandexDiskShareEmail({
        remotePath: normalizeCloudUserPath(remotePath, provider),
        to: recipient.email,
        contact: recipient.contact,
        subject: extractMailSubject(question) || "",
        text: extractShareMessage(question) || "",
        confirm: true,
      });
      return [
        `Отправил ссылку на Яндекс Диск: ${result.to.join(", ")}.`,
        `Ссылка: ${result.publicUrl}`,
        `QR-код: ${result.qrPublicUrl}`,
      ].join("\n");
    }

    if (/(ссылк|поделись|опубликуй)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу на облачном диске, например: /IOLA/reports/report.md";
      const withQr = provider === "yandex-disk" && /(qr|qr-код|код)/iu.test(normalized);
      const result = withQr
        ? await yandexDiskShareWithQr(normalizeCloudUserPath(remotePath, provider), { confirm: true })
        : await cloudShare(provider, normalizeCloudUserPath(remotePath, provider));
      return withQr
        ? `Публичная ссылка: ${result.publicUrl}\nQR-код: ${result.qrPublicUrl}`
        : `Публичная ссылка: ${result.publicUrl}`;
    }

    if (provider === "yandex-disk" && /(прочитай|открой|покажи содержим|текст)/iu.test(normalized) && /(файл|\.txt|\.md|\.json|\.csv)/iu.test(normalized) && !/(сохрани|запиши)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к текстовому файлу на Яндекс Диске.";
      const result = await yandexDiskReadText(normalizeCloudUserPath(remotePath, provider));
      return [`Файл ${result.remote}:`, result.text.slice(0, 4000)].join("\n");
    }

    if (provider === "yandex-disk" && /(скачай|загрузи\s+с\s+диска|сохрани\s+на\s+комп)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу на Яндекс Диске.";
      const outputPath = extractLocalOutputPath(question) || path.basename(remotePath);
      const result = await yandexDiskDownload(normalizeCloudUserPath(remotePath, provider), outputPath);
      return `Скачал файл с Яндекс Диска: ${result.local}`;
    }

    if (provider === "yandex-disk" && /(загрузи|отправь|положи).{0,40}(на яндекс.?диск|на диск|в облак)/iu.test(normalized)) {
      const localPath = extractLocalInputPath(question);
      if (!localPath) return "Укажите локальный путь к файлу для загрузки на Яндекс Диск.";
      const remotePath = extractCloudPath(question) || `${cloudRootForProvider(provider)}/${path.basename(localPath)}`;
      const result = await yandexDiskUpload(localPath, normalizeCloudUserPath(remotePath, provider), { overwrite: true });
      return `Загрузил файл на Яндекс Диск: ${result.remote}`;
    }

    if (provider === "yandex-disk" && /(?:^|\s)(?:переименуй|переименовать|переименовать|rename)(?:\s|$)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      const newName = extractCloudNewName(question);
      if (!remotePath || !newName) return "Укажите путь и новое имя. Пример: переименуй /IOLA/a.txt в b.txt на Яндекс Диске.";
      const result = await yandexDiskRename(normalizeCloudUserPath(remotePath, provider), newName, { confirm: true, overwrite: true });
      return `Переименовал на Яндекс Диске: ${result.from} -> ${result.remote}`;
    }

    if (provider === "yandex-disk" && /(перемести|move)/iu.test(normalized)) {
      const { from, to } = extractCloudTwoPaths(question);
      if (!from || !to) return "Укажите откуда и куда переместить на Яндекс Диске.";
      const result = await yandexDiskMove(normalizeCloudUserPath(from, provider), normalizeCloudUserPath(to, provider), { confirm: true, overwrite: true });
      return `Переместил на Яндекс Диске: ${result.from} -> ${result.remote}`;
    }

    if (provider === "yandex-disk" && /(скопируй|копир|copy)/iu.test(normalized)) {
      const { from, to } = extractCloudTwoPaths(question);
      if (!from || !to) return "Укажите откуда и куда скопировать на Яндекс Диске.";
      const result = await yandexDiskCopy(normalizeCloudUserPath(from, provider), normalizeCloudUserPath(to, provider), { confirm: true, overwrite: true });
      return `Скопировал на Яндекс Диске: ${result.from} -> ${result.remote}`;
    }

    if (provider === "yandex-disk" && /(удали|удалить|перемести.*корзин)/iu.test(normalized)) {
      const remotePath = extractCloudPath(question);
      if (!remotePath) return "Укажите путь к файлу или папке на Яндекс Диске.";
      const result = await yandexDiskDelete(normalizeCloudUserPath(remotePath, provider), { confirm: true, permanently: /навсегда|окончательно|безвозвратно/iu.test(normalized) });
      return `Удалил на Яндекс Диске: ${result.remote} (${result.status}).`;
    }

    if (/(сохрани|запиши).{0,40}(на яндекс диске|в облак|на диск)/iu.test(normalized)) {
      const text = cleanupCloudSaveText(question);
      if (!text) return "Что сохранить на облачный диск?";
      const remotePath = extractCloudPath(question) || `${cloudRootForProvider(provider)}/notes/iola-${timestampForFile()}.txt`;
      const tempPath = path.join(CONFIG_DIR, `cloud-save-${Date.now()}.txt`);
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(tempPath, text, "utf8");
      try {
        await cloudUpload(provider, tempPath, remotePath, { overwrite: true });
      } finally {
        await rm(tempPath, { force: true }).catch(() => {});
      }
      return `Сохранил текст на облачный диск: ${remotePath}`;
    }
  } catch (error) {
    return `Не смог выполнить облачный запрос: ${error instanceof Error ? error.message : String(error)}`;
  }
  return "";
}

function isCloudQuestion(question) {
  return /(\/IOLA\/|яндекс.?диск|yandex.?disk|облак|облачн|на диск|с диска|в диск|cloud|mail\.?ru|публичн.*ссылк|поделиться.*файл|qr-код|qr\s+код)/iu.test(String(question || ""));
}

function normalizeCloudUserPath(value, provider = "yandex-disk") {
  const root = cloudRootForProvider(provider);
  let text = String(value || "").trim().replace(/\\/g, "/");
  text = text.replace(/^["'«»]+|["'«»]+$/gu, "").trim();
  if (!text) return root;
  if (text.startsWith("/")) return text;
  if (normalizeGeoText(text).startsWith(normalizeGeoText(root).replace(/^\//u, ""))) return `/${text.replace(/^\/+/u, "")}`;
  return `${root.replace(/\/+$/u, "")}/${text.replace(/^\/+/u, "")}`;
}

function extractCloudFolderName(question) {
  const text = String(question || "").trim();
  const match = text.match(/(?:папк[ауи]?|директор(?:ию|ия|ии)?)\s+["'«]?([^"'».,!?]+)["'»]?/iu)
    || text.match(/(?:названи(?:ем|е)|имя)\s+["'«]?([^"'».,!?]+)["'»]?/iu);
  if (!match?.[1]) return "";
  return cleanupCloudObjectName(match[1]);
}

function extractCloudPath(question) {
  const text = String(question || "").trim();
  const quoted = text.match(/["«]([^"»]+)["»]/u);
  if (quoted?.[1]) return cleanupCloudPathCandidate(quoted[1]);
  const iolaPath = text.match(/(?:^|\s)(\/IOLA\/.+)$/iu)?.[1];
  if (iolaPath) return cleanupCloudPathCandidate(iolaPath);
  const pathMatch = text.match(/(?:^|\s)(\/IOLA\/[^\s]+|\/[^\s]+)/iu);
  if (pathMatch?.[1]) return cleanupCloudPathCandidate(pathMatch[1]);
  const afterFolder = text.match(/(?:папк[аеуы]?|файл[ае]?)\s+([^,.!?]+)/iu);
  return afterFolder?.[1] ? cleanupCloudObjectName(afterFolder[1]) : "";
}

function cleanupCloudPathCandidate(value) {
  return String(value || "")
    .replace(/\s+(?:по\s+почт[еуы]|на\s+почт[уые]|контакту|получател[юя]|кому|с\s+темой|тема\s*:|текст\s*:).*$/iu, "")
    .replace(/\s+(?:на\s+яндекс.?диск(?:е)?|на\s+диск(?:е)?|в\s+облак(?:е|о)?).*/iu, "")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function extractCloudTwoPaths(question) {
  const text = String(question || "").trim();
  const quoted = [...text.matchAll(/["«]([^"»]+)["»]/gu)].map((match) => match[1]).filter(Boolean);
  if (quoted.length >= 2) return { from: quoted[0], to: quoted[1] };
  const paths = [...text.matchAll(/(?:^|\s)(\/[^\s,;]+)/gu)].map((match) => match[1]).filter(Boolean);
  if (paths.length >= 2) return { from: paths[0], to: paths[1] };
  const match = text.match(/(?:из|с|откуда)\s+(.+?)\s+(?:в|на|куда)\s+(.+?)(?:\s+на\s+яндекс|\s+на\s+диск|\s+в\s+облак|$)/iu)
    || text.match(/(?:перемести|скопируй|копируй|copy|move)\s+(.+?)\s+(?:в|на|куда)\s+(.+?)(?:\s+на\s+яндекс|\s+на\s+диск|\s+в\s+облак|$)/iu);
  return match ? { from: cleanupCloudObjectName(match[1]), to: cleanupCloudObjectName(match[2]) } : { from: "", to: "" };
}

function extractCloudNewName(question) {
  const text = String(question || "").trim();
  return text.match(/(?:в|на|как)\s+["«]?([^"».,!?/\\]+(?:\.[a-z0-9а-яё]+)?)["»]?\s*(?:на\s+яндекс|на\s+диск|в\s+облак|$)/iu)?.[1]?.trim()
    || text.match(/(?:нов(?:ое|ый|ым)?\s+им(?:я|енем)|названи(?:е|ем))\s+["«]?([^"».,!?/\\]+)["»]?/iu)?.[1]?.trim()
    || "";
}

function extractLocalInputPath(question) {
  const text = String(question || "").trim();
  const quoted = [...text.matchAll(/["«]([^"»]+)["»]/gu)].map((match) => match[1]).find((item) => /^[a-z]:[\\/]|\.{0,2}[\\/]/iu.test(item));
  if (quoted) return quoted;
  return text.match(/([a-z]:[\\/][^"»\s]+|\.\.?[\\/][^"»\s]+)/iu)?.[1] || "";
}

function extractLocalOutputPath(question) {
  const text = String(question || "").trim();
  return text.match(/(?:в|на|как|куда)\s+([a-z]:[\\/][^"»\s]+|\.\.?[\\/][^"»\s]+)/iu)?.[1] || "";
}

function extractShareRecipient(question) {
  const text = String(question || "");
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
  if (email) return { email, contact: "" };
  const contact = text.match(/(?:контакт[ау]?|получател[юя]|кому|для|почт[уе])\s+["«]?([^"».,;!?@]+)["»]?/iu)?.[1]
    || text.match(/(?:отправь|отправить|пошли|перешли)\s+([^"».,;!?@]+?)\s+(?:ссылк|qr|qr-код|код)/iu)?.[1]
    || "";
  return { email: "", contact: cleanupYandexContactQuery(contact) };
}

function extractMailSubject(question) {
  return String(question || "").match(/(?:тема|subject)\s*:\s*(.*?)(?=\s+(?:текст|сообщение|body)\s*:|$)/iu)?.[1]?.trim() || "";
}

function extractShareMessage(question) {
  return String(question || "").match(/(?:текст|text|сообщение|body)\s*:\s*(.*)$/iu)?.[1]?.trim() || "";
}

function extractYandexDocTitle(question) {
  const text = String(question || "");
  const raw = text.match(/(?:названи(?:е|ем)|имя|title)\s*:?\s*["«]?([^"».,:;]+)["»]?/iu)?.[1]?.trim()
    || text.match(/(?:документ|файл)\s+["«]?([^"».,:;]+)["»]?/iu)?.[1]?.trim()
    || "";
  return raw.replace(/\s+(?:текст|text|body|сообщение)\s*:?.*$/iu, "").trim();
}

function extractCalendarTitle(question) {
  const text = String(question || "");
  const raw = text.match(/(?:тема|названи(?:е|ем)|title)\s*:?\s*["«]?([^"».,:;]+)["»]?/iu)?.[1]?.trim()
    || text.match(/(?:событи[ея]|встреч[ауи]|телемост)\s+["«]?([^"».,:;]+)["»]?/iu)?.[1]?.trim()
    || "";
  return raw
    .replace(/\s+(?:сегодня|завтра|послезавтра)(?:\s|$).*$/iu, "")
    .replace(/\s+(?:в\s+\d{1,2}(?::\d{2})?|на\s+\d{1,2}[.\-/]\d{1,2}[\d.\-/]*)(?:\s|$).*$/iu, "")
    .trim();
}

function extractCalendarRepeat(question) {
  const text = String(question || "").toLocaleLowerCase("ru-RU");
  const count = Number(text.match(/(\d+)\s*(?:раз|повтор)/iu)?.[1] || 0);
  return {
    repeat: /ежеднев|каждый\s+день/iu.test(text) ? "daily"
      : /ежемесяч|каждый\s+месяц/iu.test(text) ? "monthly"
        : /ежегод|каждый\s+год/iu.test(text) ? "yearly"
          : "weekly",
    count: count || undefined,
  };
}

function cleanupCalendarEventQuery(question) {
  return String(question || "")
    .replace(/(?:создай|добавь|запланируй|назначь|перенеси|перемести|измени|смени|удали|удалить|отмени|отменить|найди|поиск|покажи|добавь\s+напоминание|поставь\s+напоминание)/giu, " ")
    .replace(/(?:^|\s)(?:событи\p{L}*|встреч\p{L}*|телемост\p{L}*|календар\p{L}*|напомин\p{L}*|уведом\p{L}*|яндекс|на|к|ко|в|во|сегодня|завтра|послезавтра|час|часа|часов|минут|минуты)(?=\s|$)/giu, " ")
    .replace(/\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?/gu, " ")
    .replace(/\d{1,2}[:.]\d{2}/gu, " ")
    .replace(/(?:^|\s)\d{1,3}(?=\s|$)/gu, " ")
    .replace(/[,:;.!?«»"()]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYandexDiskPackageRequest(question) {
  const text = String(question || "").trim();
  const quoted = [...text.matchAll(/["«]([^"»]+)["»]/gu)].map((match) => match[1]);
  const paths = [...text.matchAll(/(?:^|\s)(\/[^\s,;]+)/gu)].map((match) => match[1]);
  const sourcePath = text.match(/(?:из|с)\s+папк[иы]?\s+([^,;]+?)(?=\s+(?:создай|сделай|и|отправь|перешли|на\s+яндекс)|[,;]|$)/iu)?.[1]?.trim()
    || quoted[1]
    || paths[1]
    || "";
  const targetFolder = text.match(/(?:создай|сделай)\s+папк[уи]?\s+([^,;]+?)(?=\s+(?:на\s+яндекс|и|,|$)|[,;]|$)/iu)?.[1]?.trim()
    || text.match(/(?:в|куда|целев\w*)\s+папк[уи]?\s+([^,;]+?)(?=\s+(?:на\s+яндекс|и|,|$))/iu)?.[1]?.trim()
    || quoted[0]
    || paths[0]
    || "";
  const recipient = extractShareRecipient(question);
  return {
    sourcePath: normalizeCloudUserPath(cleanupCloudObjectName(sourcePath), "yandex-disk"),
    targetFolder: normalizeCloudUserPath(cleanupCloudObjectName(targetFolder), "yandex-disk"),
    mode: /(перенеси|перемести|move)/iu.test(text) ? "move" : "copy",
    email: recipient.email,
    contact: recipient.contact,
    subject: extractMailSubject(question),
    text: extractShareMessage(question),
  };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function cleanupCloudObjectName(value) {
  return String(value || "")
    .replace(/\s+(?:на\s+яндекс.?диск(?:е)?|на\s+диск(?:е)?|в\s+облак(?:е|о)?).*/iu, " ")
    .replace(/\b(?:на|в|у меня|яндекс.?диск(?:е)?|диск(?:е)?|облак(?:е|о)?|создай|сделай|добавь|покажи)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupCloudQuery(question) {
  return String(question || "")
    .replace(/яндекс\s+диск(?:е)?/giu, " ")
    .replace(/(?:найди|поиск|где лежит|на|в|яндекс|облак(?:е|о)?|диск(?:е)?|файл|документ)/giu, " ")
    .replace(/[?.!]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupCloudSaveText(question) {
  return String(question || "")
    .replace(/^.*?(?:сохрани|запиши)\s+/iu, "")
    .replace(/\s+(?:в|на|как)\s+\/[^\s]+/giu, " ")
    .replace(/\s+(?:на яндекс диске|в облак[ео]|на диск).*$/iu, "")
    .trim();
}

function detectDirectDataFields(normalizedQuestion) {
  const fields = [];
  if (/(директ|руководител|заведующ|кто возглавляет)/iu.test(normalizedQuestion)) fields.push("head");
  if (/(сайт|website|url|ссылка)/iu.test(normalizedQuestion)) fields.push("website");
  if (/(телефон|номер телефона|позвонить)/iu.test(normalizedQuestion)) fields.push("phone");
  if (/(почт|email|e-mail|имейл|электронн)/iu.test(normalizedQuestion)) fields.push("email");
  if (/(адрес|где находится|расположен)/iu.test(normalizedQuestion)) fields.push("address");
  if (/(инн)/iu.test(normalizedQuestion)) fields.push("inn");
  if (/(лиценз)/iu.test(normalizedQuestion)) fields.push("license");
  return [...new Set(fields)];
}

async function buildDeterministicEducationAnswer(question, requestedFields) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  const layer = /(сад|детсад|детск\w*\s+сад|садик)/iu.test(normalized)
    ? "kindergartens"
    : /(школ|сош|лице|гимнази)/iu.test(normalized)
      ? "schools"
      : "";
  if (!layer) return "";

  const requests = extractEducationFactRequests(question, requestedFields, layer);
  if (requests.length === 0) return "";

  const items = normalizeItems(await fetchAllApiItems(`${await getApiBaseUrl()}/${DATASETS[layer].endpoint}`))
    .map((item) => ({ layer, layerName: layer === "schools" ? "школы" : "детские сады", ...selectPublicSummary(item) }));
  const answers = [];

  for (const request of requests) {
    const answer = resolveEducationFactRequest(request, items, layer);
    if (answer) answers.push(answer);
  }

  return answers.filter(Boolean).join("\n");
}

function extractEducationFactRequests(question, requestedFields, layer) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  const segments = splitEducationQuestionSegments(question);
  const requests = [];

  for (const segment of segments) {
    const segmentFields = detectDirectDataFields(segment.toLocaleLowerCase("ru-RU"));
    const fields = segmentFields.length > 0 ? segmentFields : (segments.length === 1 ? requestedFields : []);
    if (fields.length === 0) continue;
    const place = detectEducationPlace(segment) || detectEducationPlace(question);
    const number = extractEntityNumberFromQuestion(segment, layer)
      || (segments.length === 1 ? extractEntityNumberFromQuestion(question, layer) : "");
    const hasEntitySignal = Boolean(number || place || /(школ|сош|лице|гимнази|сад|детсад|детск\w*\s+сад|садик)/iu.test(segment));
    if (!hasEntitySignal) continue;
    requests.push({ segment, fields, number, place });
  }

  if (requests.length === 0 && requestedFields.length > 0 && /(школ|сош|лице|гимнази|сад|детсад|детск\w*\s+сад|садик)/iu.test(normalized)) {
    requests.push({
      segment: question,
      fields: requestedFields,
      number: extractEntityNumberFromQuestion(question, layer),
      place: detectEducationPlace(question),
    });
  }

  return requests;
}

function splitEducationQuestionSegments(question) {
  const text = String(question || "").trim();
  if (!text) return [];
  return text
    .split(/\s+(?:и|а также|,|;)\s+(?=(?:кто|какой|какая|адрес|телефон|инн|сайт|почт|email|директ|руковод|завед|где))/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectEducationPlace(text) {
  const normalized = normalizeEntityText(text || "");
  if (/(козьмодемьянск|козьмодемьянск[аеуом]?|козьмодемьянск\w*)/iu.test(normalized)) {
    return { id: "kozmodemyansk", label: "Козьмодемьянск", locative: "Козьмодемьянске", supported: false, aliases: ["козьмодемьянск", "козмодемьянск"] };
  }
  if (/(семеновк|семёновк)/iu.test(normalized)) {
    return { id: "semenovka", label: "Семёновка", locative: "Семёновке", supported: true, aliases: ["семеновк", "семёновк"] };
  }
  if (/(йошкар|йошкар-ола|йошкар ола)/iu.test(normalized)) {
    return { id: "yoshkar_ola", label: "Йошкар-Ола", locative: "Йошкар-Оле", supported: true, aliases: ["йошкар", "йошкар-ола", "йошкар ола"] };
  }
  return null;
}

function resolveEducationFactRequest(request, items, layer) {
  const entityLabel = layer === "schools" ? "школу" : "детский сад";
  if (request.place && !request.place.supported) {
    return `В текущих открытых данных iola-cli есть данные городского округа Йошкар-Ола. Данных по ${request.place.locative || request.place.label} в этом слое нет, поэтому ответить по этому объекту не могу.`;
  }

  let candidates = items;
  if (request.place) {
    candidates = candidates.filter((item) => itemMatchesPlace(item, request.place));
  }

  if (request.number) {
    const exactByNumber = candidates.filter((item) => itemNameHasNumber(item, request.number));
    if (exactByNumber.length === 0) {
      if (request.place && candidates.length > 0) {
        return [
          `Точную ${entityLabel} № ${request.number} в ${request.place.locative || request.place.label} в открытом слое не нашел.`,
          `В ${request.place.locative || request.place.label} есть:`,
          ...candidates.slice(0, 5).map((item) => `- ${getDirectDataItemName(item)}${item.address ? `; адрес: ${item.address}` : ""}${item.inn ? `; ИНН ${item.inn}` : ""}`),
        ].join("\n");
      }
      return `В открытом слое не нашел ${entityLabel} № ${request.number}.`;
    }
    candidates = exactByNumber;
  }

  if (candidates.length === 0) {
    const placeText = request.place ? ` в ${request.place.locative || request.place.label}` : "";
    return `В открытом слое не нашел ${entityLabel}${placeText}.`;
  }

  if (candidates.length > 1 && !request.number) {
    return [
      `Нашел несколько подходящих записей${request.place ? ` для ${request.place.locative || request.place.label}` : ""}:`,
      ...candidates.slice(0, 5).flatMap((item) => [
        `- ${getDirectDataItemName(item)}`,
        ...request.fields.map((field) => `  ${formatDirectDataField(field, item)}`).filter(Boolean),
        `  Источник: слой ${item.layer}, ИНН ${item.inn || "-"}.`,
      ]),
    ].join("\n");
  }

  const item = candidates[0];
  const lines = request.fields.map((field) => formatDirectDataField(field, item)).filter(Boolean);
  if (lines.length === 0) return "";
  return [
    ...lines,
    `Источник: слой ${item.layer}, ${getDirectDataItemName(item)}, ИНН ${item.inn || "-"}.`,
  ].join("\n");
}

function itemMatchesPlace(item, place) {
  if (!place) return true;
  const text = normalizeEntityText(`${item.name || ""} ${item.address || ""} ${item.legal_address || ""} ${item.fns_full_name || ""} ${item.fns_short_name || ""}`);
  if (place.id === "yoshkar_ola") return /йошкар|йошкар-ола|йошкар ола/u.test(text) && !/семеновк/u.test(text);
  return place.aliases.some((alias) => text.includes(normalizeEntityText(alias)));
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
    aiRelayBaseUrl: options["relay-url"] || activeProfile.aiRelayBaseUrl || config.api?.aiRelayBaseUrl || AI_RELAY_BASE_URL,
    networkMode: options["network-mode"] || activeProfile.networkMode,
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
  const casualAnswer = buildCasualDirectAnswer(question);
  if (casualAnswer) {
    if (!options.quiet) console.log(casualAnswer);
    return casualAnswer;
  }
  const userSkillAnswer = await buildUserSkillDirectAnswer(question);
  if (userSkillAnswer) {
    if (!options.quiet) console.log(userSkillAnswer);
    return userSkillAnswer;
  }
  if (/(контакт|адресн)/iu.test(question) && !isExplicitYandexDiskPathDelete(question)) {
    const yandexContactAnswer = await buildYandexDirectAnswer(question, []);
    if (yandexContactAnswer) {
      if (!options.quiet) console.log(yandexContactAnswer);
      return yandexContactAnswer;
    }
  }
  const cloudAnswer = await buildCloudDirectAnswer(question);
  if (cloudAnswer) {
    if (!options.quiet) console.log(cloudAnswer);
    return cloudAnswer;
  }
  const yandexAnswer = await buildYandexDirectAnswer(question, []);
  if (yandexAnswer) {
    if (!options.quiet) console.log(yandexAnswer);
    return yandexAnswer;
  }
  const geoAnswer = await buildGeoDirectAnswer(question);
  if (geoAnswer) {
    if (!options.quiet) console.log(geoAnswer);
    return geoAnswer;
  }
  await ensureLocalData();
  const personRoleAnswer = buildPersonRoleDirectAnswer(question);
  if (personRoleAnswer) {
    if (!options.quiet) console.log(personRoleAnswer);
    return personRoleAnswer;
  }
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
  let result;
  try {
    result = await executeToolPlan(validated, { ...options, runId });
  } catch (error) {
    const friendlyError = formatToolExecutionError(error, validated);
    if (!friendlyError) throw error;
    if (!options.quiet) console.log(friendlyError);
    return friendlyError;
  }
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
    if (!options.quiet) printAiAnswer(answer);
  }
  return answer;
}

function guardNonPublicQuestion(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  if (isDangerousInstructionQuestion(normalized)) {
    return "Не могу помогать с созданием оружия, взрывчатых веществ или инструкциями по причинению вреда.";
  }
  if (/(зарплат|получа[ею]т|доход|домашн|паспорт|снилс|личн|персональн)/iu.test(normalized)) {
    return "Это поле не входит в открытые публичные данные.";
  }
  if (isUnsupportedPublicEntityQuestion(normalized)) {
    return "Сейчас в открытых слоях CLI подключены школы и детские сады. По музеям, маршрутам, больницам и другим организациям я пока не могу давать проверяемые ответы.";
  }
  return "";
}

function isDangerousInstructionQuestion(normalized) {
  const asksHow = /(как|сдела|собра|изготов|созда|надо|нужн|инструкц|рецепт|схем|компонент)/iu.test(normalized);
  const weapon = /(бомб|взрывчат|взрывн|детонатор|термит|напалм|оруж|патрон|яд|отрав|боеприпас|мина|гранат)/iu.test(normalized);
  const nuclear = /(атомн|ядерн|уран|плутони|обогащен)/iu.test(normalized) && /(бомб|оруж|собра|сдела|созда|надо|нужн)/iu.test(normalized);
  return (asksHow && weapon) || nuclear;
}

function isUnsupportedPublicEntityQuestion(normalized) {
  const unsupportedEntity = /(музе[йяею]|театр|больниц|поликлиник|аптек|магазин|кафе|ресторан|гостиниц|банк|мфц|библиотек|парк|маршрут|остановк)/iu.test(normalized);
  if (!unsupportedEntity) return false;
  const supportedEducation = /(школ|гимнази|лице|детск\w*\s+сад|детсад|садик)/iu.test(normalized);
  if (supportedEducation) return false;
  return /(адрес|где|как пройти|как добраться|директ|руководител|заведующ|телефон|сайт|почт|инн|кто|находится)/iu.test(normalized);
}

function buildCasualDirectAnswer(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU").trim();
  if (isCurrentDateTimeQuestion(normalized)) {
    return formatCurrentDateTimeAnswer(normalized);
  }
  if (/^(кто ты|что ты|какая ты модель|что ты за модель|что за модель|какая модель|назови модель|ты какая модель|ты кто)([?.!\s]*)$/iu.test(normalized)) {
    return "Я IOLA, первая городская модель искусственного интеллекта Йошкар-Олы. Работаю локально в CLI и отвечаю по открытым городским данным через проверяемые слои и API.";
  }
  if (/^(что ты умеешь|что умеешь|что можешь|чем можешь помочь|какие у тебя возможности|твои возможности)([?.!\s]*)$/iu.test(normalized)) {
    return [
      "Я помогаю работать с открытыми городскими данными Йошкар-Олы.",
      "Умею искать школы и детские сады, находить адреса, телефоны, сайты, email и ИНН, проверять сведения через слои данных и API, а также готовить простые списки и выгрузки.",
      "Если данных нет в открытом слое, я скажу об этом прямо.",
    ].join("\n");
  }
  if (/^(привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер|hi|hello|hey)([!.?\s]+(как дела|как ты|что нового)[?.!\s]*)?$/iu.test(normalized)) {
    return "Привет.";
  }
  if (/^(как дела|как ты|что нового|ты тут|ты здесь)[?.!\s]*$/iu.test(normalized)) {
    return "Я на месте.";
  }
  if (/^(спасибо|благодарю)[!.?\s]*$/iu.test(normalized)) {
    return "Пожалуйста.";
  }
  return "";
}

function buildPersonRoleDirectAnswer(question) {
  const normalized = String(question || "").toLocaleLowerCase("ru-RU");
  const asksHead = /(директ|руководител|заведующ|возглавляет)/iu.test(normalized);
  const asksOrganization = /(какой|какая|где|чего|организац|учрежден|школ|сад|детсад|гимнази|лицей)/iu.test(normalized);
  if (!asksHead || !asksOrganization) return "";

  const nameTokens = extractPersonNameTokens(question);
  if (nameTokens.length < 2) return "";

  const dataset = normalized.includes("сад") || normalized.includes("детсад")
    ? "kindergartens"
    : normalized.includes("школ") || normalized.includes("гимнази") || normalized.includes("лицей")
      ? "schools"
      : "all";
  const rows = searchLocalRecords("", { dataset, limit: 10000 })
    .filter((row) => personTokensMatchHead(row.head, nameTokens));

  if (rows.length === 0) {
    return `В открытых данных не нашел руководителя с ФИО: ${formatPersonTokens(nameTokens)}.`;
  }

  const exactRows = rows.filter((row) => personTokensMatchHead(row.head, nameTokens, { strict: true }));
  const matches = exactRows.length > 0 ? exactRows : rows;
  if (matches.length === 1) {
    const row = matches[0];
    return [
      `${row.head} является руководителем: ${row.name}.`,
      row.address ? `Адрес: ${row.address}` : "",
      row.inn ? `ИНН: ${row.inn}` : "",
      "Источник: открытый слой образования.",
    ].filter(Boolean).join("\n");
  }

  return [
    `Нашел несколько организаций для ФИО ${formatPersonTokens(nameTokens)}:`,
    ...matches.slice(0, 10).map((row) => `- ${row.head}: ${row.name}${row.inn ? `, ИНН ${row.inn}` : ""}`),
  ].join("\n");
}

function extractPersonNameTokens(question) {
  const stopWords = new Set([
    "так", "а", "в", "во", "и", "или", "кто", "что", "какой", "какая", "какого", "каком", "какую", "какой-то", "это",
    "директор", "директора", "директором", "руководитель", "руководителем", "заведующая", "заведующий",
    "школа", "школы", "школе", "школу", "сад", "сада", "саду", "детсад", "детсаду", "детский", "детского", "детском", "гимназия", "лицей",
    "является", "возглавляет", "найди", "покажи",
  ]);
  return [...String(question || "").toLocaleLowerCase("ru-RU").matchAll(/\p{L}{2,}/gu)]
    .map((match) => match[0])
    .filter((token) => !stopWords.has(token));
}

function personTokensMatchHead(head, tokens, options = {}) {
  const headTokens = new Set([...String(head || "").toLocaleLowerCase("ru-RU").matchAll(/\p{L}{3,}/gu)].map((match) => match[0]));
  if (options.strict) return tokens.every((token) => headTokens.has(token));
  const headText = [...headTokens].join(" ");
  return tokens.every((token) => headTokens.has(token) || headText.includes(token));
}

function formatPersonTokens(tokens) {
  return tokens.map(capitalizeFirst).join(" ");
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
    "Yandex tools: yandex_identity_me {}, yandex_disk_info {}, yandex_disk_ls {path}, yandex_disk_mkdir {path}, yandex_disk_find {query,path}, yandex_disk_stat {path}, yandex_disk_exists {path}, yandex_disk_read_text {path}, yandex_disk_save_text {path,text}, yandex_disk_upload {localPath,remotePath}, yandex_disk_download {remotePath,outputPath}, yandex_disk_move {from,to,confirm}, yandex_disk_copy {from,to,confirm}, yandex_disk_rename {path,name,confirm}, yandex_disk_share {path,confirm}, yandex_disk_share_qr {path,confirm}, yandex_disk_share_email {path,to,contact,subject,text,confirm}, yandex_disk_package_share_email {sourcePath,targetFolder,to,contact,mode,confirm}, yandex_disk_unshare {path}, yandex_disk_delete {path,confirm}, yandex_disk_trash_list {}, yandex_disk_restore {path,confirm}, yandex_disk_empty_trash {confirm}, yandex_mail_folders {}, yandex_mail_list {mailbox,limit,unread}, yandex_mail_search {mailbox,query}, yandex_mail_read {mailbox,uid}, yandex_mail_mark {mailbox,uid,seen}, yandex_mail_send {to,subject,text,confirm}, yandex_mail_reply {uid,text,confirm}, yandex_mail_forward {uid,to,confirm}, yandex_mail_save_to_disk {uid,path}, yandex_mail_city_context {uid}, yandex_mail_map_addresses {uid}, yandex_mail_create_task {uid,title}, yandex_mail_meeting_pack {uid,start,end,send,confirm}, yandex_calendar_calendars {}, yandex_calendar_list {start,end}, yandex_calendar_search {query,start,end}, yandex_calendar_get {query}, yandex_calendar_create_event {title,start,end,location,attendees,reminders,confirm}, yandex_calendar_update {query,title,start,end,location,description,reminders,confirm}, yandex_calendar_move {query,start,end,confirm}, yandex_calendar_delete {query,confirm}, yandex_docs_list {path}, yandex_docs_find {query}, yandex_docs_create_text {title,text,format,confirm}, yandex_docs_read {path|query}, yandex_docs_share {path|query,confirm}, yandex_docs_rename {path|query,name,confirm}, yandex_docs_delete {path|query,confirm}, yandex_contacts_list {limit}, yandex_contacts_search {query}, yandex_contacts_get {query}, yandex_contacts_create {name,email,phone,address,note,confirm}, yandex_contacts_update {query,email,phone,address,note,birthday,org,title,confirm}, yandex_contacts_delete {query,confirm}, yandex_contacts_export_csv {}, yandex_contacts_find_incomplete {}, yandex_contacts_find_duplicates {}, yandex_contacts_backup_to_disk {format,confirm}, yandex_contact_send_mail {contact,subject,text,confirm}, yandex_contact_send_disk_link_qr {contact,path,confirm}, yandex_contact_create_disk_folder {contact,confirm}, yandex_contact_create_calendar_event {contact,start,end,title,confirm}, yandex_contact_create_telemost_event {contact,start,end,title,confirm}, yandex_contact_full_pack {contact,start,end,send,confirm}, yandex_cloud_status {}, yandex_go_deeplink {from,to,tariff}, yandex_daily_digest {save,email}, yandex_calendar_reminders_tick {}, yandex_disk_maintenance_tick {}.",
    "Опасные Yandex tools используй только при явной просьбе пользователя и с confirm=true: yandex_disk_share, yandex_disk_share_qr, yandex_disk_share_email, yandex_disk_package_share_email, yandex_disk_delete, yandex_disk_move, yandex_disk_copy, yandex_disk_rename, yandex_disk_restore, yandex_disk_empty_trash, yandex_mail_send, yandex_mail_reply, yandex_mail_forward, yandex_mail_delete, yandex_mail_create_calendar_event, yandex_mail_sender_to_contact, yandex_mail_meeting_pack, yandex_contacts_create, yandex_contacts_update, yandex_contacts_delete, yandex_contacts_add_email, yandex_contacts_add_phone, yandex_contacts_add_address, yandex_contacts_backup_to_disk, yandex_contact_send_mail, yandex_contact_send_disk_link_qr, yandex_contact_create_disk_folder, yandex_contact_create_calendar_event, yandex_contact_create_telemost_event, yandex_contact_full_pack, yandex_calendar_create_event, yandex_calendar_update, yandex_calendar_move, yandex_calendar_delete, yandex_calendar_add_reminder, yandex_docs_create_text, yandex_docs_share, yandex_docs_rename, yandex_docs_delete, yandex_telemost_create_event.",
    "User skill tools: user_skill_create {name,description,instructions,tools,template,enable,confirm}, user_skill_update {name,instructions,tools,confirm}, user_skill_templates {}, user_skill_validate {name}, user_skill_preview {name,template,instructions}, user_skill_enable {name}, user_skill_disable {name}, user_skill_delete {name,confirm}, user_skill_list {}. Создавай или меняй skill только по явной просьбе пользователя и с confirm=true.",
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
    const tool = normalizeIolaToolName(payload.tool);
    if (!availableToolNames(options).includes(tool)) {
      const casualAnswer = buildCasualDirectAnswer(question);
      if (casualAnswer) return { directAnswer: casualAnswer };
      return inferToolPlan(question, options);
    }
    return { steps: [{ tool, args: { ...(payload.args || {}), source_question: question } }] };
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

function normalizeIolaToolName(tool) {
  if (tool === "get_entity_field") return "resolve_entity_field";
  if (tool === "current_date" || tool === "date_now" || tool === "today") return "get_current_date";
  return tool;
}

function parseJsonObject(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON-план не найден.");
  return JSON.parse(match[0]);
}

function inferToolPlan(question, options = {}) {
  const normalized = question.toLocaleLowerCase("ru-RU");
  if (isCurrentDateTimeQuestion(normalized)) {
    return { steps: [{ tool: "get_current_date", args: {} }] };
  }
  if (/(создай|добавь|сделай).{0,40}(skill|скилл|скил|навык)/iu.test(normalized)) {
    const name = normalizeUserSkillName(
      question.match(/(?:skill|скилл|скил|навык)\s+["«]?([^"».,:;\n]+)["»]?/iu)?.[1]
      || question.match(/(?:создай|добавь|сделай)\s+["«]?([^"».,:;\n]+?)["»]?\s+(?:skill|скилл|скил|навык)/iu)?.[1]
      || "user-skill"
    );
    return {
      steps: [{
        tool: "user_skill_create",
        args: {
          name,
          description: `Пользовательский skill: ${name}`,
          instructions: question,
          enable: true,
          confirm: true,
        },
      }],
    };
  }
  if (/(шаблон|template)/iu.test(normalized) && /(skill|скилл|скил|навык)/iu.test(normalized)) {
    return { steps: [{ tool: "user_skill_templates", args: {} }] };
  }
  if (/(проверь|validate|doctor)/iu.test(normalized) && /(skill|скилл|скил|навык)/iu.test(normalized)) {
    return { steps: [{ tool: "user_skill_validate", args: { name: extractUserSkillNameFromQuestion(question) } }] };
  }
  if (/(яндекс|yandex)/iu.test(normalized) && /(аккаунт|профил|логин|почт[аы]|email|e-mail|кто подключен)/iu.test(normalized)) {
    return { steps: [{ tool: "yandex_identity_me", args: {} }] };
  }
  if (/(яндекс|диск|облак)/iu.test(normalized)) {
    const diskPath = extractCloudPath(question) || CLOUD_DEFAULT_REMOTE_DIR;
    if (/(мест[оа]|сколько.*занято|сколько.*свобод|статус|инфо)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_info", args: {} }] };
    if (/(корзин|удаленн|удалённ)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_trash_list", args: { limit: 20 } }] };
    if (/(создай|сделай).{0,30}папк/iu.test(normalized)) {
      const folder = question.match(/папк[ауи]?\s+["«]?([^"»\n]+)["»]?/iu)?.[1]?.trim() || "Новая папка";
      return { steps: [{ tool: "yandex_disk_mkdir", args: { path: `${CLOUD_DEFAULT_REMOTE_DIR}/${folder}` } }] };
    }
    if (/(прочитай|открой|содержим|текст)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_read_text", args: { path: diskPath } }] };
    if (/(скачай|download)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_download", args: { remotePath: diskPath, outputPath: path.basename(diskPath) } }] };
    if (/(ссылк|поделись|опубликуй)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_share", args: { path: diskPath, confirm: true } }] };
    if (/(удали|удалить)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_delete", args: { path: diskPath, confirm: true } }] };
    if (/(переимен|rename)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_rename", args: { path: diskPath, name: extractCloudNewName(question), confirm: true } }] };
    if (/(перемести|move|скопируй|копир|copy)/iu.test(normalized)) {
      const { from, to } = extractCloudTwoPaths(question);
      return { steps: [{ tool: /(скопируй|копир|copy)/iu.test(normalized) ? "yandex_disk_copy" : "yandex_disk_move", args: { from, to, confirm: true, overwrite: true } }] };
    }
    if (/(найди|поиск)/iu.test(normalized)) return { steps: [{ tool: "yandex_disk_find", args: { query: question, path: CLOUD_DEFAULT_REMOTE_DIR, limit: 20 } }] };
    return { steps: [{ tool: "yandex_disk_ls", args: { path: CLOUD_DEFAULT_REMOTE_DIR } }] };
  }
  if (/(почт|письм|email|e-mail|спам|чернов|отправлен|исходящ|корзин)/iu.test(normalized)) {
    const mailbox = extractYandexMailboxName(question) || "INBOX";
    const uid = extractYandexMailUid(question);
    if (/(папк|ящик|mailbox|folder)/iu.test(normalized)) return { steps: [{ tool: "yandex_mail_folders", args: {} }] };
    if (/(ответь|ответить|напиши\s+ответ)/iu.test(normalized)) return { steps: [{ tool: "yandex_mail_reply", args: { uid, mailbox, text: parseYandexMailReplyRequest(question).text, confirm: true } }] };
    if (/(удали|удалить|перемести\s+в\s+корзин)/iu.test(normalized)) return { steps: [{ tool: "yandex_mail_delete", args: { uid, mailbox, confirm: true } }] };
    if (/(пометь|отметь|сделай)/iu.test(normalized) && /(прочитан|непрочитан)/iu.test(normalized)) return { steps: [{ tool: "yandex_mail_mark", args: { uid, mailbox, seen: !/непрочитан/iu.test(normalized) } }] };
    if (/(пакет|комплект)/iu.test(normalized) && uid) return { steps: [{ tool: "yandex_mail_meeting_pack", args: { uid, mailbox, ...extractDateTimeFromText(question), confirm: true } }] };
    if (/(прочитай|прочти|открой|раскрой|получи|получить)/iu.test(normalized) && uid) return { steps: [{ tool: "yandex_mail_read", args: { uid, mailbox } }] };
    if (/(найди|поиск)/iu.test(normalized)) return { steps: [{ tool: "yandex_mail_search", args: { mailbox, query: question, limit: 20 } }] };
    return { steps: [{ tool: "yandex_mail_list", args: { mailbox, limit: 10, unread: /непрочитан/iu.test(normalized) } }] };
  }
  if (/(документ|docs|360)/iu.test(normalized) && /(яндекс|диск|облак|360|docs)/iu.test(normalized)) {
    const target = extractCloudPath(question) || cleanupYandexQuery(question);
    if (/(создай|сделай|запиши|сохрани)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_create_text", args: { title: extractYandexDocTitle(question), text: extractShareMessage(question) || cleanupCloudSaveText(question), confirm: true } }] };
    if (/(прочитай|открой|текст)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_read", args: { query: target } }] };
    if (/(ссылк|поделись|опубликуй|qr|qr-код)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_share", args: { query: target, confirm: true } }] };
    if (/(переимен|rename)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_rename", args: { query: target, name: extractCloudNewName(question), confirm: true } }] };
    if (/(удали|удалить)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_delete", args: { query: target, confirm: true } }] };
    if (/(найди|поиск)/iu.test(normalized)) return { steps: [{ tool: "yandex_docs_find", args: { query: cleanupYandexQuery(question), limit: 20 } }] };
    return { steps: [{ tool: "yandex_docs_list", args: { limit: 20 } }] };
  }
  if (/(календар|событи|встреч|телемост)/iu.test(normalized)) {
    if (/(напомин|уведом|следи|монитор)/iu.test(normalized) && /(проверь|tick|сейчас)/iu.test(normalized)) return { steps: [{ tool: "yandex_calendar_reminders_tick", args: { force: true } }] };
    if (/(создай|добавь|запланируй|назначь)/iu.test(normalized)) {
      const dateTime = extractDateTimeFromText(question);
      return { steps: [{ tool: /телемост/iu.test(normalized) ? "yandex_telemost_create_event" : "yandex_calendar_create_event", args: { ...dateTime, title: extractCalendarTitle(question) || (/телемост/iu.test(normalized) ? "Телемост IOLA" : "Событие IOLA"), confirm: true } }] };
    }
    if (/(перенеси|перемести|измени\s+время|смени\s+время)/iu.test(normalized)) return { steps: [{ tool: "yandex_calendar_move", args: { query: cleanupCalendarEventQuery(question), ...extractDateTimeFromText(question), confirm: true } }] };
    if (/(удали|удалить|отмени|отменить)/iu.test(normalized)) return { steps: [{ tool: "yandex_calendar_delete", args: { query: cleanupCalendarEventQuery(question), confirm: true } }] };
    if (/(найди|поиск)/iu.test(normalized)) return { steps: [{ tool: "yandex_calendar_search", args: { query: cleanupCalendarEventQuery(question), limit: 20 } }] };
    return { steps: [{ tool: "yandex_calendar_list", args: { limit: 20 } }] };
  }
  if (/(контакт|адресн)/iu.test(normalized)) {
    if (/(дубликат|повтор)/iu.test(normalized)) return { steps: [{ tool: "yandex_contacts_find_duplicates", args: { limit: 20 } }] };
    if (/(неполн|без\s+email|без\s+почт|без\s+телефон|без\s+адрес)/iu.test(normalized)) return { steps: [{ tool: "yandex_contacts_find_incomplete", args: { limit: 30 } }] };
    if (/(экспорт|выгруз)/iu.test(normalized)) return { steps: [{ tool: /csv/iu.test(normalized) ? "yandex_contacts_export_csv" : "yandex_contacts_export_vcard", args: {} }] };
    if (/(резерв|backup|бэкап|диск|яндекс.?диск)/iu.test(normalized) && /(контакт)/iu.test(normalized) && /(сохрани|экспорт|выгруз|резерв|backup|бэкап)/iu.test(normalized)) return { steps: [{ tool: "yandex_contacts_backup_to_disk", args: { format: /csv/iu.test(normalized) ? "csv" : "vcard", confirm: true } }] };
    if (/(создай|добавь|запиши|сохрани)\s+контакт/iu.test(normalized)) return { steps: [{ tool: "yandex_contacts_create", args: { ...parseYandexContactCreateRequest(question), confirm: true } }] };
    if (/(полный|комплект|пакет)/iu.test(normalized)) return { steps: [{ tool: "yandex_contact_full_pack", args: { contact: cleanupYandexContactActionQuery(question), ...extractDateTimeFromText(question), confirm: true } }] };
    if (/(удали|удалить)/iu.test(normalized)) return { steps: [{ tool: "yandex_contacts_delete", args: { query: cleanupYandexContactActionQuery(question), confirm: true } }] };
    if (/(отправь|пошли).{0,80}(ссылк|qr|qr-код|диск|яндекс.?диск)/iu.test(normalized)) return { steps: [{ tool: "yandex_contact_send_disk_link_qr", args: { contact: cleanupYandexContactActionQuery(question), path: extractCloudPath(question), confirm: true } }] };
    if (/(отправь|пошли|напиши).{0,40}(письм|сообщ)/iu.test(normalized)) {
      const draft = parseYandexMailSendRequest(question);
      return { steps: [{ tool: "yandex_contact_send_mail", args: { contact: draft.contactQuery || cleanupYandexContactActionQuery(question), subject: draft.subject, text: draft.text, confirm: true } }] };
    }
    if (/(создай|добавь|запланируй).{0,40}(встреч|событи|календар|телемост)/iu.test(normalized)) return { steps: [{ tool: /телемост/iu.test(normalized) ? "yandex_contact_create_telemost_event" : "yandex_contact_create_calendar_event", args: { contact: cleanupYandexContactActionQuery(question), ...extractDateTimeFromText(question), confirm: true } }] };
    return { steps: [{ tool: "yandex_contacts_search", args: { query: question, limit: 20 } }] };
  }
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
  const layer = normalizeEntityLayer(args.layer);
  assertSupportedPublicEntityLayer(layer);
  const payload = await postJson(`${await getApiBaseUrl()}/search-entities`, {
    layer,
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
  const endpoint = `${await getApiBaseUrl()}/resolve-entity-field`;
  const requestedField = normalizeEntityField(args.field);
  const layer = normalizeEntityLayer(args.layer);
  assertSupportedPublicEntityLayer(layer);
  const strictQuestionNumber = extractEntityNumberFromQuestion(args.source_question, layer);
  const payload = {
    layer,
    entity_number: strictQuestionNumber || (args.entity_number ?? args.number),
    entity_name: args.entity_name || args.name,
    inn: args.inn,
    field: requestedField,
    must_refute_user_value: args.must_refute_user_value,
    source_question: args.source_question,
    strict_entity_number: Boolean(strictQuestionNumber),
  };
  try {
    const resolved = await postJson(endpoint, stripInternalResolveArgs(payload));
    const correctedByNumber = await correctResolvedEntityByQuestionNumber(resolved, payload);
    if (correctedByNumber) return correctedByNumber;
    return await correctResolvedEntityByQuestionName(resolved, payload) || resolved;
  } catch (error) {
    if (payload.strict_entity_number && isEntityNotFoundError(error)) throw error;
    if (isLocalEntityValidationError(error)) throw error;
    const fallbackField = pickResolveFieldFallback(requestedField, error);
    if (fallbackField && fallbackField !== requestedField) {
      try {
        const fallbackPayload = { ...payload, field: fallbackField };
        const resolved = await postJson(endpoint, stripInternalResolveArgs(fallbackPayload));
        const correctedByNumber = await correctResolvedEntityByQuestionNumber(resolved, fallbackPayload);
        if (correctedByNumber) return correctedByNumber;
        return await correctResolvedEntityByQuestionName(resolved, fallbackPayload) || resolved;
      } catch (retryError) {
        if (payload.strict_entity_number && isEntityNotFoundError(retryError)) throw retryError;
        if (isLocalEntityValidationError(retryError)) throw retryError;
        const resolvedBySearch = await resolvePublicEntityFieldViaSearch({ ...payload, field: fallbackField }, retryError);
        if (resolvedBySearch) return resolvedBySearch;
        throw retryError;
      }
    }
    const resolvedBySearch = await resolvePublicEntityFieldViaSearch(payload, error);
    if (resolvedBySearch) return resolvedBySearch;
    throw error;
  }
}

async function resolvePublicEntityFieldViaSearch(payload, originalError) {
  const details = parseErrorJsonDetails(originalError);
  if (details?.error !== "entity_not_found") return null;
  if (payload.inn) return null;
  if (payload.strict_entity_number) return null;
  const query = payload.entity_name || buildEntitySearchQuery(payload.layer, payload.entity_number);
  if (!query) return null;
  const candidates = await searchPublicEntities({ layer: payload.layer, query, limit: 10 });
  const candidate = pickResolvedEntityCandidate(candidates, payload);
  if (!candidate?.inn) return null;
  return postJson(`${await getApiBaseUrl()}/resolve-entity-field`, stripInternalResolveArgs({
    layer: payload.layer,
    inn: candidate.inn,
    field: payload.field,
    must_refute_user_value: payload.must_refute_user_value,
  }));
}

function stripInternalResolveArgs(payload) {
  const { source_question: _sourceQuestion, strict_entity_number: _strictEntityNumber, ...publicPayload } = payload || {};
  return publicPayload;
}

async function correctResolvedEntityByQuestionNumber(resolved, payload) {
  if (!payload.strict_entity_number || !payload.entity_number) return null;
  const resolvedEntity = resolved?.entity || resolved || {};
  if (itemNameHasNumber(resolvedEntity, payload.entity_number)) return null;

  const candidates = await searchPublicEntities({ layer: payload.layer, query: buildEntitySearchQuery(payload.layer, payload.entity_number), limit: 10 });
  const candidate = candidates.find((item) => itemNameHasNumber(item, payload.entity_number));
  if (!candidate?.inn) throw createEntityNotFoundError(payload, buildEntitySearchQuery(payload.layer, payload.entity_number));
  if (candidate.inn === resolvedEntity.inn) return null;

  return postJson(`${await getApiBaseUrl()}/resolve-entity-field`, stripInternalResolveArgs({
    layer: payload.layer,
    inn: candidate.inn,
    field: payload.field,
    must_refute_user_value: payload.must_refute_user_value,
  }));
}

async function correctResolvedEntityByQuestionName(resolved, payload) {
  const questionNameQuery = extractEntityNameQueryFromQuestion(payload.source_question, payload.layer);
  if (!questionNameQuery) return null;
  const resolvedEntity = resolved?.entity || resolved || {};
  if (entityNameMatchesQuery(resolvedEntity.name, questionNameQuery)) return null;

  const candidates = await searchPublicEntities({ layer: payload.layer, query: questionNameQuery, limit: 5 });
  const candidate = pickNamedEntityCandidate(candidates, questionNameQuery);
  if (!candidate?.inn) throw createEntityNotFoundError(payload, questionNameQuery);
  if (candidate.inn === resolvedEntity.inn) return null;

  return postJson(`${await getApiBaseUrl()}/resolve-entity-field`, stripInternalResolveArgs({
    layer: payload.layer,
    inn: candidate.inn,
    field: payload.field,
    must_refute_user_value: payload.must_refute_user_value,
  }));
}

function extractEntityNameQueryFromQuestion(question, layer) {
  let text = String(question || "").toLocaleLowerCase("ru-RU");
  if (extractEntityNumberFromQuestion(text, layer)) return "";
  const correction = text.match(/(?:просил|просила|просили)\s+(.+?)\s+а\s+не(?:\s|$)/iu);
  if (correction?.[1]) text = correction[1];

  const stopWords = new Set([
    "а", "в", "во", "где", "же", "и", "или", "как", "какая", "какие", "какой", "кто", "на", "не",
    "найди", "находится", "подскажи", "покажи", "просил", "скажи", "так", "там", "это",
    "адрес", "директор", "директора", "заведующая", "заведующий", "инн", "почта", "сайт", "телефон",
    "гимназия", "гимназии", "детсад", "детсада", "детский", "лицей", "лицея", "лицее", "мбдоу", "мбоу", "сад", "сада", "садик",
    "сош", "школа", "школе", "школу", "школы",
  ]);
  const tokens = [...text.normalize("NFC").matchAll(/[\p{L}\d]+/gu)]
    .map((match) => normalizeEntityText(match[0]))
    .filter((token) => token && !stopWords.has(token) && !/^\d+$/.test(token));
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return "";
  if (uniqueTokens.length === 1 && uniqueTokens[0].length < 5) return "";
  return uniqueTokens.join(" ");
}

function pickNamedEntityCandidate(candidates, query) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const tokens = entityQueryTokens(query);
  const exact = candidates.find((item) => entityNameMatchesQuery(item.name, query));
  if (exact) return exact;
  if (candidates.length === 1 && Number(candidates[0].score || 0) >= 0.5) return candidates[0];
  return candidates.find((item) => {
    const name = normalizeEntityText(item.name || "");
    return Number(item.score || 0) >= 0.8 && tokens.filter((token) => name.includes(token)).length >= Math.ceil(tokens.length / 2);
  }) || null;
}

function entityNameMatchesQuery(name, query) {
  const normalizedName = normalizeEntityText(name || "");
  const tokens = entityQueryTokens(query);
  return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
}

function entityQueryTokens(query) {
  return [...String(query || "").matchAll(/[\p{L}\d]+/gu)]
    .map((match) => normalizeEntityText(match[0]))
    .filter(Boolean);
}

function normalizeEntityText(text) {
  return String(text || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function extractEntityNumberFromQuestion(question, layer) {
  const text = String(question || "").toLocaleLowerCase("ru-RU");
  const isKindergarten = layer === "kindergartens";
  const isSchool = layer === "schools";
  const patterns = isKindergarten
    ? [/(?:детск[\p{L}\p{N}_-]*\s+сад[\p{L}\p{N}_-]*|детсад[\p{L}\p{N}_-]*|сад[\p{L}\p{N}_-]*)\s*(?:№|номер|n)?\s*(\d{1,4})/iu, /№\s*(\d{1,4})/iu]
    : isSchool
      ? [/(?:школ[\p{L}\p{N}_-]*|сош|гимнази[\p{L}\p{N}_-]*|лице[\p{L}\p{N}_-]*)\s*(?:№|номер|n)?\s*(\d{1,4})/iu, /№\s*(\d{1,4})/iu]
      : [/№\s*(\d{1,4})/iu];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function createEntityNotFoundError(payload, query = "") {
  const detail = {
    error: "entity_not_found",
    message: "No public entity matched the provided selector",
    layer: payload.layer,
    entity_number: payload.entity_number,
    entity_name: payload.entity_name || query,
    local_validation: true,
  };
  return new Error(`Request failed: 404 Not Found (${awaitedApiPlaceholder()})\n${JSON.stringify({ detail })}`);
}

function awaitedApiPlaceholder() {
  return "local-validation";
}

function buildEntitySearchQuery(layer, number) {
  if (number === undefined || number === null || number === "") return "";
  const label = layer === "kindergartens" ? "детский сад" : "школа";
  return `${label} ${number}`;
}

function pickResolvedEntityCandidate(candidates, payload) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const number = payload.entity_number === undefined || payload.entity_number === null ? "" : String(payload.entity_number);
  if (number) {
    const exact = candidates.find((item) => itemNameHasNumber(item, number));
    if (exact) return exact;
  }
  if (candidates.length === 1) return candidates[0];
  return candidates.find((item) => Number(item.score || 0) > 0) || candidates[0];
}

function normalizeEntityLayer(layer) {
  const value = String(layer || "").toLocaleLowerCase("ru-RU");
  if (value === "school" || value === "schools" || value.includes("школ")) return "schools";
  if (value === "kindergarten" || value === "kindergartens" || value.includes("сад")) return "kindergartens";
  if (value === "museum" || value === "museums" || value.includes("музе")) return "museums";
  return value || "schools";
}

function assertSupportedPublicEntityLayer(layer) {
  if (layer === "schools" || layer === "kindergartens") return;
  throw createUnsupportedPublicDatasetError(layer);
}

function createUnsupportedPublicDatasetError(layer) {
  const detail = {
    error: "unsupported_public_dataset",
    message: "Unknown public dataset",
    layer,
  };
  return new Error(`Request failed: 400 Bad Request (local-validation)\n${JSON.stringify({ detail })}`);
}

function normalizeEntityField(field) {
  const value = String(field || "").toLocaleLowerCase("ru-RU");
  if (value === "director" || value === "directors" || value === "directs" || value === "direct" || value === "head" || value === "head_name" || value.includes("директ") || value.includes("руковод")) return "director";
  if (value === "site" || value === "url" || value === "website" || value.includes("сайт")) return "website";
  if (value === "mail" || value === "email" || value.includes("почт")) return "email";
  if (value === "phone" || value.includes("тел")) return "phone";
  if (value === "address" || value.includes("адрес")) return "address";
  if (value === "license") return "license_status";
  return value || "name";
}

function pickResolveFieldFallback(requestedField, error) {
  const details = parseErrorJsonDetails(error);
  if (details?.error !== "field_not_public") return "";
  const publicFields = new Set((details.public_fields || []).map((field) => String(field)));
  const aliases = {
    director: ["director", "head_name", "head"],
    head: ["director", "head_name", "head"],
    head_name: ["director", "head_name", "head"],
    license_status: ["license_status", "license_number", "license_date"],
  }[requestedField] || [];
  return aliases.find((field) => field !== requestedField && publicFields.has(field)) || "";
}

function parseErrorJsonDetails(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  const match = text.match(/\{[\s\S]*\}$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed.detail || parsed;
  } catch {
    return null;
  }
}

function isEntityNotFoundError(error) {
  return parseErrorJsonDetails(error)?.error === "entity_not_found";
}

function isLocalEntityValidationError(error) {
  return Boolean(parseErrorJsonDetails(error)?.local_validation);
}

function formatToolExecutionError(error, plan) {
  const details = parseErrorJsonDetails(error);
  if (details?.error === "unsupported_public_dataset" || details === "Unknown public dataset") {
    return "Сейчас в открытых слоях CLI подключены школы и детские сады. По этому типу организаций я пока не могу давать проверяемые ответы.";
  }
  if (details?.error !== "entity_not_found") return "";
  if (details.local_validation && details.entity_name) {
    return `В открытом слое не нашел организацию по названию "${details.entity_name}". Проверьте название.`;
  }

  const step = (plan?.steps || []).find((item) => item.tool === "resolve_entity_field" || item.tool === "search_entities");
  const args = step?.args || {};
  const layer = normalizeEntityLayer(args.layer);
  const number = args.entity_number ?? args.number;
  const name = args.entity_name || args.name;
  const entityLabel = layer === "kindergartens" ? "детский сад" : "школу";
  const selector = number !== undefined && number !== null && number !== ""
    ? `${entityLabel} № ${number}`
    : name
      ? `${entityLabel} "${name}"`
      : "такую организацию";
  return `В открытом слое не нашел ${selector}. Проверьте номер или название.`;
}

function availableToolNames(options = {}) {
  const names = new Set([...LOCAL_TOOLS, ...YANDEX_TOOLS, ...USER_SKILL_TOOLS]);
  if (options.files) {
    for (const tool of FILE_TOOLS) names.add(tool);
  }
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
      } else if (step.tool === "get_current_date") {
        current = [getCurrentDateInfo()];
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (YANDEX_TOOLS.includes(step.tool)) {
        await assertPermission("externalApi");
        const result = await executeYandexTool(step.tool, step.args || {});
        current = Array.isArray(result) ? result : [result];
        outputs.push({ tool: step.tool, rows: current.length });
      } else if (USER_SKILL_TOOLS.includes(step.tool)) {
        const result = await executeUserSkillTool(step.tool, step.args || {});
        current = Array.isArray(result) ? result : [result];
        outputs.push({ tool: step.tool, rows: current.length });
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

function getCurrentDateInfo() {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return {
    name: "текущая дата",
    date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(now),
    time: new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" }).format(now),
    weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(now),
    timezone: timeZone,
    iso: now.toISOString(),
  };
}

function isCurrentDateTimeQuestion(normalized) {
  const text = String(normalized || "");
  return /^(?:какая|какой|какое|скажи|подскажи|что)\s+(?:сегодня\s+)?(?:дата|день|число|время|день недели)|^(?:сегодня|сейчас)\??$/iu.test(text)
    || /(?:какая\s+сегодня\s+дата|какой\s+сегодня\s+день|который\s+час|сколько\s+времени|текущее\s+время|текущая\s+дата|дата\s+сегодня)/iu.test(text);
}

function formatCurrentDateTimeAnswer(normalized) {
  const info = getCurrentDateInfo();
  if (/(время|час|сейчас|сколько)/iu.test(normalized) && !/(дата|день|число)/iu.test(normalized)) {
    return `Сейчас ${info.time}. Часовой пояс: ${info.timezone}.`;
  }
  if (/(день недели)/iu.test(normalized) && !/(дата|число)/iu.test(normalized)) {
    return `Сегодня ${info.weekday}.`;
  }
  return `Сегодня ${info.date}, ${info.weekday}. Время: ${info.time}. Часовой пояс: ${info.timezone}.`;
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
    if (row.date && row.time) return `Сегодня ${row.date}, ${row.time}.`;
    if (row.status === "calendar-event-created" || row.status === "telemost-event-created" || row.status === "telemost-calendar-fallback-created") {
      return `${row.status === "calendar-event-created" ? "Событие" : "Телемост"} создан: ${row.title || row.uid}${row.start ? `, ${row.start}` : ""}${row.telemost?.joinUrl ? `\nСсылка: ${row.telemost.joinUrl}` : row.status === "telemost-calendar-fallback-created" ? "\nПрямая ссылка Телемоста через API недоступна, создано событие календаря." : ""}`;
    }
    if (row.status === "calendar-event-updated") return `Событие обновлено: ${row.title || row.uid}`;
    if (row.status === "calendar-event-deleted") return `Событие удалено: ${row.title || row.uid}`;
    if (row.status === "mail-meeting-pack-created") return `Пакет по письму #${row.uid} создан.\nПисьмо: ${row.saved}\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}\nСобытие: ${row.event || "-"}`;
    if (row.status === "contact-full-pack-created") return `Пакет контакта создан: ${row.contact}\nПапка: ${row.folder}\nДокумент: ${row.doc}\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}\nСобытие: ${row.event || "-"}`;
    if (row.url && row.fromPoint && row.toPoint) return formatYandexGoDeeplinkResult(row);
    if (row.geocoder !== undefined && row.yandexgpt !== undefined && row.enabled) return `Yandex Cloud Connector:\nГеокодер: ${row.geocoder ? "настроен" : "нет"}\nYandexGPT: ${row.yandexgpt ? "настроен" : "нет"}\nВключено: ${row.enabled.join(", ") || "-"}`;
    if (row.enabled && row.text && (row.unread !== undefined || row.events !== undefined)) return row.text;
    if (row.status === "ambiguous" && row.events) return [`Нашел несколько событий. Уточните:`, ...row.events.map((event, index) => `${index + 1}. ${event.title || event.uid} — ${event.startIso || event.start || "-"}`)].join("\n");
    if (row.status === "not-found" && row.kind === "calendar-event") return `Событие не найдено: ${row.query}`;
    if (row.status === "document-created") return `Документ создан на Яндекс Диске: ${row.remote}`;
    if (row.status === "binary-document") return `${row.name || row.remote}: ${row.message}`;
    if (row.status === "not-document") return `Это не документ: ${row.path}`;
    if (row.status === "ambiguous" && row.docs) return [`Нашел несколько документов. Уточните:`, ...row.docs.map((doc, index) => `${index + 1}. ${doc.name} — ${doc.path}`)].join("\n");
    if (row.status === "not-found" && row.docs !== undefined) return `Документ не найден: ${row.query}`;
    if (row.status === "contact-mail-sent") return `Письмо контакту отправлено: ${row.contact}. Тема: ${row.subject || "-"}`;
    if (row.status === "contact-disk-link-sent") return `Отправил контакту ${row.contact} ссылку на Яндекс Диск.\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}`;
    if (row.status === "contact-folder-created") return `Папка контакта создана: ${row.remote}\nКарточка: ${row.cardPath}`;
    if (row.status === "contact-calendar-event-created" || row.status === "contact-telemost-event-created") return `${row.status === "contact-telemost-event-created" ? "Телемост" : "Встреча"} создана: ${row.title || row.uid}. Участник: ${row.attendee || "-"}`;
    if (row.status === "contacts-backup") return `Контакты сохранены на Яндекс Диск: ${row.remote}. Записей: ${row.rows}.`;
    if (row.status === "contacts-imported") return `Контакты импортированы из ${row.input}. Создано: ${row.created}, пропущено: ${row.skipped}.`;
    if (row.status === "birthday-events-created") return `События дней рождения созданы: ${row.created}. Контактов с днем рождения: ${row.totalWithBirthday}.`;
    if (row.provider === "yandex-disk" && row.publicUrl) return `Публичная ссылка: ${row.publicUrl}`;
    if (row.provider === "yandex-disk" && row.status === "shared-with-qr") return `Публичная ссылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}`;
    if (row.provider === "yandex-disk" && row.status === "shared-and-sent") return `Отправил ссылку на Яндекс Диск: ${Array.isArray(row.to) ? row.to.join(", ") : row.to}\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}`;
    if (row.provider === "yandex-disk" && row.status === "package-shared-and-sent") return `${row.mode === "move" ? "Перенес" : "Скопировал"} объектов: ${row.transferred}\nПапка: ${row.targetFolder}\nОтправил: ${Array.isArray(row.to) ? row.to.join(", ") : row.to}\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}`;
    if (row.provider === "yandex-disk" && typeof row.exists === "boolean") return `Яндекс Диск: ${row.path || row.remote} ${row.exists ? "найден" : "не найден"}`;
    if (row.provider === "yandex-disk" && (row.status === "moved" || row.status === "copied" || row.status === "restored")) return `Яндекс Диск: ${row.status} ${row.from ? `${row.from} -> ` : ""}${row.remote}`;
    if (row.provider === "yandex-disk" && row.status === "unpublished") return `Яндекс Диск: публичная ссылка снята ${row.remote}`;
    if (row.provider === "yandex-disk" && row.status === "trash-empty-requested") return `Яндекс Диск: очистка корзины запрошена`;
    if (row.provider === "yandex-disk" && row.text) return `Яндекс Диск: ${row.remote}\n${String(row.text).slice(0, 2000)}`;
    if (row.provider === "yandex-disk" && row.remote) return `Яндекс Диск: ${row.status || "ok"} ${row.remote}`;
    if (row.uid && (row.subject || row.from)) return `Письмо #${row.uid}: ${row.subject || "(без темы)"}${row.from ? `, от ${row.from}` : ""}`;
    if (row.status === "moved-to-trash") return `Письмо #${row.uid} перемещено в корзину: ${row.to}`;
    if (row.status === "seen" || row.status === "unseen") return `Письмо #${row.uid}: ${row.status === "seen" ? "прочитано" : "непрочитано"}`;
    if (row.status === "sent" && row.to) return `Письмо отправлено: ${Array.isArray(row.to) ? row.to.join(", ") : row.to}. Тема: ${row.subject || "-"}`;
    if (row.status === "contact-mail-sent") return `Письмо контакту отправлено: ${row.contact}. Тема: ${row.subject || "-"}`;
    if (row.status === "contact-disk-link-sent") return `Отправил контакту ${row.contact} ссылку на Яндекс Диск.\nСсылка: ${row.publicUrl}\nQR-код: ${row.qrPublicUrl}`;
    if (row.status === "contact-folder-created") return `Папка контакта создана: ${row.remote}\nКарточка: ${row.cardPath}`;
    if (row.status === "contact-calendar-event-created" || row.status === "contact-telemost-event-created") return `${row.status === "contact-telemost-event-created" ? "Телемост" : "Встреча"} создана: ${row.title || row.uid}. Участник: ${row.attendee || "-"}`;
    if (row.status === "contacts-backup") return `Контакты сохранены на Яндекс Диск: ${row.remote}. Записей: ${row.rows}.`;
    if (row.status === "exported" && row.output) return `Контакты экспортированы: ${row.output}. Записей: ${row.rows}.`;
    if (row.status === "deleted" && (row.email || row.phone || row.name)) return `Контакт удален: ${formatYandexContact(row)}`;
    if (row.status === "updated" && (row.email || row.phone || row.name)) return `Контакт обновлен: ${formatYandexContact(row)}`;
    if (row.status === "created" && (row.email || row.phone || row.name)) return `Контакт создан: ${formatYandexContact(row)}`;
    if (row.status === "no-email" && row.contact) return `У контакта нет email: ${formatYandexContact(row.contact)}`;
    if (row.status === "ambiguous" && row.contacts) return [`Нашел несколько контактов. Уточните:`, ...row.contacts.map((contact, index) => `${index + 1}. ${formatYandexContact(contact)}`)].join("\n");
    if (row.status === "not-found" && row.query !== undefined) return `Контакт не найден: ${row.query}`;
    if (row.status === "duplicate-group" && row.contacts) return [`Дубликаты (${row.key}):`, ...row.contacts.map((contact, index) => `${index + 1}. ${formatYandexContact(contact)}`)].join("\n");
    if (row.status === "created" && row.file && row.name) return `Skill создан: ${row.name}\nФайл: ${row.file}${row.enabled ? "\nSkill включен." : ""}`;
    if ((row.status === "enabled" || row.status === "disabled") && row.name) return `Skill ${row.name}: ${row.status}`;
    if (row.status === "deleted" && row.name) return `Skill удален: ${row.name}`;
    if (row.special || row.delimiter) return `Папка почты: ${row.name}${row.special ? ` (${row.special})` : ""}`;
    if (row.login || row.defaultEmail) return `Yandex ID: ${row.displayName || row.login || "-"}${row.defaultEmail ? `, ${row.defaultEmail}` : ""}`;
    if (row.title && (row.start || row.end)) return `${row.title}: ${row.start || "-"}${row.end ? ` - ${row.end}` : ""}`;
    if (row.email || row.phone || row.emails || row.phones) return formatYandexContact(row);
    return `${row.name || row.check || row.inn || "строка"}: ${row.address || row.phone || row.email || row.website || row.count || ""}`;
  }).join("\n");
}

function formatYandexContact(row) {
  const emails = row.emails?.length ? row.emails : (row.email ? [row.email] : []);
  const phones = row.phones?.length ? row.phones : (row.phone ? [row.phone] : []);
  const name = row.name && row.name !== emails[0] ? row.name : "";
  return [
    name || emails[0] || phones[0] || "Контакт",
    emails.length ? `email: ${emails.join(", ")}` : "",
    phones.length ? `тел: ${phones.join(", ")}` : "",
    row.org ? `орг: ${row.org}` : "",
    row.address ? `адрес: ${row.address}` : "",
  ].filter(Boolean).join(", ");
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
  const currentDate = getCurrentDateInfo();
  const system = [
    "Ты терминальный AI-агент городского округа Йошкар-Ола.",
    `Текущие дата и время CLI: ${currentDate.date}, ${currentDate.weekday}, ${currentDate.time}; часовой пояс: ${currentDate.timezone}; ISO: ${currentDate.iso}.`,
    "Если пользователь спрашивает про сегодня, завтра, вчера, текущую дату, время или относительные сроки, опирайся на текущие дату и время CLI.",
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

  if (config.provider === "yandexgpt") {
    return callYandexGpt(config, messages);
  }

  if (config.provider === "gigachat") {
    return callGigaChat(config, messages);
  }

  if (config.provider === "codex") {
    return callCodex(config, messages);
  }

  throw new Error(`Неизвестный AI-провайдер: ${config.provider}`);
}

async function callIolaLocal(config, messages) {
  if ((config.runtime || "ollama") !== "transformers") {
    const model = config.model || IOLA_LOCAL_MODEL;
    await ensureIolaModelFresh({
      runtime: "ollama",
      model,
      baseUrl: config.baseUrl,
      modelDir: config.modelDir || IOLA_MODEL_DIR,
      ggufRepo: config.ggufRepo || IOLA_ROUTER_GGUF_REPO,
      ggufFile: config.ggufFile || IOLA_ROUTER_GGUF_FILE,
      quiet: true,
    });
    const routerMessages = withIolaRouterSystemPrompt(messages);
    return callOllama({
      ...config,
      provider: "ollama",
      model,
      temperature: 0,
      numPredict: Number(config.numPredict || 128),
      qwenNoThink: true,
    }, routerMessages);
  }

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
  if (await hasOllamaModel(IOLA_LOCAL_MODEL)) return true;
  const state = readConfigLayerSync(getIolaModelStateFile(IOLA_MODEL_DIR));
  return Boolean(state?.runtime === "transformers" && state?.repo && state?.revision && existsSync(IOLA_MODEL_DIR));
}

async function ensureIolaModelFresh(options = {}) {
  if ((options.runtime || "ollama") !== "transformers") {
    return ensureIolaOllamaModelFresh(options);
  }

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

async function ensureIolaOllamaModelFresh(options = {}) {
  const model = options.model || IOLA_LOCAL_MODEL;
  const modelDir = options.modelDir || IOLA_MODEL_DIR;
  const repo = options.ggufRepo || IOLA_ROUTER_GGUF_REPO;
  const ggufFile = options.ggufFile || IOLA_ROUTER_GGUF_FILE;
  const baseUrl = options.baseUrl || "http://127.0.0.1:11434";
  const ollamaCommand = await resolveOllamaCommand();
  if (!ollamaCommand) {
    throw new Error("Ollama не найден. Установите Ollama и повторите: iola ai setup iola --yes");
  }

  await mkdir(modelDir, { recursive: true });
  const stateFile = getIolaModelStateFile(modelDir);
  const state = readConfigLayerSync(stateFile) || {};
  const remote = await getRemoteIolaModelRevision(repo).catch(() => null);
  const installed = await hasOllamaModel(model, baseUrl);
  if (installed && !options.force && (!state.revision || state.runtime !== "ollama" || state.model !== model || state.repo !== repo)) {
    const nextState = {
      repo,
      ggufFile,
      revision: remote?.sha || state.revision || `local-${Date.now()}`,
      installedAt: state.installedAt || new Date().toISOString(),
      runtime: "ollama",
      model,
    };
    await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
    return nextState;
  }
  const stale = options.force || !installed || state.runtime !== "ollama" || state.model !== model || state.repo !== repo || !state.revision || (remote?.sha && remote.sha !== state.revision);
  if (!stale) return state;

  if (!options.quiet) {
    const reason = installed ? "обновляю" : "устанавливаю";
    console.log(`IOLA local model: ${reason} ${model}`);
    console.log(`Источник GGUF: https://huggingface.co/${repo}`);
  }

  const ggufPath = path.join(modelDir, ggufFile);
  const modelfilePath = path.join(modelDir, "Modelfile");
  const url = `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(ggufFile)}`;
  if (options.force || !existsSync(ggufPath)) {
    await downloadFile(url, ggufPath, { quiet: options.quiet });
  }

  await writeFile(modelfilePath, buildIolaOllamaModelfile(ggufPath), "utf8");
  await runCommand(ollamaCommand, ["create", model, "-f", modelfilePath], { inherit: !options.quiet });

  const nextState = {
    repo,
    ggufFile,
    revision: remote?.sha || state.revision || `local-${Date.now()}`,
    installedAt: new Date().toISOString(),
    runtime: "ollama",
    model,
  };
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

async function hasOllamaModel(model, baseUrl = "http://127.0.0.1:11434") {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const payload = await response.json();
    return (payload.models || []).some((item) => item.name === model);
  } catch {
    return false;
  }
}

async function downloadFile(url, targetPath, options = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": "@iola_adm/iola-cli" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Не удалось скачать модель: ${response.status} ${response.statusText} (${url})`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (!options.quiet) console.log(`Скачиваю модель: ${targetPath}`);
  await new Promise((resolve, reject) => {
    const file = createWriteStream(targetPath);
    Readable.fromWeb(response.body).pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
}

function buildIolaOllamaModelfile(ggufPath) {
  return `FROM ${ggufPath}

TEMPLATE """{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end -}}
{{- range .Messages }}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ .Content }}<|im_end|>
{{ end -}}
{{ end -}}
<|im_start|>assistant
"""

PARAMETER temperature 0
PARAMETER repeat_penalty 1
PARAMETER stop <|im_start|>
PARAMETER stop <|im_end|>
`;
}

function withIolaRouterSystemPrompt(messages = []) {
  const normalized = messages.map((message) => ({ ...message }));
  const hasSystem = normalized.some((message) => message.role === "system");
  const withNoThink = normalized.map((message, index) => {
    if (message.role === "user" && index === normalized.findLastIndex((item) => item.role === "user")) {
      return { ...message, content: `${message.content}\n/no_think` };
    }
    return message;
  });
  return hasSystem ? withNoThink : [{ role: "system", content: IOLA_ROUTER_SYSTEM_PROMPT }, ...withNoThink];
}

const IOLA_ROUTER_SYSTEM_PROMPT = `You are the IOLA CLI router for public open data of Yoshkar-Ola.
Return only valid JSON. No markdown, no prose.
Allowed actions:
- {"action":"tool_call","tool":"resolve_entity_field","args":{"layer":"schools|kindergartens","entity_number":1,"field":"address|phone|email|website|inn|head|license_status"}}
- {"action":"tool_call","tool":"search_entities","args":{"layer":"schools|kindergartens","query":"..."}}
- {"action":"tool_call","tool":"rag_search","args":{"query":"...","collections":["city_history","official_documents"]}}
- {"action":"tool_call","tool":"get_current_official","args":{"jurisdiction":"yoshkar_ola","office_query":"..."}}
- {"action":"tool_call","tool":"get_official_by_date","args":{"jurisdiction":"yoshkar_ola","office_query":"...","date":"YYYY or date"}}
- {"action":"clarify","question":"..."}
- {"action":"refuse","reason":"field_not_public"}
- {"action":"direct_answer","answer":"..."}
Never invent current officials, salaries, private data, addresses, phones, websites, heads, or license statuses.
Use tool calls for public entity data. Use refuse for non-public fields.`;

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
        think: config.qwenNoThink ? false : undefined,
        options: {
          temperature: Number(config.temperature ?? 0.1),
          num_predict: config.numPredict ? Number(config.numPredict) : undefined,
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

  const networkMode = getAiNetworkMode(config);
  if (networkMode === "gateway") {
    return callAiRelay(config, messages, apiKey, providerName);
  }
  if (networkMode === "auto") {
    try {
      return await callOpenAiDirect(config, messages, apiKey, providerName);
    } catch (error) {
      if (!isNetworkFallbackError(error)) throw error;
      return callAiRelay(config, messages, apiKey, providerName);
    }
  }

  return callOpenAiDirect(config, messages, apiKey, providerName);
}

async function callOpenAiDirect(config, messages, apiKey, providerName) {
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
    throw new Error(`${providerName} request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, apiKey)}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || "";
}

async function callAiRelay(config, messages, apiKey, providerName) {
  const relayBaseUrl = String(config.aiRelayBaseUrl || AI_RELAY_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${relayBaseUrl}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: providerName === "OpenAI" ? "openai" : "openrouter",
      api_key: apiKey,
      model: config.model,
      messages,
      temperature: Number(config.temperature ?? 0.2),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${providerName} relay request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, apiKey)}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || "";
}

async function callAiRelayModels(config, apiKey, providerName) {
  const relayBaseUrl = String(config.aiRelayBaseUrl || AI_RELAY_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${relayBaseUrl}/models`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: providerName === "OpenAI" ? "openai" : "openrouter",
      api_key: apiKey,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${providerName} relay models request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, apiKey)}`);
  }

  return response.json();
}

async function callYandexGpt(config, messages) {
  const apiKey = await getApiKey("yandexgpt");
  const folderId = await getYandexFolderId();
  if (!apiKey || !folderId) {
    throw new Error("YandexGPT API key или folder ID не найден. Выполните iola ai key set yandexgpt или задайте YANDEXGPT_API_KEY и YANDEXGPT_FOLDER_ID.");
  }

  const model = config.model || "yandexgpt-lite/latest";
  const modelUri = model.startsWith("gpt://") ? model : `gpt://${folderId}/${model}`;
  const response = await fetch(`${String(config.baseUrl || "https://llm.api.cloud.yandex.net/foundationModels/v1").replace(/\/+$/, "")}/completion`, {
    method: "POST",
    headers: {
      authorization: `Api-Key ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      modelUri,
      completionOptions: {
        stream: false,
        temperature: Number(config.temperature ?? 0.2),
        maxTokens: String(config.maxTokens || 2000),
      },
      messages: messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
        text: message.content,
      })),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YandexGPT request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, apiKey)}`);
  }

  const payload = await response.json();
  return payload.result?.alternatives?.[0]?.message?.text || "";
}

async function callGigaChat(config, messages) {
  const authKey = await getApiKey("gigachat");
  if (!authKey) {
    throw new Error("GigaChat authorization key не найден. Выполните iola ai key set gigachat или задайте GIGACHAT_AUTH_KEY.");
  }

  const token = await getGigaChatAccessToken(config, authKey);
  let response;
  try {
    response = await fetch(`${String(config.baseUrl || "https://gigachat.devices.sberbank.ru/api/v1").replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || "GigaChat-2",
        messages,
        temperature: Number(config.temperature ?? 0.2),
      }),
    });
  } catch (error) {
    throw new Error(formatProviderFetchError("GigaChat", error));
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GigaChat request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, token)}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || "";
}

async function getGigaChatAccessToken(config, authKey) {
  enableSystemCaForGigaChat();
  const secrets = await loadSecrets();
  const scope = process.env.GIGACHAT_SCOPE || secrets.gigachat?.scope || config.scope || "GIGACHAT_API_PERS";
  let response;
  try {
    response = await fetch(config.authUrl || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
      method: "POST",
      headers: {
        authorization: `Basic ${authKey}`,
        "content-type": "application/x-www-form-urlencoded",
        RqUID: randomUUID(),
      },
      body: new URLSearchParams({ scope }).toString(),
    });
  } catch (error) {
    throw new Error(formatProviderFetchError("GigaChat OAuth", error));
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GigaChat token request failed: ${response.status} ${response.statusText}\n${sanitizeSecretFromText(text, authKey)}`);
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error("GigaChat не вернул access_token.");
  return payload.access_token;
}

let systemCaForGigaChatEnabled = false;

function enableSystemCaForGigaChat() {
  if (systemCaForGigaChatEnabled || process.env.GIGACHAT_DISABLE_SYSTEM_CA === "1") return;
  systemCaForGigaChatEnabled = true;

  try {
    if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") return;
    const certificates = [
      ...tls.getCACertificates("system"),
      ...tls.getCACertificates("bundled"),
      ...tls.getCACertificates("extra"),
    ];
    if (certificates.length > 0) tls.setDefaultCACertificates([...new Set(certificates)]);
  } catch {
    // Older Node builds may not expose system CA management. The fetch error below
    // will include the concrete TLS/network cause and the manual workaround.
  }
}

function formatProviderFetchError(provider, error) {
  const cause = error?.cause;
  const causeCode = cause?.code ? `${cause.code}: ` : "";
  const causeMessage = cause?.message || "";
  const details = `${error?.message || "fetch failed"}${causeMessage ? ` (${causeCode}${causeMessage})` : ""}`;
  if (/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|CERT_/i.test(`${cause?.code || ""} ${causeMessage}`)) {
    return `${provider} network error: ${details}\nNode не доверяет цепочке сертификатов провайдера. CLI пробует использовать системные сертификаты ОС автоматически; если ошибка повторяется, обновите Node.js или запустите CLI с NODE_OPTIONS=--use-system-ca.`;
  }
  return `${provider} network error: ${details}`;
}

function getAiNetworkMode(config = {}) {
  return validateAiNetworkMode(AI_NETWORK_MODE || config.networkMode || "gateway");
}

function validateAiNetworkMode(value) {
  const mode = String(value || "").trim().toLocaleLowerCase("en-US");
  if (mode === "direct" || mode === "gateway" || mode === "auto") return mode;
  throw new Error("AI network mode должен быть direct, gateway или auto.");
}

function isNetworkFallbackError(error) {
  const message = String(error?.message || "");
  return /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|TLS|proxy|network/i.test(message);
}

function sanitizeSecretFromText(text, secret) {
  const source = String(text || "");
  if (!secret) return source;
  return source.split(secret).join("[redacted]");
}

async function getApiKey(provider) {
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  if (provider === "yandexgpt" && (process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY)) {
    return process.env.YANDEXGPT_API_KEY || process.env.YANDEX_CLOUD_API_KEY;
  }

  if (provider === "gigachat" && (process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_API_KEY)) {
    return process.env.GIGACHAT_AUTH_KEY || process.env.GIGACHAT_API_KEY;
  }

  const secrets = await loadSecrets();
  if (provider === "yandexgpt") return secrets.yandexCloud?.yandexgptApiKey || secrets.yandexgpt?.apiKey || "";
  return secrets[provider]?.apiKey || "";
}

async function getYandexFolderId() {
  if (process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID) {
    return process.env.YANDEXGPT_FOLDER_ID || process.env.YANDEX_CLOUD_FOLDER_ID;
  }
  const secrets = await loadSecrets();
  return secrets.yandexCloud?.folderId || secrets.yandexgpt?.folderId || "";
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
  if (components.length === 0) {
    markFirstRunCompleted();
    console.log("Мастер пропущен. Переход в CLI.");
    return;
  }
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
    if (process.stdin.isTTY) {
      await setAiKey("openai");
      await chooseAndSaveApiModel("openai");
    }
  }
  if (components.includes("openrouter")) {
    await aiSetup(["openrouter"]);
    if (process.stdin.isTTY) {
      await setAiKey("openrouter");
      await chooseAndSaveApiModel("openrouter");
    }
  }
  if (components.includes("gigachat")) {
    await aiSetup(["gigachat"]);
    if (process.stdin.isTTY) {
      await setAiKey("gigachat");
      await chooseAndSaveApiModel("gigachat");
    }
  }
  if (components.includes("cloud")) {
    if (process.stdin.isTTY) {
      const providerAnswer = (await askText("Облачный диск: 1 - Яндекс Диск, 2 - Облако Mail.ru, 0 - пропустить: ")).trim();
      if (providerAnswer === "1") await setupCloudProvider("yandex-disk");
      else if (providerAnswer === "2") await setupCloudProvider("mailru-cloud");
      else console.log("Настройка облачного диска пропущена.");
    }
  }
  if (components.includes("yandex")) {
    await setupYandexConnector([]);
  }
  if (components.includes("yandex-cloud")) {
    await setupYandexCloudConnector({});
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
  console.log("0. выход в CLI [без настройки] - пропустить мастер");
  for (const item of onboardComponentRows(componentStatus)) {
    console.log(`${item.number}. ${item.title} [${item.status}] - ${item.hint}`);
  }
  console.log("");
  const rl = readline.createInterface({ input, output });
  try {
    const defaults = defaultOnboardSelection(componentStatus);
    const answer = (await rl.question(`Компоненты [${defaults.join(",")}], 0 - выход в CLI: `)).trim() || defaults.join(",");
    if (isOnboardExitAnswer(answer)) return [];
    const selected = new Set(answer.split(/[,\s]+/).filter(Boolean));
    const map = {
      1: "workspace",
      2: "policy",
      3: "iola",
      4: "gigachat",
      5: "openai",
      6: "openrouter",
      7: "codex",
      8: "codex-mcp",
      9: "archive",
      10: "index",
      11: "browser",
      12: "ollama",
      13: "yandex",
      14: "yandex-cloud",
      15: "yandex-cloud",
    };
    return [...selected].map((item) => map[item] || item).filter(Boolean);
  } finally {
    rl.close();
  }
}

function isOnboardExitAnswer(answer) {
  return /^(0|q|quit|exit|\/exit|skip|пропустить|выход)$/iu.test(String(answer || "").trim());
}

async function getOnboardComponentStatus() {
  const [config, readiness, browser, archive, codexVersion, ollamaVersion, yandexGeocoderKey, secrets] = await Promise.all([
    loadConfig(),
    getAiReadiness(),
    getBrowserStatus(),
    findCommand(["7z", "7zz", "7za"], ["--help"]).catch(() => null),
    getCommandVersion("codex", ["--version"]),
    getOllamaVersion(),
    getYandexGeocoderKey(),
    loadSecrets(),
  ]);
  const workspaceReady = existsSync(PROJECT_CONTEXT_FILE) || existsSync(PROJECT_CONTEXT_DIR_FILE) || existsSync(PROJECT_IOLA_DIR);
  const policyReady = (config.toolsets?.enabled || []).includes("analyst");
  return {
    workspace: workspaceReady,
    policy: policyReady,
    iola: Boolean(readiness.iola),
    ollama: Boolean(ollamaVersion && readiness.ollama),
    "yandex-cloud": Boolean(yandexGeocoderKey || readiness.yandexgpt),
    gigachat: Boolean(readiness.gigachat),
    openai: Boolean(readiness.openai),
    openrouter: Boolean(readiness.openrouter),
    codex: Boolean(codexVersion !== "не найден" && readiness.codex),
    "codex-mcp": false,
    archive: Boolean(archive),
    index: false,
    browser: browser.installed === "yes",
    yandex: isYandexConnectorFullyConnected(secrets),
  };
}

function onboardComponentRows(status) {
  const rows = [
    ["1", "workspace", "workspace и контекст", "рабочая папка, IOLA.md и .iola/context.md"],
    ["2", "policy", "policy analyst", "разрешения и профиль аналитика"],
    ["3", "iola", "IOLA локальная модель", "локальная модель найдена"],
    ["4", "gigachat", "GigaChat API", "authorization key сохранен или есть в env"],
    ["5", "openai", "OpenAI API", "API-ключ сохранен или есть в env"],
    ["6", "openrouter", "OpenRouter API", "API-ключ сохранен или есть в env"],
    ["7", "codex", "Codex CLI", "CLI установлен и авторизация найдена"],
    ["8", "codex-mcp", "MCP для Codex", "можно переустановить/обновить"],
    ["9", "archive", "7-Zip / архивы", "архиватор найден"],
    ["10", "index", "Индекс локальных документов", "настраивается под выбранную папку"],
    ["11", "browser", "Browser runtime", "Playwright/Chromium установлен"],
    ["12", "ollama", "Ollama", "опциональный локальный runtime"],
    ["13", "yandex", "Yandex Connector", "единый вход и категории сервисов Яндекса"],
    ["14", "yandex-cloud", "Yandex Cloud Connector", "геокодинг и YandexGPT"],
  ];
  return rows.map(([number, key, title, hint]) => ({ number, key, title, hint, status: status[key] ? "готово" : "не настроено" }));
}

function defaultOnboardSelection(status) {
  const defaults = [];
  if (!status.workspace) defaults.push("1");
  if (!status.policy) defaults.push("2");
  if (!status.iola) defaults.push("3");
  if (!status.archive) defaults.push("9");
  return defaults.length ? defaults : ["1", "2"];
}

function defaultOnboardComponents(status) {
  const map = { 1: "workspace", 2: "policy", 3: "iola", 4: "gigachat", 5: "openai", 6: "openrouter", 7: "codex", 8: "codex-mcp", 9: "archive", 10: "index", 11: "browser", 12: "ollama", 13: "yandex", 14: "yandex-cloud", 15: "yandex-cloud" };
  return defaultOnboardSelection(status).map((item) => map[item]).filter(Boolean);
}

function parseOptions(args) {
  const result = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--yes" || arg === "--silent" || arg === "--events" || arg === "--stream-json" || arg === "--stdio" || arg === "--system" || arg === "--headed" || arg === "--headless" || arg === "--no-history" || arg === "--summary" || arg === "--all" || arg === "--full" || arg === "--unread" || arg === "--once" || arg === "--local" || arg === "--cache" || arg === "--tools" || arg === "--files" || arg === "--plan" || arg === "--trace" || arg === "--diff" || arg === "--stage" || arg === "--fts" || arg === "--bare" || arg === "--quiet" || arg === "--optional" || arg === "--project" || arg === "--dry-run" || arg === "--no-color" || arg === "--fail-on-empty" || arg === "--debug" || arg === "--fix" || arg === "--force" || arg === "--append" || arg === "--preserve-active" || arg === "--open" || arg === "--print-url" || arg === "--enable" || arg === "--email" || arg === "--backup") {
      result[arg.slice(2)] = true;
    } else if (arg === "--check" || arg === "--upgrade-node") {
      result.check = true;
      result[arg.slice(2)] = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--replace" || arg === "--text" || arg === "--path" || arg === "--depth" || arg === "--max-bytes" || arg === "--query" || arg === "--where" || arg === "--columns" || arg === "--inn" || arg === "--model" || arg === "--provider" || arg === "--profile" || arg === "--name" || arg === "--source" || arg === "--command" || arg === "--prompt" || arg === "--description" || arg === "--instructions" || arg === "--allowed-tools" || arg === "--tool" || arg === "--uses" || arg === "--template" || arg === "--minutes" || arg === "--days" || arg === "--time" || arg === "--horizon" || arg === "--base-url" || arg === "--repo" || arg === "--model-dir" || arg === "--sandbox" || arg === "--approval" || arg === "--cwd" || arg === "--codex-profile" || arg === "--format" || arg === "--output" || arg === "--schema" || arg === "--session" || arg === "--temperature" || arg === "--config" || arg === "--dataset" || arg === "--save" || arg === "--reasoning" || arg === "--agent" || arg === "--scope" || arg === "--selector" || arg === "--url" || arg === "--timeout" || arg === "--wait" || arg === "--viewport" || arg === "--press" || arg === "--script" || arg === "--auth-url" || arg === "--token-url" || arg === "--userinfo-url" || arg === "--client-id" || arg === "--client-secret" || arg === "--redirect-url" || arg === "--redirect-host" || arg === "--redirect-port" || arg === "--redirect-path" || arg === "--debug-file" || arg === "--from" || arg === "--to" || arg === "--radius" || arg === "--address" || arg === "--token" || arg === "--app" || arg === "--tariff" || arg === "--class" || arg === "--level" || arg === "--ref" || arg === "--lang") {
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

function printSkillsList(skills, config) {
  if (!skills.length) {
    console.log("Нет данных.");
    return;
  }
  const nameWidth = Math.min(28, Math.max(5, ...skills.map((skill) => visibleLength(skill.name))));
  console.log(`${padCell("Вкл", 3)}  ${padCell("Skill", nameWidth)}  Описание`);
  console.log(`${"-".repeat(3)}  ${"-".repeat(nameWidth)}  ${"-".repeat(8)}`);
  for (const skill of skills) {
    const enabled = isSkillEnabled(config, skill.name) ? "yes" : "no";
    console.log(`${padCell(enabled, 3)}  ${padCell(skill.name, nameWidth)}  ${skill.description || "-"}`);
  }
}

async function executeUserSkillTool(tool, args = {}) {
  if (tool === "user_skill_list") return listSkills(await loadConfig()).filter((skill) => skill.source === "user");
  if (tool === "user_skill_create") return userSkillCreate({ ...args, confirm: args.confirm === true });
  if (tool === "user_skill_update") return userSkillUpdate(args.name, { ...args, confirm: args.confirm === true });
  if (tool === "user_skill_enable") return userSkillSetEnabled(args.name, true);
  if (tool === "user_skill_disable") return userSkillSetEnabled(args.name, false);
  if (tool === "user_skill_delete") return userSkillDelete(args.name, { confirm: args.confirm === true });
  if (tool === "user_skill_templates") return userSkillTemplates();
  if (tool === "user_skill_validate") return userSkillValidate(args.name);
  if (tool === "user_skill_preview") return { status: "preview", text: buildUserSkillPreview(args) };
  throw new Error(`Неизвестный user skill tool: ${tool}`);
}

async function userSkillCreate(args = {}) {
  if (!args.confirm) throw new Error("Для создания пользовательского skill нужен аргумент confirm=true.");
  const name = normalizeUserSkillName(args.name || args.skill || args.title);
  if (!name) throw new Error("Имя skill обязательно.");
  const template = getUserSkillTemplate(args.template);
  const description = String(args.description || template?.description || `Пользовательский skill: ${name}`).trim();
  const instructions = String(args.instructions || args.text || args.prompt || template?.instructions || "").trim();
  if (!instructions) throw new Error("Инструкции skill обязательны.");
  const tools = parseCommaList(args.tools || args.allowedTools || args.allowed_tools || args.uses || "");
  const mergedTools = [...new Set([...(template?.tools || []), ...tools])];
  const dir = path.join(USER_SKILLS_DIR, name);
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file) && !args.overwrite) throw new Error(`Skill уже существует: ${name}. Используйте overwrite=true или --force.`);
  await mkdir(dir, { recursive: true });
  const body = buildUserSkillMarkdown({ name, description, instructions, tools: mergedTools });
  await writeFile(file, body, "utf8");
  let enabled = false;
  if (args.enable) {
    await userSkillSetEnabled(name, true);
    enabled = true;
  }
  return { name, description, file, enabled, tools: mergedTools, status: "created" };
}

async function userSkillUpdate(name, args = {}) {
  if (!args.confirm) throw new Error("Для обновления пользовательского skill нужен confirm=true.");
  const skillName = normalizeUserSkillName(name || args.name || args.skill);
  if (!skillName) throw new Error("Имя skill обязательно.");
  const file = path.join(USER_SKILLS_DIR, skillName, "SKILL.md");
  if (!existsSync(file)) throw new Error(`Пользовательский skill не найден: ${skillName}`);
  const current = await readFile(file, "utf8");
  const meta = readSkillMeta(file);
  const description = String(args.description || meta.description || `Пользовательский skill: ${skillName}`).trim();
  const instructions = String(args.instructions || args.text || args.prompt || stripFrontmatter(current)).trim();
  const tools = parseCommaList(args.tools || args.allowedTools || args.allowed_tools || args.uses || inferUserSkillTools(instructions));
  const body = buildUserSkillMarkdown({ name: skillName, description, instructions, tools });
  await writeFile(file, body, "utf8");
  if (args.enable) await userSkillSetEnabled(skillName, true);
  return { name: skillName, description, file, tools, status: "updated" };
}

async function userSkillSetEnabled(name, enabled) {
  const skillName = normalizeUserSkillName(name);
  if (!skillName) throw new Error("Имя skill обязательно.");
  const config = await loadConfig();
  const skill = findSkill(skillName, config);
  if (!skill && enabled) throw new Error(`Skill не найден: ${skillName}`);
  const enabledSet = new Set(config.skills?.enabled || []);
  if (enabled) enabledSet.add(skillName);
  else enabledSet.delete(skillName);
  await saveConfig({ skills: { ...(config.skills || {}), enabled: [...enabledSet] } });
  return { name: skillName, enabled, status: enabled ? "enabled" : "disabled" };
}

async function userSkillDelete(name, options = {}) {
  if (!options.confirm) throw new Error("Для удаления пользовательского skill нужен --yes или confirm=true.");
  const skillName = normalizeUserSkillName(name);
  if (!skillName) throw new Error("Имя skill обязательно.");
  const file = path.join(USER_SKILLS_DIR, skillName, "SKILL.md");
  const dir = path.dirname(file);
  if (!existsSync(file)) throw new Error(`Пользовательский skill не найден: ${skillName}`);
  await rm(dir, { recursive: true, force: true });
  await userSkillSetEnabled(skillName, false);
  return { name: skillName, status: "deleted" };
}

function normalizeUserSkillName(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-z0-9а-яё_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function parseCommaList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\n;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractUserSkillNameFromQuestion(question) {
  const text = String(question || "");
  const quoted = text.match(/[«"]([^»"]+)[»"]/u)?.[1];
  if (quoted) return normalizeUserSkillName(quoted);
  const explicit = text.match(/(?:skill|скилл|скил|навык)\s+([a-z0-9а-яё_-]{3,80})/iu)?.[1]
    || text.match(/(?:создай|добавь|сделай|включи|выключи|удали|удалить)\s+([a-z0-9а-яё_-]{3,80})\s+(?:skill|скилл|скил|навык)/iu)?.[1];
  return normalizeUserSkillName(explicit || "");
}

function extractUserSkillDescription(question, name) {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  const afterColon = text.match(/[:\-]\s*(.+)$/u)?.[1];
  return (afterColon || `Пользовательский skill: ${name}`).slice(0, 180);
}

function inferUserSkillTools(question) {
  const text = String(question || "").toLocaleLowerCase("ru-RU");
  const tools = new Set();
  if (/(почт|письм|email|e-mail)/iu.test(text)) {
    tools.add("yandex_mail_list");
    tools.add("yandex_mail_search");
    tools.add("yandex_mail_read");
  }
  if (/(отправь|отправить|отправляй|ответь|ответить|перешли|переслать|удали|удалить)/iu.test(text) && /(почт|письм|email|e-mail)/iu.test(text)) {
    tools.add("yandex_mail_send");
    tools.add("yandex_mail_reply");
    tools.add("yandex_mail_forward");
    tools.add("yandex_mail_delete");
  }
  if (/(диск|облак|яндекс.?диск)/iu.test(text)) {
    tools.add("yandex_disk_info");
    tools.add("yandex_disk_ls");
    tools.add("yandex_disk_find");
    tools.add("yandex_disk_stat");
    tools.add("yandex_disk_exists");
    tools.add("yandex_disk_read_text");
    tools.add("yandex_disk_save_text");
    tools.add("yandex_disk_upload");
    tools.add("yandex_disk_download");
    tools.add("yandex_disk_share");
    tools.add("yandex_disk_unshare");
    tools.add("yandex_disk_move");
    tools.add("yandex_disk_copy");
    tools.add("yandex_disk_rename");
    tools.add("yandex_disk_delete");
    tools.add("yandex_disk_trash_list");
    tools.add("yandex_disk_restore");
  }
  if (/(календар|событи|встреч|телемост)/iu.test(text)) {
    tools.add("yandex_calendar_list");
    tools.add("yandex_calendar_search");
    tools.add("yandex_calendar_create_event");
    tools.add("yandex_calendar_update");
    tools.add("yandex_calendar_move");
    tools.add("yandex_calendar_delete");
    tools.add("yandex_calendar_add_reminder");
    tools.add("yandex_telemost_create_event");
  }
  if (/(документ|docs|360)/iu.test(text)) {
    tools.add("yandex_docs_list");
    tools.add("yandex_docs_find");
    tools.add("yandex_docs_create_text");
    tools.add("yandex_docs_read");
    tools.add("yandex_docs_share");
    tools.add("yandex_docs_rename");
    tools.add("yandex_docs_delete");
  }
  if (/(контакт|адресн)/iu.test(text)) {
    tools.add("yandex_contacts_search");
    tools.add("yandex_contacts_get");
    tools.add("yandex_contacts_create");
    tools.add("yandex_contacts_update");
    tools.add("yandex_contacts_delete");
    tools.add("yandex_contacts_add_email");
    tools.add("yandex_contacts_add_phone");
    tools.add("yandex_contacts_add_address");
    tools.add("yandex_contacts_add_note");
    tools.add("yandex_contacts_add_birthday");
    tools.add("yandex_contacts_add_org");
    tools.add("yandex_contacts_export_csv");
    tools.add("yandex_contacts_find_incomplete");
    tools.add("yandex_contacts_find_duplicates");
    tools.add("yandex_contacts_backup_to_disk");
    tools.add("yandex_contact_send_mail");
    tools.add("yandex_contact_send_disk_link_qr");
    tools.add("yandex_contact_create_disk_folder");
    tools.add("yandex_contact_create_calendar_event");
    tools.add("yandex_contact_create_telemost_event");
  }
  if (/(файл|папк|документ|архив)/iu.test(text)) {
    tools.add("files_tree");
    tools.add("files_read");
    tools.add("files_search");
  }
  if (/(запиши|сохрани|создай файл|измени|исправ)/iu.test(text) && /(файл|папк|документ|архив)/iu.test(text)) {
    tools.add("files_write");
    tools.add("files_patch");
  }
  if (/(школ|сад|детсад|инн|адрес|телефон|открыт)/iu.test(text)) {
    tools.add("search_data");
    tools.add("get_card");
    tools.add("export_report");
  }
  if (/(сайт|страниц|браузер|url|ссылка)/iu.test(text)) tools.add("browser_open");
  return [...tools];
}

function userSkillTemplates() {
  return [
    {
      name: "mail-triage",
      description: "Разбор почты: найти важные письма, прочитать, сохранить, создать задачу или событие.",
      tools: ["yandex_mail_list", "yandex_mail_search", "yandex_mail_read", "yandex_mail_save_to_disk", "yandex_mail_create_calendar_event", "yandex_mail_create_task"],
      instructions: "Помогай разбирать почту пользователя. Сначала показывай краткую сводку, затем выполняй только явно запрошенные действия: чтение, сохранение письма на Диск, создание события или задачи.",
    },
    {
      name: "family-calendar",
      description: "Семейный календарь: события, напоминания, встречи и ежедневные проверки.",
      tools: ["yandex_calendar_list", "yandex_calendar_search", "yandex_calendar_create_event", "yandex_calendar_move", "yandex_calendar_add_reminder", "yandex_calendar_delete", "yandex_calendar_reminders_tick"],
      instructions: "Помогай вести личный календарь. Для изменения календаря требуй явную просьбу пользователя. Всегда называй дату и время события.",
    },
    {
      name: "docs-organizer",
      description: "Организация документов на Яндекс Диске.",
      tools: ["yandex_docs_list", "yandex_docs_find", "yandex_docs_create_text", "yandex_docs_read", "yandex_docs_share", "yandex_docs_rename", "yandex_docs_delete", "yandex_disk_maintenance_tick"],
      instructions: "Помогай искать, создавать и приводить в порядок документы на Яндекс Диске. Не путай облачные документы с локальными файлами на компьютере.",
    },
    {
      name: "contact-workflow",
      description: "Работа с контактами, письмами, встречами и папками контактов.",
      tools: ["yandex_contacts_search", "yandex_contacts_get", "yandex_contact_send_mail", "yandex_contact_send_disk_link_qr", "yandex_contact_create_disk_folder", "yandex_contact_create_calendar_event", "yandex_contact_full_pack"],
      instructions: "Помогай выполнять действия вокруг контакта: найти карточку, отправить письмо, создать папку, отправить ссылку или создать встречу. Если найдено несколько контактов, проси уточнение.",
    },
  ];
}

function getUserSkillTemplate(name) {
  const normalized = normalizeUserSkillName(name || "");
  return userSkillTemplates().find((item) => item.name === normalized) || null;
}

function buildUserSkillPreview(args = {}) {
  const name = normalizeUserSkillName(args.name || args.skill || args.title || "user-skill");
  const template = getUserSkillTemplate(args.template);
  const description = args.description || template?.description || `Пользовательский skill: ${name}`;
  const instructions = args.instructions || args.text || args.prompt || template?.instructions || "Опишите, что должен делать skill.";
  const tools = [...new Set([...(template?.tools || []), ...parseCommaList(args.tools || args.allowedTools || args.allowed_tools || args.uses || inferUserSkillTools(instructions))])];
  return buildUserSkillMarkdown({ name, description, instructions, tools });
}

async function userSkillValidate(name) {
  const config = await loadConfig();
  const skill = findSkill(normalizeUserSkillName(name), config);
  const checks = [];
  if (!skill) {
    return { status: "error", checks: [{ check: "exists", status: "error", message: `Skill не найден: ${name || "-"}` }] };
  }
  const text = await readFile(skill.file, "utf8");
  const meta = readSkillMeta(skill.file);
  checks.push({ check: "exists", status: "ok", message: skill.file });
  checks.push({ check: "name", status: meta.name ? "ok" : "error", message: meta.name || "Нет name во frontmatter" });
  checks.push({ check: "description", status: meta.description ? "ok" : "warn", message: meta.description || "Описание пустое" });
  checks.push({ check: "instructions", status: stripFrontmatter(text).trim().length >= 40 ? "ok" : "warn", message: "Инструкции должны быть понятными и достаточно подробными" });
  checks.push({ check: "secrets", status: /(token|api[_-]?key|парол|секрет)\s*[:=]\s*\S{8,}/iu.test(text) ? "error" : "ok", message: "Skill не должен содержать секреты" });
  const tools = [...text.matchAll(/`([a-z0-9_:-]+)`/giu)].map((match) => match[1]).filter((tool) => ALL_TOOL_ALIASES.includes(tool) || tool.startsWith("mcp:"));
  const unknownTools = tools.filter((tool) => !ALL_TOOL_ALIASES.includes(tool) && !tool.startsWith("mcp:"));
  checks.push({ check: "tools", status: unknownTools.length ? "warn" : "ok", message: unknownTools.length ? `Неизвестные tools: ${unknownTools.join(", ")}` : `${tools.length} tools` });
  return { status: checks.some((row) => row.status === "error") ? "error" : "ok", checks };
}

function buildUserSkillMarkdown({ name, description, instructions, tools = [] }) {
  const toolLines = tools.length
    ? ["", "Разрешенные/ожидаемые tools для этого skill:", "", ...tools.map((tool) => `- \`${tool}\``)]
    : [];
  return [
    "---",
    `name: ${name}`,
    `description: ${description.replace(/\r?\n/g, " ")}`,
    "source: user",
    "---",
    "",
    instructions.trim(),
    "",
    "Правила безопасности:",
    "",
    "- Используй только встроенные tools `iola-cli` и подключенные MCP/Yandex/local-files механизмы.",
    "- Не выводи секреты, OAuth-токены, API-ключи и пароли.",
    "- Для записи, удаления, отправки писем, публикации ссылок и изменения внешних сервисов требуется явная просьба пользователя.",
    "- Если действие неоднозначно, сначала уточни у пользователя цель и место выполнения.",
    ...toolLines,
    "",
  ].join("\n");
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
  if (enabled.has("geo") && isGeoQuestion(normalized)) selected.add("geo");
  const cloudQuestion = isCloudQuestion(normalized);
  if (enabled.has("personal-docs") && cloudQuestion) selected.add("personal-docs");
  if (enabled.has("yandex-services") && /(яндекс|диск|почт|письм|календар|контакт|телемост|документ|docs|360|облако)/iu.test(normalized)) selected.add("yandex-services");
  if (enabled.has("reports") && /(отчет|отчёт|выгруз|csv|xlsx|качество|провер)/iu.test(normalized)) selected.add("reports");
  if (enabled.has("local-files") && !cloudQuestion && (options.files || /(файл|папк|readme|документ|архив)/iu.test(normalized))) selected.add("local-files");
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
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest?t=${Date.now()}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
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
  if (!recommendation) {
    return;
  }
  console.log("");
  console.log("Рекомендация локальной модели");
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
    cloud: {
      ...base.cloud,
      ...(override.cloud || {}),
      providers: {
        ...(base.cloud?.providers || {}),
        ...(override.cloud?.providers || {}),
      },
    },
    yandex: {
      ...base.yandex,
      ...(override.yandex || {}),
      oauth: {
        ...(base.yandex?.oauth || {}),
        ...(override.yandex?.oauth || {}),
      },
      categories: {
        ...(base.yandex?.categories || {}),
        ...(override.yandex?.categories || {}),
      },
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
  next.api = next.api || {};
  next.api.aiRelayBaseUrl = next.api.aiRelayBaseUrl || AI_RELAY_BASE_URL;
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
  if (Array.isArray(next.skills?.enabled) && next.skills.enabled.includes("open-data") && !next.skills.enabled.includes("geo")) {
    next.skills.enabled = [...next.skills.enabled, "geo"];
  }
  if (Array.isArray(next.skills?.enabled) && next.skills.enabled.includes("local-files") && !next.skills.enabled.includes("personal-docs")) {
    next.skills.enabled = [...next.skills.enabled, "personal-docs"];
  }
  next.toolsets = next.toolsets || {};
  next.toolsets.enabled = [...new Set([...(next.toolsets.enabled || []), "user-skills"])];
  next.skills = next.skills || {};
  next.skills.enabled = [...new Set([...(next.skills.enabled || []), "user-skills"])];
  if (Array.isArray(next.yandex?.enabledServices)) {
    next.yandex.enabledServices = next.yandex.enabledServices.filter((service) => Boolean(YANDEX_CONNECTOR_SERVICES[service]));
  }
  if (Array.isArray(next.yandex?.authorizedServices)) {
    next.yandex.authorizedServices = next.yandex.authorizedServices.filter((service) => Boolean(YANDEX_CONNECTOR_SERVICES[service]));
  }
  if (Array.isArray(next.yandex?.enabledServices) && next.yandex.enabledServices.length > 0) {
    next.toolsets = next.toolsets || {};
    next.toolsets.enabled = [...new Set([...(next.toolsets.enabled || []), "yandex"])];
    next.skills = next.skills || {};
    next.skills.enabled = [...new Set([...(next.skills.enabled || []), "yandex-services"])];
  }
  const localProfile = next.ai?.profiles?.local;
  if (localProfile?.provider === "iola") {
    if (!localProfile.runtime || localProfile.model === "iola-router-1b") {
      localProfile.runtime = "ollama";
      localProfile.model = IOLA_LOCAL_MODEL;
      localProfile.baseUrl = localProfile.baseUrl || "http://127.0.0.1:11434";
      localProfile.ggufRepo = localProfile.ggufRepo || IOLA_ROUTER_GGUF_REPO;
      localProfile.ggufFile = localProfile.ggufFile || IOLA_ROUTER_GGUF_FILE;
      localProfile.modelDir = localProfile.modelDir || IOLA_MODEL_DIR;
    }
  }
  if (next.ai?.activeProfile === "local" && next.ai.provider === "iola" && next.ai.model === "iola-router-1b") {
    next.ai.model = IOLA_LOCAL_MODEL;
    next.ai.baseUrl = next.ai.baseUrl || "http://127.0.0.1:11434";
  }
  for (const profile of Object.values(next.ai?.profiles || {})) {
    if (profile?.provider === "openai" || profile?.provider === "openrouter") {
      profile.networkMode = profile.networkMode || "gateway";
    }
    if (profile?.provider === "yandexgpt" || profile?.provider === "gigachat") {
      profile.networkMode = profile.networkMode || "direct";
    }
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
    if (!["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"].includes(profile.provider)) errors.push(`ai.profiles.${name}.provider неизвестен`);
    if (profile.provider !== "codex" && profile.provider !== "iola" && !profile.baseUrl) errors.push(`ai.profiles.${name}.baseUrl обязателен`);
    if (profile.networkMode && !["direct", "gateway", "auto"].includes(profile.networkMode)) errors.push(`ai.profiles.${name}.networkMode должен быть direct, gateway или auto`);
  }
  for (const tool of Object.keys(config.permissions?.localTools || {})) {
    if (!ALL_TOOL_ALIASES.includes(tool)) errors.push(`permissions.localTools.${tool} неизвестен`);
  }
  for (const toolset of config.toolsets?.enabled || []) {
    if (!TOOLSETS[toolset]) errors.push(`toolsets.enabled содержит неизвестный toolset: ${toolset}`);
  }
  if (config.cloud?.activeProvider && !["yandex-disk", "mailru-cloud"].includes(config.cloud.activeProvider)) {
    errors.push(`cloud.activeProvider неизвестен: ${config.cloud.activeProvider}`);
  }
  for (const service of config.yandex?.enabledServices || []) {
    if (!YANDEX_CONNECTOR_SERVICES[service]) errors.push(`yandex.enabledServices содержит неизвестный сервис: ${service}`);
  }
  for (const service of config.yandex?.authorizedServices || []) {
    if (!YANDEX_CONNECTOR_SERVICES[service]) errors.push(`yandex.authorizedServices содержит неизвестный сервис: ${service}`);
  }
  return errors;
}

function configSchema() {
  return {
    type: "object",
    required: ["api", "ai"],
    properties: {
      api: { required: ["baseUrl", "mcpBaseUrl"] },
      ai: { required: ["activeProfile", "profiles"], providers: ["iola", "ollama", "yandexgpt", "gigachat", "openai", "openrouter", "codex"] },
      permissions: { localTools: ALL_LOCAL_TOOLS, runtime: ["readFiles", "writeFiles", "editFiles", "deleteFiles", "sync", "externalApi", "externalAi", "codex"] },
      toolsets: { available: Object.keys(TOOLSETS) },
      files: { modes: ["locked", "read-only", "workspace-write", "full-access"], approvals: ["never", "on-write", "on-danger", "always"] },
      cloud: { providers: ["yandex-disk", "mailru-cloud"], root: CLOUD_DEFAULT_REMOTE_DIR },
      yandex: { services: Object.keys(YANDEX_CONNECTOR_SERVICES), statuses: ["ready", "research", "separate", "backlog"] },
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

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

function printKeyValueFull(value) {
  const rows = Object.entries(value).map(([key, raw]) => ({
    key,
    value: raw == null || raw === "" ? "-" : String(raw),
  }));
  const keyWidth = Math.max(4, ...rows.map((row) => visibleLength(row.key)));
  console.log(`${padCell("Поле", keyWidth)}  Значение`);
  console.log(`${"-".repeat(keyWidth)}  ${"-".repeat(8)}`);
  for (const row of rows) {
    console.log(`${padCell(row.key, keyWidth)}  ${row.value}`);
  }
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
