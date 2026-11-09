import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function updater(answer, snapshot = {phase:'idle'}) {
  function element(tag) {
    return { tag, children: [], textContent: '', handlers: {}, disabled: false,
      classList: { add() {} }, append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; }, setAttribute(key, val) { this[key] = val; },
      addEventListener(name, fn) { this.handlers[name] = fn; },
    };
  }
  const area = element('section'), calls = [], listeners = {};
  const document = { documentElement: { lang: 'en' }, getElementById: () => area,
    createElement: element, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = vm.createContext({ document,
    window: { __TAURI__: {
      core: { invoke: async (name) => { calls.push(name); return name === 'get_update_status' ? snapshot : answer(name); } },
      event: { listen: async (name, fn) => { listeners[name] = fn; } },
    } },
  });
  vm.runInContext(readFileSync(new URL('../src/updates.js', import.meta.url), 'utf8'), context);
  return { area, calls, document, listeners, button: () => area.children.at(-1), text: () => area.children.map(x => x.textContent).join(' ') };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a failed update check stays visible and can be retried', async () => {
  let failed = true;
  const s = updater(() => { if (failed) throw new Error('offline'); return null; });
  await settle();
  assert.match(s.text(), /could not be checked/);
  assert.equal(s.button().disabled, false);
  failed = false;
  await s.button().handlers.click();
  assert.match(s.text(), /up to date/);
  assert.deepEqual(s.calls, ['get_update_status', 'check_update', 'check_update']);
});

test('download progress and language changes preserve a running installation, then offer restart', async () => {
  let finish;
  const s = updater(name => name === 'check_update' ? '0.8.0' : name === 'install_update' ? new Promise(resolve => { finish = resolve; }) : null);
  await settle();
  const pending = s.button().handlers.click();
  await settle();
  s.listeners['update-progress']({ payload: { phase: 'downloading', downloaded: 40, total: 100 } });
  assert.equal(s.area.children.find(x => x.tag === 'progress').value, 40);
  s.document.documentElement.lang = 'fi'; s.listeners['desktop-language-change']();
  assert.match(s.text(), /Ladataan/);
  assert.equal(s.button().disabled, true);
  finish(true); await pending;
  assert.match(s.text(), /Käynnistä Desktop uudelleen/);
  await s.button().handlers.click();
  assert.equal(s.calls.at(-1), 'restart_desktop');
});

test('a failed installation releases the action and keeps the version for retry', async () => {
  const s = updater(name => { if (name === 'check_update') return '0.8.0'; throw new Error('signature mismatch'); });
  await settle();
  await s.button().handlers.click();
  assert.match(s.text(), /did not finish/);
  assert.match(s.text(), /signature mismatch/);
  assert.equal(s.button().disabled, false);
  assert.equal(s.button().textContent, 'Install update');
});

test('opening another screen restores active progress and the later restart action', async () => {
  const s = updater(() => { throw new Error('No new check or install is needed'); },
    {phase:'downloading',version:'0.8.0',downloaded:25,total:100});
  await settle();
  assert.equal(s.button().disabled, true);
  assert.equal(s.area.children.find(x => x.tag === 'progress').value, 25);
  s.listeners['update-progress']({payload:{phase:'installed',version:'0.8.0'}});
  assert.equal(s.button().textContent, 'Restart Desktop');
  assert.equal(s.button().disabled, false);
  assert.deepEqual(s.calls, ['get_update_status']);
});
