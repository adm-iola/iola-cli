const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";

const COMMANDS = new Map([
  ["help", showHelp],
  ["version", showVersion],
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
  console.log(`iola - CLI для открытых данных городского округа "Город Йошкар-Ола"

Usage:
  iola layers
  iola schools [--limit 10] [--search TEXT]
  iola kindergartens [--limit 10] [--search TEXT]
  iola search TEXT [--limit 5]
  iola mcp-info
  iola setup codex
  iola version

Environment:
  IOLA_API_BASE_URL   default: ${API_BASE_URL}
  IOLA_MCP_BASE_URL   default: ${MCP_BASE_URL}
`);
}

async function showVersion() {
  const packageJson = await import("../package.json", { with: { type: "json" } });
  console.log(packageJson.default.version);
}

async function listLayers() {
  const info = await fetchJson(`${MCP_BASE_URL}/mcp-version`);
  printJson(info.data_layers);
}

async function showMcpInfo() {
  const info = await fetchJson(`${MCP_BASE_URL}/mcp-version`);
  printJson(info);
}

async function listSchools(args) {
  await listDataset("schools", args);
}

async function listKindergartens(args) {
  await listDataset("kindergartens", args);
}

async function listDataset(dataset, args) {
  const options = parseOptions(args);
  const params = new URLSearchParams();
  params.set("limit", options.limit || "20");
  params.set("offset", options.offset || "0");

  const data = await fetchJson(`${API_BASE_URL}/${dataset}?${params}`);
  const items = normalizeItems(data);
  const filtered = options.search ? filterItems(items, options.search) : items;
  printJson(filtered.slice(0, Number(options.limit || 20)));
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

  printJson(result);
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
    if (arg === "--limit" || arg === "--offset" || arg === "--search") {
      result[arg.slice(2)] = args[index + 1];
      index += 1;
    } else {
      result._.push(arg);
    }
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
