/**
 * @file server.js
 * @description Desktop server controls using the Tauri command and event APIs.
 * @version-history 2026-11-09: extracted from server.html; Desktop lifecycle and recovery controls.
 */
// Tauri v2 exposes the invoke API at window.__TAURI__.core.invoke. Opened in a plain browser
// there is no backend, and the page says so rather than failing silently.
const TAURI = window.__TAURI__ && window.__TAURI__.core;
const invoke = TAURI ? TAURI.invoke : null;

let lang = pickLang();
let port = 41050;
let running = false;
let pid = null;
let loadedConfig = null;
let jwt = null;
let owner = null;
let currentAi = null;
let services = [];
let logTimer = null;
let lastState = { state: 'stopped', running: false, ready: false, port: 41050, configured_port: 41050 };
let backupBusy = false;
let backupReport = null;
let restoreChoice = null;
let restorePassword = '';
let backupPasswordMode = null;
let backupPasswordErrorKey = null;
const busy = { signIn: false, settings: false, ai: false, scan: false };
let currentToast = null;
let resultMessage = null;

function pickLang() {
  try {
    const saved = localStorage.getItem('aimeat.lang');
    if (saved && STRINGS[saved]) return saved;
  } catch (e) { /* private mode: fall through to the browser's own language */ }
  const os = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return STRINGS[os] ? os : 'en';
}

function t(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

function $(id) { return document.getElementById(id); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(message, kind) {
  const box = $('toast');
  box.textContent = message;
  box.className = 'toast' + (kind === 'error' ? ' error' : '');
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6000 : 3000);
}

function toastKey(key, vars = {}, kind) {
  currentToast = { key, vars, kind };
  toast(t(key, vars), kind);
}

function localAddress() { return 'http://localhost:' + port; }

// Every element whose id is `t-<key>` takes the string `<key>`, so the markup and the words
// cannot drift apart silently: a missing key shows as its own name.
function applyLanguage() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[id^="t-"]')) {
    node.textContent = t(node.id.slice(2));
  }
  $('lang').value = lang;
  $('openBrowser').textContent = t('openBrowser');
  $('signIn').textContent = t('signIn');
  $('signOut').textContent = t('signOut');
  $('scan').textContent = t('scan');
  $('getOllama').textContent = t('getOllama');
  $('saveCustom').textContent = t('saveCustom');
  $('saveSettings').textContent = t('saveSettings');
  $('resetSettings').textContent = t('resetSettings');
  $('logReload').textContent = t('logReload');
  $('logClear').textContent = t('logClear');
  for (const id of ['connectLocal', 'createBackup', 'inspectBackup', 'confirmRestore', 'cancelRestore']) $(id).textContent = t(id);
  if (owner) $('signedInAs').textContent = t('signedInAs', { user: owner });
  showState(lastState);
  // Language updates labels only. Form values and selected models belong to the person.
  if (loadedConfig) $('setEnc').textContent = loadedConfig.encryption_configured ? t('encOn') : t('encOff');
  showCurrentAi();
  renderServices(true);
  showBackupStatus();
  showRestoreSummary();
  showPasswordLabels();
  if (currentToast && !$('toast').hidden) $('toast').textContent = t(currentToast.key, currentToast.vars);
  if (resultMessage) showResultMessage();
  document.dispatchEvent(new CustomEvent('desktop-language-change', { detail: { lang } }));
}

