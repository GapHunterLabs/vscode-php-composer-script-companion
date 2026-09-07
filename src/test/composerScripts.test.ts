import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScripts, isAlwaysUsed, isReferenced, scanUsage } from '../composerScripts';

test('parseScripts reads string-valued scripts', () => {
  const scripts = parseScripts({ scripts: { test: 'phpunit' } });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].name, 'test');
  assert.equal(scripts[0].command, 'phpunit');
});

test('parseScripts joins array-valued scripts with a newline', () => {
  const scripts = parseScripts({ scripts: { build: ['step-one', 'step-two'] } });
  assert.equal(scripts[0].command, 'step-one\nstep-two');
});

test('parseScripts returns empty when there is no scripts section', () => {
  assert.deepEqual(parseScripts({ name: 'my/package' }), []);
});

test('isAlwaysUsed recognizes a fixed Composer lifecycle event', () => {
  assert.equal(isAlwaysUsed('post-install-cmd', new Set()), true);
});

test('isAlwaysUsed recognizes a pre-/post- pair around a custom script', () => {
  assert.equal(isAlwaysUsed('pre-build', new Set(['build'])), true);
  assert.equal(isAlwaysUsed('pre-build', new Set(['other'])), false);
});

test('isAlwaysUsed returns false for an unrelated custom script', () => {
  assert.equal(isAlwaysUsed('lint', new Set(['lint'])), false);
});

test('isReferenced matches "composer run-script <name>"', () => {
  assert.equal(isReferenced('run: composer run-script test', 'test'), true);
});

test('isReferenced matches the "composer <name>" shorthand', () => {
  assert.equal(isReferenced('composer test', 'test'), true);
});

test('isReferenced does not match a name as a substring of a longer token', () => {
  assert.equal(isReferenced('composer test-integration', 'test'), false);
});

test('isReferenced does not match an unrelated composer command', () => {
  assert.equal(isReferenced('composer install', 'test'), false);
});

test('scanUsage marks a lifecycle hook correctly', () => {
  const scripts = parseScripts({ scripts: { 'post-install-cmd': 'echo hi' } });
  const usages = scanUsage(scripts, new Map(), null);
  assert.equal(usages[0].verdict, 'LIFECYCLE_HOOK');
});

test('scanUsage marks a script called from another script in the same file', () => {
  const scripts = parseScripts({ scripts: { build: 'composer lint', lint: 'phpcs' } });
  const usages = scanUsage(scripts, new Map(), null);
  const lintUsage = usages.find((u) => u.script.name === 'lint')!;
  assert.equal(lintUsage.verdict, 'USED_IN_OWN_COMPOSER_JSON');
});

test('scanUsage marks a script called from CI', () => {
  const scripts = parseScripts({ scripts: { test: 'phpunit' } });
  const ciFiles = new Map([['.github/workflows/ci.yml', 'run: composer test']]);
  const usages = scanUsage(scripts, ciFiles, null);
  assert.equal(usages[0].verdict, 'USED_IN_CI');
  assert.match(usages[0].reason, /ci\.yml/);
});

test('scanUsage marks a script mentioned in README', () => {
  const scripts = parseScripts({ scripts: { test: 'phpunit' } });
  const usages = scanUsage(scripts, new Map(), 'Run `composer test` to run the suite.');
  assert.equal(usages[0].verdict, 'USED_IN_README');
});

test('scanUsage marks a truly unreferenced script as ORPHANED', () => {
  const scripts = parseScripts({ scripts: { 'old-task': 'echo legacy' } });
  const usages = scanUsage(scripts, new Map(), 'Nothing about old-task here.');
  assert.equal(usages[0].verdict, 'ORPHANED');
});
