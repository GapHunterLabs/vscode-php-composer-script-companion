# PHP Composer Script Companion (VS Code)

Flags an orphan `composer.json` script — never called from itself, CI
configs, or `README.md`. No data leaves your editor.

**v0.1, pilot.** Part of the Gap Hunter Labs VS Code workstream,
ported from the IntelliJ-family `php-composer-script-companion`.

## What it does

Checks the exact script's own `"name"` (calling another script in the
same `composer.json`), GitHub Actions/GitLab CI/CircleCI configs, and
`README.md` for a real `composer run-script <name>` or `composer
<name>` invocation — Composer's own two documented ways to run a
script. A Composer lifecycle event name (`post-install-cmd`, etc.) or
a `pre-`/`post-` pair around a real sibling script is never flagged;
Composer itself calls those automatically.

Live in the editor: open `composer.json` and each script with no
reference anywhere gets a hint.

**v0.1/v0.2 CI scope (same as the IntelliJ-family original):** GitHub
Actions, GitLab CI, and CircleCI. Jenkinsfile/Azure Pipelines remain a
real, documented gap, not a hidden one.

## Privacy

See [PRIVACY.md](PRIVACY.md) — zero network calls, everything runs
against files already in your workspace.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test
```

To build an installable package without publishing:

```bash
npx @vscode/vsce package
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