// ── Running it ────────────────────────────────────────────────────
function showState(s) {
  lastState = s;
  running = !!s.running;
  port = s.port || port;
  pid = s.pid;
  $('crumb').textContent = 'localhost:' + port;
  const stateKey = { starting: 'stStarting', ready: 'stReady', stopping: 'stStopping', failed: 'stFailed', stopped: 'stOff' }[s.state] || 'stOff';
  $('stateChip').textContent = t(stateKey);
  $('stateChip').className = 'poster-chip' + (s.ready ? ' poster-chip--on' : ' poster-chip--dim');
  if (s.ready) {
    $('stateText').textContent = t('runningOn', { address: localAddress() });
  } else {
    $('stateText').textContent = t(s.state === 'starting' ? 'starting' : s.state === 'stopping' ? 'stopping' : s.running ? 'unready' : 'stopped');
  }
  $('stateError').hidden = !s.last_error;
  $('stateError').textContent = s.last_error || '';
  $('restartNote').hidden = !s.restart_required;
  $('restartNote').textContent = s.restart_required ? t('restartNote', { address: localAddress(), port: s.configured_port }) : '';
  $('toggle').textContent = running ? t('stop') : t('start');
  $('toggle').disabled = s.state === 'stopping' || backupBusy;
  $('openBrowser').disabled = !s.ready;
  $('connectLocal').hidden = !s.ready;
  $('connectLocal').href = 'index.html?local=' + encodeURIComponent(localAddress());
  $('signIn').disabled = !s.ready;
  $('infoAddress').textContent = localAddress();
  backupButtons();
  if (!invoke) {
    $('stateError').hidden = false;
    $('stateError').textContent = t('noBackend');
  }
}

async function checkStatus() {
  if (!invoke) return;
  try {
    showState(await invoke('get_node_status'));
  } catch (e) {
    $('stateError').hidden = false;
    $('stateError').textContent = t('failed', { why: String(e) });
  }
}

async function toggle() {
  const button = $('toggle');
  button.disabled = true;
  try {
    const status = await invoke('get_node_status');
    if (status.running) {
      await invoke('stop_node', { pid: status.pid });
    } else {
      await invoke('start_node');
    }
  } catch (e) {
    toastKey('failed', { why: String(e) }, 'error');
  } finally {
    await checkStatus();
  }
}

async function openBrowser() {
  try { await invoke('open_portal'); } catch (e) { toastKey('failed', { why: String(e) }, 'error'); }
}

// ── Settings and the readout above ────────────────────────────────
function showConfig() {
  const c = loadedConfig;
  if (!c) return;
  $('infoId').textContent = c.node_id || '--';
  $('infoData').textContent = c.data_dir || '--';
  $('infoStorage').textContent = c.storage === 'sqlite' || !c.storage ? 'SQLite' : c.storage;
  $('setId').value = c.node_id || '';
  $('setPort').value = c.port || 41050;
  $('setRole').value = c.federation_role || 'standalone';
  $('setGenesis').value = c.genesis_url || '';
  // An install from before this choice has no listen address and answers on every network. It
  // keeps that until the person picks one: the third option, sent back empty, changes nothing.
  const bind = c.bind_host === '127.0.0.1' || c.bind_host === '0.0.0.0' ? c.bind_host : '';
  $('t-bindAsBefore').hidden = bind !== '';
  $('setBind').value = bind;
  $('setEnc').textContent = c.encryption_configured ? t('encOn') : t('encOff');
}

async function loadConfig() {
  if (!invoke) return;
  try {
    loadedConfig = await invoke('read_config');
    showConfig();
  } catch (e) {
    toastKey('failed', { why: String(e) }, 'error');
  }
}

async function saveSettings() {
  if (busy.settings || backupBusy) return;
  // The AI endpoint in the configuration file is not shown here, because the AI a person
  // chooses is saved to their account above; it is written back exactly as it was read, so
  // saving the settings can never wipe it.
  const newPort = Number($('setPort').value);
  if (!Number.isInteger(newPort) || newPort < 1024 || newPort > 65535) {
    toastKey('invalidPort', {}, 'error'); $('setPort').focus(); return;
  }
  const genesis = $('setGenesis').value.trim();
  if (genesis && !validAddress(genesis)) { toastKey('invalidAddress', {}, 'error'); $('setGenesis').focus(); return; }
  const config = {
    node_id: $('setId').value,
    port: newPort,
    federation_role: $('setRole').value,
    genesis_url: genesis || null,
    ai_endpoint: loadedConfig ? (loadedConfig.ai_endpoint || null) : null,
    bind_host: $('setBind').value || null,
  };
  busy.settings = true; syncControls();
  try {
    await invoke('write_config', { config });
    toastKey('saved');
    await loadConfig();
    await checkStatus();
  } catch (e) {
    toastKey('failed', { why: String(e) }, 'error');
  } finally { busy.settings = false; syncControls(); }
}

