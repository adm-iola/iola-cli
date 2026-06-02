import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = resolve(rootDir, "bin", "iola.js");
const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const cliSource = await readFile(resolve(rootDir, "src", "cli.js"), "utf8");
const postinstallSource = await readFile(resolve(rootDir, "bin", "postinstall.js"), "utf8");

function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      ["--no-warnings", binPath, ...args],
      { cwd: rootDir, encoding: "utf8", timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`iola ${args.join(" ")} failed\n${stdout}${stderr}`));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label} should include ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(text, unexpected, label) {
  if (text.includes(unexpected)) {
    throw new Error(`${label} should not include ${JSON.stringify(unexpected)}`);
  }
}

const version = (await runCli(["version"])).trim();
if (version !== packageJson.version) {
  throw new Error(`version command returned ${version}, expected ${packageJson.version}`);
}

const help = await runCli(["--help"]);
assertIncludes(help, "iola master", "help");
assertIncludes(help, "iola ask", "help");

assertIncludes(cliSource, "force: Boolean(options.force)", "IOLA setup should not force model reinstall by default");
assertIncludes(cliSource, "MAIN_OPENROUTER_DEVELOPERS", "OpenRouter model selection should group models by developer");
assertIncludes(cliSource, "isOpenRouterTextGenerationModel", "OpenRouter model selection should prefer text-generation models");
assertIncludes(cliSource, "console.log(\"  0. Назад\")", "OpenRouter model selection should return to developer menu");
assertIncludes(cliSource, "renderTerminalMarkdown", "AI answers should render inline markdown in the terminal");
assertIncludes(cliSource, "\\x1b[1m$1\\x1b[22m", "AI answer renderer should support bold markdown");
assertIncludes(cliSource, "ensureApiKeyForModelSelection", "API model selection should prompt for missing provider keys");
assertIncludes(cliSource, "isOpenAiTextGenerationModel", "OpenAI model selection should filter technical and legacy models");
assertIncludes(cliSource, "dedupeDatedOpenAiModels", "OpenAI model selection should hide dated duplicates when aliases exist");
assertIncludes(cliSource, "chooseLocalModel", "Local model selection should support IOLA and Ollama models");
assertIncludes(cliSource, "Другая Ollama-модель", "Local model selection should allow manual Ollama model names");
assertIncludes(cliSource, "chooseYandexServicesMenu", "Yandex Connector should have a service selection menu");
assertIncludes(cliSource, "Функции Яндекса.", "Yandex service selection should use a numbered menu");
assertIncludes(cliSource, "Выберите номера функций через запятую", "Yandex service selection should ask for numbers");
assertIncludes(cliSource, "Удалить подключение-коннектор", "Yandex service selection should allow connector deletion");
assertIncludes(cliSource, "getYandexServiceAuthState", "Yandex status should derive permissions from configured OAuth apps");
assertIncludes(cliSource, "OAuth-права встроенного приложения", "Yandex setup should report packaged OAuth app permissions");
assertIncludes(cliSource, "Выбрать активные функции можно командой /yandex", "Yandex setup should direct service selection to /yandex");
assertIncludes(cliSource, "runYandexBrowserOAuth", "Yandex setup should support browser OAuth flow");
assertIncludes(cliSource, "IOLA_YANDEX_OAUTH_CLIENT_ID", "Yandex setup should use a packaged/env OAuth client id");
assertIncludes(cliSource, "IOLA_YANDEX_ORGANIZER_OAUTH_CLIENT_ID", "Yandex setup should support the organizer OAuth app group");
assertIncludes(cliSource, "addressbook:all", "Yandex contacts should use the addressbook OAuth scope");
assertIncludes(cliSource, "Автоматический прием OAuth-токена не сработал", "Yandex OAuth should provide manual token fallback");
assertIncludes(cliSource, "уже подключена, пропускаю", "Yandex setup should skip already connected OAuth app groups");
assertIncludes(cliSource, "IOLA_YANDEX_OAUTH_DEBUG", "Yandex OAuth callback should have debug logging");
assertIncludes(cliSource, "partial (", "Yandex connector status should report partial connections");
assertIncludes(cliSource, "hasYandexOAuthAppToken", "Yandex setup should detect tokens per OAuth app");
assertIncludes(cliSource, "isYandexConnectorFullyConnected", "Yandex master status should require all OAuth app tokens");
assertIncludes(cliSource, "--app", "Yandex token command should persist tokens by OAuth app group");
assertNotIncludes(cliSource, "Сервисы через запятую [identity,disk]", "Yandex setup should not ask for services during connector setup");
if (!packageJson.files.includes("docs/assets/iola-oauth-icon.png")) {
  throw new Error("package files should include the Yandex OAuth icon");
}
assertIncludes(postinstallSource, "process.hrtime.bigint()", "postinstall should use a monotonic timer");
assertIncludes(postinstallSource, "без скачивания и распаковки npm-пакета", "postinstall timing should not imply full npm install time");
assertIncludes(postinstallSource, "IOLA CLI готова за", "postinstall should print total setup duration");

