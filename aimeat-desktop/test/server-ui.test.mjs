/**
 * @file server-ui.test.mjs
 * @description UI behavior regressions with Tauri command/event boundaries replaced by a stub.
 * @version-history 2026-11-09: pending settings, readiness, failed AI saves and hidden logs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
function screen(overrides = {}, options = {}) {
  const elements = new Map();
  function element(id = '') {
    const node = { value: '', textContent: '', className: '', hidden: false, disabled: false, checked: false,
      children: [], handlers: {}, appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.handlers[name] = fn; }, focus() {},
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      showModal() { this.open = true; }, close() { this.open = false; }, reportValidity() { return true; },
    };
    Object.defineProperty(node, 'id', { get: () => id, set: value => { id = value; elements.set(value, node); } });
    return node;
  }
  for (const match of source('server.html').matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], element(match[1]));
  const calls = []; const intervals = new Set(); const listeners = {};
  const config = { node_id: 'aimeat-test', port: 41050, federation_role: 'standalone', bind_host: '127.0.0.1', data_dir: 'test-data', storage: 'sqlite' };
  const status = { state: 'stopped', running: false, ready: false, port: 41050, configured_port: 41050 };
  let rejectSave = false;
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (overrides[name]) return overrides[name](args);
    if (name === 'read_config') return config;
    if (name === 'get_node_status') return status;
    if (name === 'get_ai_settings') return { provider: 'custom', base_url: 'http://localhost:1234/v1', model: 'm', health: 'ok', text_default: false };
    if (name === 'save_ai_endpoint' && rejectSave) throw new Error('AI_TEST_FAILED: model did not answer');
    if (name === 'detect_ai_services' || name === 'read_node_logs') return [];
    if (name === 'backup_status') return { last_backup: null };
    return null;
  };
  const document = { hidden: false, documentElement: { lang: 'en' },
    getElementById: id => elements.get(id), createElement: () => element(),
    querySelectorAll: selector => selector === '[id^="t-"]' ? [...elements.values()].filter(e => e.id.startsWith('t-')) : selector === 'main button, main input, main select' ? ['toggle', 'saveSettings', 'signIn', 'createBackup', 'inspectBackup'].map(id => elements.get(id)) : [],
    addEventListener(name, fn) { listeners[name] = fn; }, dispatchEvent() {},
  };
  const context = vm.createContext({ document, navigator: { language: 'en' }, console, URL,
    localStorage: { getItem: () => null, setItem() {} },
    window: { __TAURI__: options.noBackend ? null : { core: { invoke }, event: { listen: async (name, fn) => { listeners[name] = fn; return () => {}; } } }, addEventListener() {} },
    CustomEvent: class { constructor(name, props) { this.type = name; this.detail = props?.detail; } },
    setTimeout: () => 1, clearTimeout() {},
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
  });
  vm.runInContext(source('server-strings.js'), context);
  vm.runInContext(source('server.js'), context);
  return { elements, calls, intervals, listeners, document, context, config,
    run: code => vm.runInContext(code, context), rejectSave() { rejectSave = true; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('language changes preserve edited settings and model text', async () => {
  const s = screen(); await settle();
  s.elements.get('setPort').value = '42000';
  s.elements.get('setGenesis').value = 'https://my.example.org';
  s.elements.get('customModel').value = 'my-model';
  s.run("lang = 'fi'; applyLanguage();");
  assert.equal(s.elements.get('setPort').value, '42000');
  assert.equal(s.elements.get('setGenesis').value, 'https://my.example.org');
  assert.equal(s.elements.get('customModel').value, 'my-model');
});

test('a starting process never enables the browser and a saved port does not change the live address', async () => {
  const s = screen(); await settle();
  s.run("showState({state:'starting', running:true, ready:false, port:41050, configured_port:42000, restart_required:true});");
  assert.equal(s.elements.get('openBrowser').disabled, true);
  assert.equal(s.elements.get('infoAddress').textContent, 'http://localhost:41050');
});

test('a live process that fails readiness is not described as stopped', async () => {
  const s = screen(); await settle();
  s.run("showState({state:'failed', running:true, ready:false, port:41050, configured_port:41050, last_error:'Readiness failed'});");
  assert.match(s.elements.get('stateText').textContent, /running but is not ready/);
  assert.equal(s.elements.get('toggle').textContent, 'Stop');
  assert.equal(s.elements.get('openBrowser').disabled, true);
});

test('a plain-browser preview keeps unavailable machine controls disabled and explains why', async () => {
  const s = screen({}, { noBackend: true }); await settle();
  assert.equal(s.elements.get('saveSettings').disabled, true);
  assert.equal(s.elements.get('createBackup').disabled, true);
  assert.equal(s.elements.get('stateError').hidden, false);
  assert.match(s.elements.get('stateError').textContent, /plain browser/);
  s.run("lang='fi'; applyLanguage();");
  assert.equal(s.elements.get('saveSettings').disabled, true);
  assert.match(s.elements.get('stateError').textContent, /tavallisessa selaimessa/);
});

test('a failed AI test cannot write a remembered choice or display success', async () => {
  const s = screen(); await settle(); s.calls.length = 0; s.rejectSave();
  s.run("jwt = 'stub'; owner = 'alice';");
  await s.run("saveAi('http://localhost:1234/v1', 'm')");
  assert.equal(s.calls.some(c => c.name === 'remember_local_ai'), false);
  assert.match(s.elements.get('toast').textContent, /AI_TEST_FAILED/);
});

test('hiding the window suspends log refresh', async () => {
  const s = screen(); await settle();
  s.elements.get('logRefresh').checked = true;
  s.document.hidden = true;
  s.run('pollLog()');
  assert.equal(s.intervals.size, 0);
});

test('a chosen model survives language change even when another model was saved earlier', async () => {
  const s = screen(); await settle();
  s.run("services = [{service_type:'ollama',url:'http://localhost:11434',status:'available',models:['first','second']}]; currentAi = {base_url:'http://localhost:11434/v1',model:'second'}; renderServices();");
  s.elements.get('model-0').value = 'first';
  s.run("lang='fi'; applyLanguage();");
  assert.equal(s.elements.get('model-0').value, 'first');
});

test('repeated AI clicks start one test, and only a validated restart refusal remembers a pending choice', async () => {
  let release;
  const s = screen({ save_ai_endpoint: () => new Promise(resolve => { release = resolve; }) });
  await settle(); s.calls.length = 0; s.run("jwt='stub';");
  const first = s.run("saveAi('http://localhost:1234/v1','m')");
  await s.run("saveAi('http://localhost:1234/v1','other')");
  assert.equal(s.calls.filter(c => c.name === 'save_ai_endpoint').length, 1);
  release(); await first;

  const pending = screen({ save_ai_endpoint: () => { throw new Error('[LOCAL_AI_RESTART_REQUIRED]'); }, remember_local_ai: () => true });
  await settle(); pending.calls.length = 0; pending.run("jwt='stub';");
  await pending.run("saveAi('http://localhost:1234/v1','m')");
  assert.deepEqual(pending.calls.slice(0, 2).map(c => c.name), ['save_ai_endpoint', 'remember_local_ai']);
  assert.match(pending.elements.get('toast').textContent, /has not passed a test/);
});

test('inspecting a backup never restores it until the separate confirmation', async () => {
  const s = screen({
    inspect_backup: () => ({ ticket: 'opaque-ticket', path: 'backup.zip', created_at: '2026-11-09T12:00:00Z', desktop_version: '0.8.0', files: 8, total_bytes: 1024 }),
    restore_backup: args => { assert.equal(args.ticket, 'opaque-ticket'); assert.equal(args.confirmed, true); return { recovery_path: 'recovery' }; },
  });
  await settle(); s.calls.length = 0;
  await s.run('inspectBackup()');
  assert.equal(s.elements.get('restoreDialog').open, true);
  assert.equal(s.calls.some(c => c.name === 'restore_backup'), false);
  assert.match(s.elements.get('t-restoreReplaces').textContent, /encryption keys/);
  await s.run('confirmRestore()');
  assert.equal(s.calls.filter(c => c.name === 'restore_backup').length, 1);
  assert.equal(s.elements.get('restoreDialog').open, false);
});

test('visible results and all labels have both language versions', async () => {
  const s = screen(); await settle();
  s.run("backupResult('backupSaved', {path:'copy.zip',files:2,size:'1.0'}); toastKey('saved'); lang='fi'; applyLanguage();");
  assert.match(s.elements.get('backupResult').textContent, /Varmuuskopio luotu/);
  assert.equal(s.elements.get('toast').textContent, 'Tallennettu.');
  assert.equal(s.run('JSON.stringify(Object.keys(STRINGS.en).sort())'), s.run('JSON.stringify(Object.keys(STRINGS.fi).sort())'));
});