function validAddress(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}

// ── The AI on this computer ───────────────────────────────────────
async function signIn() {
  if (busy.signIn) return;
  const username = $('aiUser').value.trim();
  const password = $('aiPass').value;
  const code = $('aiCode').value.trim();
  if (!username || !password) { toastKey('needBoth', {}, 'error'); return; }
  busy.signIn = true; syncControls();
  try {
    jwt = await invoke('node_login_with_code', { port, username, password,
      totpCode: /^\d{6}$/.test(code) ? code : null, backupCode: code && !/^\d{6}$/.test(code) ? code : null });
    owner = username;
    $('aiPass').value = '';
    $('aiCode').value = '';
    $('signedOut').hidden = true;
    $('signedIn').hidden = false;
    $('signedInAs').textContent = t('signedInAs', { user: owner });
    await refreshCurrentAi();
    detectAI();
  } catch (e) {
    toastKey('failed', { why: String(e) }, 'error');
  } finally { busy.signIn = false; syncControls(); }
}

function signOut() {
  jwt = null;
  owner = null;
  currentAi = null;
  $('signedOut').hidden = false;
  $('signedIn').hidden = true;
  $('currentAi').hidden = true;
  renderServices();
}

async function refreshCurrentAi() {
  if (!jwt) { currentAi = null; $('currentAi').hidden = true; return; }
  try {
    currentAi = await invoke('get_ai_settings', { port, token: jwt });
    showCurrentAi();
  } catch (e) {
    currentAi = null;
    $('currentAi').hidden = true;
    toastKey('failed', { why: String(e) }, 'error');
  }
}

function showCurrentAi() {
  if (!currentAi) return;
  $('curService').textContent = providerName(currentAi.provider);
  $('curModel').textContent = currentAi.model || t('none');
  $('curAddress').textContent = currentAi.base_url || t('providerDefault');
  $('curHealth').textContent = t({ ok: 'healthOk', degraded: 'healthDegraded', failing: 'healthFailing' }[currentAi.health] || 'healthUntested');
  $('curRouting').textContent = t(currentAi.text_default ? 'defaultYes' : 'defaultNo');
  $('currentAi').hidden = false;
}

function serviceBase(s) { return s.url.replace(/\/+$/, '') + '/v1'; }

// The Rust side names a service by its id; a person reads the product's own name.
const SERVICE_NAMES = { 'lm-studio': 'LM Studio', ollama: 'Ollama', 'openai-compatible': 'OpenAI-compatible' };
function serviceName(id) { return SERVICE_NAMES[id] || id; }

// The provider stored on the account, in words. `custom` is an address the person gave.
function providerName(id) {
  if (!id) return t('providerDefault');
  if (id === 'custom') return t('providerCustom');
  if (id === 'openrouter') return 'OpenRouter';
  return id;
}

function renderServices(preserve = false) {
  const box = $('services');
  const selected = services.map((_, i) => $('model-' + i)?.value);
  box.innerHTML = '';
  if (!services.length) return;
  const available = services.filter((s) => s.status === 'available');
  if (!available.length) box.appendChild(el('p', 'dim', t('nothingFound')));

  services.forEach((s, i) => {
    const row = el('div', 'poster-row service');
    row.appendChild(el('span', 'name', serviceName(s.service_type)));
    const up = s.status === 'available';
    const models = s.models || [];
    row.appendChild(el('span', 'where', s.url + (up ? '  ·  ' + t('models', { n: models.length }) : '')));
    if (!up) {
      row.appendChild(el('span', 'poster-chip poster-chip--dim', t('notRunning')));
      box.appendChild(row);
      return;
    }
    const inUse = currentAi && currentAi.base_url === serviceBase(s);
    if (inUse) row.appendChild(el('span', 'poster-chip poster-chip--on', t('inUse')));
    const pick = document.createElement('select');
    pick.id = 'model-' + i;
    pick.setAttribute('aria-label', t('curModel') + ': ' + serviceName(s.service_type));
    if (models.length) {
      for (const m of models) {
        const option = el('option', '', m);
        option.value = m;
        if (inUse && currentAi.model === m) option.selected = true;
        pick.appendChild(option);
      }
    } else {
      const option = el('option', '', t('noModels'));
      option.value = '';
      pick.appendChild(option);
    }
    if (preserve && models.includes(selected[i])) pick.value = selected[i];
    pick.disabled = busy.ai;
    row.appendChild(pick);
    const use = el('button', 'poster-action', t('use'));
    use.disabled = busy.ai || !lastState.ready;
    use.addEventListener('click', () => saveAi(serviceBase(s), pick.value));
    row.appendChild(use);
    box.appendChild(row);
  });
}

