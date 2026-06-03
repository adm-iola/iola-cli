# Security Policy

## Security model

`iola-cli` is a local command line assistant. It is intentionally powerful and can:

- read and write local files when the user enables file permissions;
- store local configuration and secrets under `~/.iola`;
- call external APIs configured by the user;
- start local helper processes such as Node.js, npm, Ollama, Codex CLI, Playwright and ffmpeg;
- open browser pages through the optional browser runtime.

This is expected behavior for the product. It also means the CLI should be installed only on a trusted machine and used under the user's own OS account.

## Secrets

Secrets are stored locally in:

```text
~/.iola/secrets.json
```

Examples include API keys, OAuth tokens and personal service credentials. The file is not included in the npm package and is not committed to the repository.

The CLI should not print raw secrets. If a command prints a token, password, RTSP URL with token or API key, treat it as a bug and report it.

## Postinstall

The npm `postinstall` script runs:

```text
node --no-warnings bin/postinstall.js
```

It performs local setup after npm has downloaded the package:

- initializes the local SQLite database;
- checks/installs browser runtime files used by the CLI;
- checks the local IOLA model runtime;
- copies the bundled Yandex OAuth icon to `~/.iola/assets`.

The postinstall script does not read `~/.iola/secrets.json` and does not upload user data.

## Browser automation

Safe browser commands are:

- `iola browser text`
- `iola browser html`
- `iola browser screenshot`
- `iola browser pdf`
- `iola browser click`
- `iola browser type`

Arbitrary browser JavaScript evaluation is disabled by default. To use it, the user must explicitly enable unsafe mode:

```bash
IOLA_ALLOW_BROWSER_EVAL=1 iola browser eval https://example.com --script "document.title" --unsafe-eval
```

Use this only for trusted pages and trusted scripts.

## Security diagnostics

Run:

```bash
iola security doctor
```

The command reports npm audit status, postinstall behavior, local secrets status, browser eval mode and expected shell/network capabilities.

## Reporting

Report security issues privately to the project maintainers. Do not publish working exploits or private tokens in public issues.
