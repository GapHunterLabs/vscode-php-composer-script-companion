import * as vscode from 'vscode';
import { parseScripts, scanUsage } from './composerScripts';

let diagnostics: vscode.DiagnosticCollection;

function basename(uri: vscode.Uri): string {
  const path = uri.path;
  return path.slice(path.lastIndexOf('/') + 1);
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  }
}

/** v0.1/v0.2 CI scope (same as the IntelliJ-family original): GitHub
 * Actions, GitLab CI, and CircleCI -- Jenkinsfile/Azure Pipelines
 * remain a real, documented gap, not a hidden one. */
async function findCiFiles(dir: vscode.Uri): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const workflowsDir = vscode.Uri.joinPath(dir, '.github', 'workflows');
  try {
    const entries = await vscode.workspace.fs.readDirectory(workflowsDir);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && (name.endsWith('.yml') || name.endsWith('.yaml'))) {
        const text = await readTextIfExists(vscode.Uri.joinPath(workflowsDir, name));
        if (text !== null) result.set(`.github/workflows/${name}`, text);
      }
    }
  } catch {
    // no .github/workflows directory -- fine
  }

  const gitlabCi = await readTextIfExists(vscode.Uri.joinPath(dir, '.gitlab-ci.yml'));
  if (gitlabCi !== null) result.set('.gitlab-ci.yml', gitlabCi);

  const circleCi = await readTextIfExists(vscode.Uri.joinPath(dir, '.circleci', 'config.yml'));
  if (circleCi !== null) result.set('.circleci/config.yml', circleCi);

  return result;
}

/** Finds this script's own `"name":` key line in the raw text, for a
 * precise diagnostic anchor -- a reasonable heuristic (JSON.parse
 * discards positions), falls back to line 0 if not found. */
function lineOfScriptKey(text: string, scriptName: string): number {
  const lines = text.split('\n');
  const needle = `"${scriptName}"`;
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 0 : index;
}

async function refresh(document: vscode.TextDocument): Promise<void> {
  if (basename(document.uri) !== 'composer.json') {
    diagnostics.delete(document.uri);
    return;
  }

  let composerJson: unknown;
  try {
    composerJson = JSON.parse(document.getText());
  } catch {
    diagnostics.delete(document.uri);
    return;
  }

  const scripts = parseScripts(composerJson as never);
  if (scripts.length === 0) {
    diagnostics.delete(document.uri);
    return;
  }

  const dir = vscode.Uri.joinPath(document.uri, '..');
  const ciFiles = await findCiFiles(dir);
  const readmeText = await readTextIfExists(vscode.Uri.joinPath(dir, 'README.md'));

  const usages = scanUsage(scripts, ciFiles, readmeText);
  const text = document.getText();
  const result = usages
    .filter((usage) => usage.verdict === 'ORPHANED')
    .map((usage) => {
      const line = lineOfScriptKey(text, usage.script.name);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
      const diagnostic = new vscode.Diagnostic(
        range,
        `"${usage.script.name}" looks unused -- ${usage.reason}.`,
        vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = 'PHP Composer Script Companion';
      return diagnostic;
    });
  diagnostics.set(document.uri, result);
}

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('phpComposerScriptCompanion');
  context.subscriptions.push(diagnostics);

  vscode.workspace.textDocuments.forEach((doc) => void refresh(doc));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => void refresh(doc)),
    vscode.workspace.onDidChangeTextDocument((event) => void refresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  );
}

export function deactivate(): void {
  diagnostics?.dispose();
}