async function detectAI() {
  if (!invoke || busy.scan) return;
  busy.scan = true; syncControls();
  $('services').textContent = t('scanning');
  try {
    services = await invoke('detect_ai_services');
  } catch (e) {
    services = [];
    toastKey('failed', { why: String(e) }, 'error');
  }
  busy.scan = false;
  renderServices(); syncControls();
}

async function saveAi(baseUrl, model) {
  if (busy.ai) return;
  if (!jwt) { toastKey('needSignIn', {}, 'error'); $('aiUser').focus(); return; }
  if (!model) { toastKey('needModel', {}, 'error'); return; }
  busy.ai = true; syncControls(); renderServices(true);
  try {
    await invoke('save_ai_endpoint', { port, token: jwt, baseUrl, model });
    await invoke('remember_local_ai', { baseUrl, model });
    toastKey('aiSaved', { model });
    await refreshCurrentAi();
    renderServices();
  } catch (e) {
    // Only this backend-validated policy refusal may save a pending local-node provider.
    if (String(e).includes('[LOCAL_AI_RESTART_REQUIRED]')) {
      try {
        const carried = await invoke('remember_local_ai', { baseUrl, model });
        if (carried) { toastKey('aiSavedForNode', { model }); await checkStatus(); return; }
      } catch (rememberError) { toastKey('failed', { why: String(rememberError) }, 'error'); return; }
    }
    toastKey('failed', { why: String(e) }, 'error');
    if (String(e).includes('[AI_TEST_FAILED]')) { await refreshCurrentAi(); renderServices(); }
  } finally { busy.ai = false; syncControls(); renderServices(true); }
}

function saveCustom() {
  const url = $('customUrl').value.trim();
  const model = $('customModel').value.trim();
  if (!url) { toastKey('needUrl', {}, 'error'); return; }
  if (!validAddress(url)) { toastKey('invalidAddress', {}, 'error'); return; }
  saveAi(url, model);
}

async function openExternal(url) {
  try { await invoke('open_external', { url }); } catch (e) { toastKey('failed', { why: String(e) }, 'error'); }
}

// ── Log ───────────────────────────────────────────────────────────
async function refreshLog() {
  if (!invoke || document.hidden) return;
  const box = $('log');
  try {
    const lines = await invoke('read_node_logs', { lines: 500 });
    box.textContent = lines.length ? lines.join('\n') : t('logEmpty');
  } catch (e) {
    box.textContent = t('failed', { why: String(e) });
  }
  if ($('logFollow').checked) box.scrollTop = box.scrollHeight;
}

async function clearLog() {
  try {
    await invoke('clear_node_logs');
    $('log').textContent = t('logCleared');
  } catch (e) {
    toastKey('failed', { why: String(e) }, 'error');
  }
}

function pollLog() {
  clearInterval(logTimer);
  logTimer = $('logRefresh').checked && !document.hidden ? setInterval(refreshLog, 2000) : null;
}

