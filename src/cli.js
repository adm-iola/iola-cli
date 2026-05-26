const API_BASE_URL = process.env.IOLA_API_BASE_URL || "https://apiiola.yasg.ru/api/v1";
const MCP_BASE_URL = process.env.IOLA_MCP_BASE_URL || "https://apiiola.yasg.ru";

const COMMANDS = new Map([
  ["help", showHelp],
  ["version", showVersion],
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
  console.log(`iola - CLI для открытых данных городского округа "Город Йошкар-Ола"

Usage:
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
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--limit" || arg === "--offset" || arg === "--search" || arg === "--inn") {
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
