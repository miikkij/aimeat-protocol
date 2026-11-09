/**
 * @file desktop-tools.test.mjs
 * @description Both languages cover every diagnostic code and preserve each message's substitutions.
 * @version-history 2026-11-09: the Rust diagnostic contract must be readable on both Desktop screens.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../src/desktop-tools-strings.js', import.meta.url), 'utf8'), context);
const words = JSON.parse(vm.runInContext('JSON.stringify(DESKTOP_TOOLS_STRINGS)', context));

test('Desktop settings and diagnostics have both languages with the same substitutions', () => {
  assert.deepEqual(Object.keys(words.en).sort(), Object.keys(words.fi).sort());
  for (const key of Object.keys(words.en)) {
    assert.deepEqual([...words.en[key].matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort(),
      [...words.fi[key].matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort(), key);
  }
});

test('each backend diagnostic result has a readable message and next action', () => {
  const source = readFileSync(new URL('../src-tauri/src/diagnostics.rs', import.meta.url), 'utf8');
  for (const name of ['Code', 'Subject', 'Action']) {
    const body = source.match(new RegExp('pub enum ' + name + ' \\{([^}]+)\\}'))?.[1];
    assert.ok(body, name);
    for (const entry of body.split(',').map(s => s.trim()).filter(Boolean)) {
      const key = entry.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      if (key === 'none') continue;
      const renderedKey = name === 'Action' && key === 'retry' ? 'retryAction' : key;
      assert.ok(words.en[renderedKey] && words.fi[renderedKey], name + ': ' + key);
    }
  }
});