// The backend chooses file paths through native dialogs and verifies the archive before the
// page can ask for confirmation. A status event never repaints the open confirmation dialog.
function backupButtons() {
  for (const id of ['createBackup', 'inspectBackup']) $(id).disabled = running || backupBusy;
  $('backupStopHint').textContent = t(running ? 'backupStop' : 'backupReady');
  $('confirmRestore').disabled = running || backupBusy || !restoreChoice || !!restoreChoice.password_required;
  $('cancelRestore').disabled = backupBusy;
  for (const id of ['backupPassword', 'backupPasswordRepeat', 'submitBackupPassword', 'cancelBackupPassword']) $(id).disabled = backupBusy;
  $('toggle').disabled = lastState.state === 'stopping' || backupBusy;
  syncControls();
}

function syncControls() {
  $('signIn').disabled = !lastState.ready || busy.signIn;
  $('signOut').disabled = busy.ai || busy.signIn;
  $('saveSettings').disabled = backupBusy || busy.settings;
  $('scan').disabled = busy.scan || busy.ai;
  $('saveCustom').disabled = busy.ai || !lastState.ready;
  for (const id of ['setPort', 'setBind', 'setRole', 'setGenesis']) $(id).disabled = backupBusy || busy.settings;
  for (const id of ['aiUser', 'aiPass', 'aiCode']) $(id).disabled = busy.signIn;
  for (const id of ['customUrl', 'customModel']) $(id).disabled = busy.ai;
  for (const button of document.querySelectorAll('#services button')) button.disabled = busy.ai || !lastState.ready;
  for (const select of document.querySelectorAll('#services select')) select.disabled = busy.ai;
  if (!invoke) {
    for (const control of document.querySelectorAll('main button, main input, main select')) control.disabled = true;
  }
}

function reportDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString(lang === 'fi' ? 'fi-FI' : 'en-GB');
}

function showBackupStatus() {
  $('lastBackup').textContent = backupReport
    ? t('lastBackup', { date: reportDate(backupReport.created_at), path: backupReport.path })
    : t('noBackup');
  const days = window.DesktopTools?.preferences()?.backup_reminder_days ?? 7;
  const reminder = backupReminderKey(backupReport, days);
  $('backupReminder').hidden = !reminder;
  $('backupReminder').textContent = reminder ? t(reminder, { days }) : '';
  backupButtons();
}

function backupReminderKey(report, days, now = Date.now()) {
  if (!days) return null;
  if (!report) return 'backupReminderFirst';
  const age = now - Date.parse(report.created_at);
  return !Number.isFinite(age) || age >= days * 86400000 ? 'backupReminderDue' : null;
}

async function refreshBackupStatus() {
  if (!invoke) return;
  try { backupReport = (await invoke('backup_status')).last_backup; showBackupStatus(); }
  catch (e) { toastKey('failed', { why: String(e) }, 'error'); }
}

function backupResult(key, vars, warning = '') {
  resultMessage = { key, vars, warning };
  showResultMessage();
}

function showResultMessage() {
  $('backupResult').textContent = t(resultMessage.key, resultMessage.vars) + (resultMessage.warning ? '\n' + resultMessage.warning : '');
  $('backupResult').hidden = false;
}

async function createBackup() {
  if (running || backupBusy) return;
  openPasswordDialog('create');
}

function openPasswordDialog(mode) {
  backupPasswordMode = mode;
  backupPasswordErrorKey = null;
  $('backupPassword').value = '';
  $('backupPasswordRepeat').value = '';
  $('backupPassword').autocomplete = mode === 'create' ? 'new-password' : 'current-password';
  showPasswordLabels();
  $('backupPasswordDialog').showModal();
  $('backupPassword').focus();
}

function showPasswordLabels() {
  const create = backupPasswordMode === 'create';
  $('backupPasswordTitle').textContent = t(create ? 'backupPasswordTitle' : 'backupUnlockTitle');
  $('backupPasswordHint').textContent = t(create ? 'backupPasswordHint' : 'backupUnlockHint');
  $('backupPasswordFile').textContent = create ? '' : restoreChoice?.path || '';
  $('backupPasswordRepeatField').hidden = !create;
  $('submitBackupPassword').textContent = t(backupBusy ? 'backupWorking' : create ? 'backupPasswordSave' : 'backupUnlock');
  $('cancelBackupPassword').textContent = t('backupPasswordCancel');
  $('backupPasswordError').hidden = !backupPasswordErrorKey;
  $('backupPasswordError').textContent = backupPasswordErrorKey ? t(backupPasswordErrorKey) : '';
}

