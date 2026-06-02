import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = resolve(rootDir, "bin", "iola.js");
const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const cliSource = await readFile(resolve(rootDir, "src", "cli.js"), "utf8");

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

const commands = await runCli(["commands"]);
assertIncludes(commands, "iola browser status|install|open|text|html|screenshot|pdf|click|type|eval", "commands");
assertIncludes(commands, "iola mcp list|status|install|remove|serve [--stdio]", "commands");
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

console.log("smoke tests passed");