const commands = await runCli(["commands"]);
assertIncludes(commands, "iola browser status|install|open|text|html|screenshot|pdf|click|type|eval", "commands");
assertIncludes(commands, "iola mcp list|status|install|remove|serve [--stdio]", "commands");
assertIncludes(commands, "iola yandex setup|menu|status|services|enable|disable|oauth-url|token", "commands");
assertIncludes(commands, "iola delete", "commands");
assertNotIncludes(commands, "iola uninstall", "commands");
assertNotIncludes(commands, "Госуслуг", "commands");
assertNotIncludes(commands, "gosuslugi", "commands");

const schema = JSON.parse(await runCli(["config", "schema"]));
if (!schema.properties?.api || !schema.properties?.ai) {
  throw new Error("config schema should expose api and ai sections");
}

const skills = await runCli(["skills", "list"]);
assertIncludes(skills, "open-data", "skills list");
assertIncludes(skills, "reports", "skills list");
assertNotIncludes(skills, "gosuslugi", "skills list");

const deletePlan = JSON.parse(await runCli(["delete", "--dry-run", "--json"]));
if (!Array.isArray(deletePlan.willDelete) || deletePlan.willRemovePackage !== "@iola_adm/iola-cli" || !deletePlan.willKeep.includes("Codex CLI")) {
  throw new Error("delete dry-run should list delete targets, npm package, and keep Codex CLI");
}
if (deletePlan.willKeep.includes("npm package files")) {
  throw new Error("delete dry-run should not keep npm package files");
}

const multiSchoolAnswer = await runCli(["ask", "Кто директор школы № 2 и адрес школы № 7?", "--profile", "yandexgpt", "--no-history"]);
assertIncludes(multiSchoolAnswer, "Адамова Наталья Васильевна", "multi school answer");
assertIncludes(multiSchoolAnswer, "улица Первомайская, дом 89", "multi school answer");
assertNotIncludes(multiSchoolAnswer, "улица Осипенко, дом 46\nИсточник: слой schools, МБОУ \"Средняя общеобразовательная школа № 7", "multi school answer");

const externalTownAnswer = await runCli(["ask", "Адрес школы № 1 Козьмодемьянска", "--profile", "yandexgpt", "--no-history"]);
assertIncludes(externalTownAnswer, "Данных по Козьмодемьянске", "external town answer");
assertNotIncludes(externalTownAnswer, "улица Петрова, дом 15", "external town answer");

const semenovkaAnswer = await runCli(["ask", "Адрес школы № 1 Семеновки", "--profile", "yandexgpt", "--no-history"]);
assertIncludes(semenovkaAnswer, "Точную школу № 1 в Семёновке", "semenovka answer");
assertIncludes(semenovkaAnswer, "село Семёновка", "semenovka answer");
assertNotIncludes(semenovkaAnswer, "улица Петрова, дом 15", "semenovka answer");

console.log("smoke tests passed");