function cancelBackupPassword() {
  if (backupBusy) return;
  $('backupPassword').value = '';
  $('backupPasswordRepeat').value = '';
  backupPasswordMode = null;
  restorePassword = '';
  restoreChoice = null;
  $('backupPasswordDialog').close();
}

async function submitBackupPassword(event) {
  event?.preventDefault();
  if (running || backupBusy || !backupPasswordMode) return;
  let password = $('backupPassword').value;
  const create = backupPasswordMode === 'create';
  if (new TextEncoder().encode(password).length > 1024) {
    backupPasswordErrorKey = 'backupPasswordTooLong'; showPasswordLabels(); $('backupPassword').focus(); return;
  }
  if (!password.trim() || (create && [...password].length < 12)) {
    backupPasswordErrorKey = 'backupPasswordLength'; showPasswordLabels(); $('backupPassword').focus(); return;
  }
  if (create && password !== $('backupPasswordRepeat').value) {
    backupPasswordErrorKey = 'backupPasswordMismatch'; showPasswordLabels(); $('backupPasswordRepeat').focus(); return;
  }
  $('backupPassword').value = '';
  $('backupPasswordRepeat').value = '';
  backupPasswordErrorKey = null;
  backupBusy = true; backupButtons();
  showPasswordLabels();
  try {
    if (create) {
      $('backupPasswordDialog').close();
      const report = await invoke('create_backup', { lang, password });
      if (report) {
        backupReport = report;
        backupResult('backupSaved', { path: report.path, files: report.files, size: (report.total_bytes / 1048576).toFixed(1) }, report.warning);
        showBackupStatus();
      }
      backupPasswordMode = null;
    } else {
      const choice = await invoke('inspect_backup', { lang, ticket: restoreChoice.ticket, password });
      if (!choice || choice.password_required) throw new Error('Backup is still locked');
      restoreChoice = choice;
      restorePassword = password;
      backupPasswordMode = null;
      $('backupPasswordDialog').close();
      showRestoreSummary();
      $('restoreDialog').showModal();
      $('cancelRestore').focus();
    }
  } catch (e) {
    if (create) { backupPasswordMode = null; toastKey('failed', { why: String(e) }, 'error'); }
    else { restorePassword = ''; backupPasswordErrorKey = 'backupUnlockFailed'; }
  } finally {
    password = ''; backupBusy = false; showPasswordLabels(); showState(lastState);
    if (backupPasswordErrorKey) $('backupPassword').focus();
    else if (restoreChoice && !restoreChoice.password_required) $('cancelRestore').focus();
  }
}

function showRestoreSummary() {
  if (!restoreChoice) return;
  const r = restoreChoice;
  $('restoreSummary').textContent = t('restoreSummary', {
    path: r.path, date: reportDate(r.created_at), version: r.desktop_version,
    files: r.files, size: (r.total_bytes / 1048576).toFixed(1),
  });
  $('restoreEncryption').textContent = t(r.encrypted ? 'backupEncrypted' : 'backupUnencrypted');
}

async function inspectBackup() {
  if (running || backupBusy) return;
  restoreChoice = null; restorePassword = '';
  backupBusy = true; backupButtons();
  try {
    const choice = await invoke('inspect_backup', { lang });
    if (!choice) return;
    restoreChoice = choice;
    if (choice.password_required) { openPasswordDialog('unlock'); return; }
    showRestoreSummary();
    $('restoreDialog').showModal();
    $('cancelRestore').focus();
  } catch (e) { toastKey('failed', { why: String(e) }, 'error'); }
  finally {
    backupBusy = false; backupButtons();
    if (restoreChoice?.password_required) $('backupPassword').focus();
    else if (restoreChoice) $('cancelRestore').focus();
  }
}

