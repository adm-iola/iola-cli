import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = resolve(rootDir, "bin", "iola.js");
const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));

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

const commands = await runCli(["commands"]);
assertIncludes(commands, "iola browser status|install|open|text|html|screenshot|pdf|click|type|eval", "commands");
assertIncludes(commands, "iola mcp list|status|install|remove|serve [--stdio]", "commands");
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

console.log("smoke tests passed");
