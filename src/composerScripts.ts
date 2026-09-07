/**
 * Pure logic -- no `vscode` dependency. Ported from the IntelliJ-
 * family php-composer-script-companion (ComposerJsonParser +
 * LifecycleScripts + ScriptReferenceMatcher + UsageScanner). JSON
 * parsing uses `JSON.parse()` here instead of JSON PSI (simpler, no
 * PSI needed); the other 3 modules were already regex/set-based with
 * no PSI dependency, ported near-verbatim.
 */

export interface ComposerScript {
  name: string;
  command: string;
}

export type UsageVerdict = 'LIFECYCLE_HOOK' | 'USED_IN_OWN_COMPOSER_JSON' | 'USED_IN_CI' | 'USED_IN_README' | 'ORPHANED';

export interface ScriptUsage {
  script: ComposerScript;
  verdict: UsageVerdict;
  reason: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the "scripts" object of a parsed composer.json. A script's
 * value can be a single string OR an array of strings (multiple
 * commands run in sequence) -- both are handled, joined with a
 * newline for the array case so downstream text-matching sees every
 * command. */
export function parseScripts(composerJson: JsonValue): ComposerScript[] {
  if (!isRecord(composerJson)) return [];
  const scripts = composerJson.scripts;
  if (!isRecord(scripts)) return [];

  const result: ComposerScript[] = [];
  for (const [name, value] of Object.entries(scripts)) {
    let command: string | undefined;
    if (typeof value === 'string') {
      command = value;
    } else if (Array.isArray(value)) {
      command = value.filter((entry): entry is string => typeof entry === 'string').join('\n');
    }
    if (command !== undefined) result.push({ name, command });
  }
  return result;
}

// Composer script event names Composer itself invokes automatically
// at specific points in its own command lifecycle -- never real
// orphans even with no text reference anywhere, because their
// "caller" is the Composer CLI itself. Curated from Composer's own
// documented event list (getcomposer.org/doc/articles/scripts.md).
const ALWAYS_USED = new Set([
  'pre-install-cmd', 'post-install-cmd',
  'pre-update-cmd', 'post-update-cmd',
  'pre-status-cmd', 'post-status-cmd',
  'pre-archive-cmd', 'post-archive-cmd',
  'pre-autoload-dump', 'post-autoload-dump',
  'post-root-package-install', 'post-create-project-cmd',
  'pre-operations-exec',
  'pre-package-install', 'post-package-install',
  'pre-package-update', 'post-package-update',
  'pre-package-uninstall', 'post-package-uninstall',
  'init', 'command', 'pre-file-download', 'post-file-download',
  'pre-command-run', 'pre-pool-create',
]);

/** True when `name` is unconditionally treated as used: either a
 * fixed Composer event name, or a pre-/post- prefix of a real
 * sibling script name -- teams commonly define their own
 * pre-foo/post-foo pair around a custom foo script. */
export function isAlwaysUsed(name: string, allScriptNames: Set<string>): boolean {
  if (ALWAYS_USED.has(name)) return true;
  let base: string | null = null;
  if (name.startsWith('pre-')) base = name.slice('pre-'.length);
  else if (name.startsWith('post-')) base = name.slice('post-'.length);
  if (base === null) return false;
  return base !== '' && allScriptNames.has(base);
}

const NAME_CONTINUATION = '[A-Za-z0-9_:.@/-]';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds a real invocation of a Composer script by name inside
 * arbitrary text. Only the real runner invocation shapes count:
 * `composer run-script <name>` (explicit) or `composer <name>`
 * (Composer's own documented shorthand). */
export function isReferenced(text: string, scriptName: string): boolean {
  const escaped = escapeRegExp(scriptName);
  const pattern = new RegExp(`\\bcomposer\\s+(?:run-script\\s+)?${escaped}(?!${NAME_CONTINUATION})`);
  return pattern.test(text);
}

/** Same verdict-priority design as the IntelliJ-family original. */
export function scanUsage(scripts: ComposerScript[], ciFiles: Map<string, string>, readmeText: string | null): ScriptUsage[] {
  const allNames = new Set(scripts.map((s) => s.name));
  return scripts.map((script) => evaluate(script, scripts, allNames, ciFiles, readmeText));
}

function evaluate(
  script: ComposerScript,
  allScripts: ComposerScript[],
  allNames: Set<string>,
  ciFiles: Map<string, string>,
  readmeText: string | null,
): ScriptUsage {
  if (isAlwaysUsed(script.name, allNames)) {
    return { script, verdict: 'LIFECYCLE_HOOK', reason: 'Composer script event convention -- always runs automatically' };
  }

  const caller = allScripts.find((other) => other.name !== script.name && isReferenced(other.command, script.name));
  if (caller) {
    return {
      script,
      verdict: 'USED_IN_OWN_COMPOSER_JSON',
      reason: `called from this composer.json's own "${caller.name}" script`,
    };
  }

  for (const [path, text] of ciFiles) {
    if (isReferenced(text, script.name)) {
      return { script, verdict: 'USED_IN_CI', reason: `called from ${path}` };
    }
  }

  if (readmeText !== null && isReferenced(readmeText, script.name)) {
    return { script, verdict: 'USED_IN_README', reason: 'mentioned in README.md' };
  }

  return {
    script,
    verdict: 'ORPHANED',
    reason: 'no reference found in this composer.json, GitHub Actions/GitLab CI/CircleCI configs, or README.md',
  };
}