function cancelRestore() {
  if (backupBusy) return;
  restoreChoice = null;
  restorePassword = '';
  $('restoreDialog').close();
}

async function confirmRestore() {
  if (!restoreChoice || restoreChoice.password_required || running || backupBusy) return;
  backupBusy = true; backupButtons();
  try {
    const report = await invoke('restore_backup', { ticket: restoreChoice.ticket, confirmed: true, password: restorePassword || null });
    $('restoreDialog').close(); restoreChoice = null; restorePassword = '';
    backupResult('restored', { path: report.recovery_path || '' }, report.warning);
    signOut();
    await loadConfig(); await checkStatus(); await refreshBackupStatus();
  } catch (e) { $('restoreDialog').close(); restoreChoice = null; toastKey('failed', { why: String(e) }, 'error'); }
  finally { restorePassword = ''; backupBusy = false; showState(lastState); }
}

// ── Version ───────────────────────────────────────────────────────
async function showVersion() {
  const app = window.__TAURI__ && window.__TAURI__.app;
  if (!app || !app.getVersion) return;
  try { $('version').textContent = 'v' + (await app.getVersion()); } catch (e) { /* a nicety */ }
}

// ── Wiring ────────────────────────────────────────────────────────
$('lang').addEventListener('change', (e) => {
  lang = e.target.value;
  try { localStorage.setItem('aimeat.lang', lang); } catch (err) { /* private mode */ }
  applyLanguage();
  if (!services.length) $('services').textContent = '';
  refreshLog();
});
$('toggle').addEventListener('click', toggle);
$('openBrowser').addEventListener('click', openBrowser);
$('signIn').addEventListener('click', signIn);
$('aiPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
$('aiCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
$('signOut').addEventListener('click', signOut);
$('scan').addEventListener('click', detectAI);
$('getOllama').addEventListener('click', () => openExternal('https://ollama.com/download'));
$('saveCustom').addEventListener('click', saveCustom);
$('saveSettings').addEventListener('click', saveSettings);
$('resetSettings').addEventListener('click', showConfig);
$('logReload').addEventListener('click', refreshLog);
$('logClear').addEventListener('click', clearLog);
$('logRefresh').addEventListener('change', pollLog);
$('createBackup').addEventListener('click', createBackup);
$('inspectBackup').addEventListener('click', inspectBackup);
$('confirmRestore').addEventListener('click', confirmRestore);
$('cancelRestore').addEventListener('click', cancelRestore);
$('backupPasswordForm').addEventListener('submit', submitBackupPassword);
$('cancelBackupPassword').addEventListener('click', cancelBackupPassword);
$('backupPasswordDialog').addEventListener('cancel', (event) => {
  event.preventDefault(); cancelBackupPassword();
});
$('restoreDialog').addEventListener('cancel', (event) => {
  if (backupBusy) { event.preventDefault(); return; }
  restoreChoice = null; restorePassword = '';
});
document.addEventListener('desktop-preferences-change', showBackupStatus);
document.addEventListener('visibilitychange', () => { pollLog(); if (!document.hidden) { refreshLog(); showBackupStatus(); } });
window.addEventListener('pagehide', () => {
  restorePassword = ''; restoreChoice = null;
  $('backupPassword').value = ''; $('backupPasswordRepeat').value = '';
});

applyLanguage();
if (!invoke) {
  toastKey('noBackend', {}, 'error');
} else {
  // Subscribe before the initial read, so a fast start or crash is never missed between them.
  const events = window.__TAURI__.event;
  const subscribed = events ? events.listen('node-status', event => showState(event.payload)) : Promise.resolve();
  subscribed.then(() => loadConfig()).then(checkStatus).catch(e => toastKey('failed', { why: String(e) }, 'error'));
  if (events) events.listen('node-error', event => toastKey('failed', { why: String(event.payload) }, 'error'));
  detectAI();
  refreshBackupStatus();
  refreshLog();
  pollLog();
  showVersion();
}
