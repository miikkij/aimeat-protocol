/**
 * @file desktop-tools.js
 * @description Shared Desktop preferences and explicit, local diagnostics on both screens.
 * @version-history 2026-11-09: background use, startup choices and preview-before-copy support reports.
 */
(() => {
  'use strict';
  const host = document.getElementById('desktopTools');
  if (!host) return;
  const invoke = window.__TAURI__?.core?.invoke;
  const $ = id => document.getElementById(id);
  let settings = null;
  let report = null;
  let saving = false;
  let checking = false;
  let settingsMessage = null;
  let checkMessage = null;
  let reportMessage = null;
  function t(key, vars = {}) {
    const words = DESKTOP_TOOLS_STRINGS[document.documentElement.lang] || DESKTOP_TOOLS_STRINGS.en;
    return Object.entries(vars).reduce((value, [name, replacement]) => value.split('{' + name + '}').join(String(replacement)), words[key] || DESKTOP_TOOLS_STRINGS.en[key] || key);
  }
  // This template is constant. Results and translations enter only through textContent/value.
  host.innerHTML = `
    <section class="poster-section desktop-tools" aria-labelledby="dtTitle">
      <h2 class="poster-section-title" id="dtTitle" data-tools-text="title"></h2>
      <p class="lead" data-tools-text="lead"></p>
      <div class="acts below">
        <button class="poster-action" id="dtCheck" type="button"></button>
        <button class="poster-action" id="dtPreview" type="button" data-tools-text="preview" hidden></button>
      </div>
      <p id="dtCheckStatus" role="status" aria-live="polite" hidden></p>
      <div id="dtChecks"></div>
      <details class="desktop-preferences below" id="dtPreferences">
        <summary data-tools-text="preferencesTitle"></summary>
        <form id="dtPreferenceForm">
          <div class="desktop-choice">
            <label><input type="checkbox" id="dtKeep" aria-describedby="dtKeepHint" /><span data-tools-text="keep"></span></label>
            <p class="hint" id="dtKeepHint" data-tools-text="keepHint"></p>
          </div>
          <div class="desktop-choice">
            <label><input type="checkbox" id="dtLogin" aria-describedby="dtLoginHint dtStartupNotice" /><span data-tools-text="login"></span></label>
            <p class="hint" id="dtLoginHint" data-tools-text="loginHint"></p>
            <p class="poster-aside" id="dtStartupNotice" hidden></p>
          </div>
          <div class="desktop-choice">
            <label><input type="checkbox" id="dtLocal" aria-describedby="dtLocalHint" /><span data-tools-text="local"></span></label>
            <p class="hint" id="dtLocalHint" data-tools-text="localHint"></p>
          </div>
          <div class="field">
            <label class="poster-label" for="dtReminder" data-tools-text="reminders"></label>
            <select id="dtReminder" aria-describedby="dtReminderHint">
              <option value="7" data-tools-text="week"></option>
              <option value="30" data-tools-text="month"></option>
              <option value="0" data-tools-text="off"></option>
            </select>
            <p class="hint" id="dtReminderHint" data-tools-text="reminderHint"></p>
          </div>
          <div class="acts below">
            <button class="poster-action" id="dtSave" type="submit"></button>
            <button class="poster-action" id="dtReload" type="button" data-tools-text="retry" hidden></button>
          </div>
          <p id="dtSettingsStatus" role="status" aria-live="polite" hidden></p>
        </form>
      </details>
      <p class="below"><button class="poster-action" id="dtQuit" type="button" data-tools-text="quit"></button></p>
      <p class="hint" data-tools-text="quitHint"></p>
      <p class="poster-aside" id="dtUnavailable" data-tools-text="noBackend" hidden></p>
    </section>`;
  const dialog = document.createElement('dialog');
  dialog.id = 'dtReportDialog'; dialog.className = 'desktop-tools-dialog';
  dialog.setAttribute('aria-labelledby', 'dtReportTitle');
  dialog.innerHTML = `
    <h2 class="poster-section-title" id="dtReportTitle" data-tools-text="reportTitle"></h2>
    <p data-tools-text="reportPrivacy"></p>
    <textarea id="dtReportText" rows="14" readonly aria-labelledby="dtReportTitle"></textarea>
    <p id="dtReportStatus" role="status" aria-live="polite" hidden></p>
    <div class="acts below">
      <button class="poster-action" id="dtCopy" type="button" data-tools-text="copy"></button>
      <button class="poster-action" id="dtClose" type="button" data-tools-text="close"></button>
    </div>`;
  document.body.appendChild(dialog);

  function message(id, key, vars) {
    $(id).hidden = !key;
    $(id).textContent = key ? t(key, vars) : '';
  }
  function paint() {
    for (const item of document.querySelectorAll('[data-tools-text]')) item.textContent = t(item.dataset.toolsText);
    $('dtCheck').textContent = t(checking ? 'checking' : 'check');
    $('dtSave').textContent = t(saving ? 'saving' : 'save');
    $('dtCheck').disabled = !invoke || checking;
    for (const id of ['dtKeep', 'dtLocal', 'dtReminder', 'dtSave']) $(id).disabled = !invoke || !settings || saving;
    $('dtLogin').disabled = !invoke || !settings?.autostart_available || saving;
    $('dtQuit').disabled = !invoke;
    $('dtReload').hidden = !invoke || !!settings;
    $('dtPreview').hidden = !report;
    $('dtPreview').disabled = checking;
    $('dtUnavailable').hidden = !!invoke;
    const startupKey = settings?.isolated ? 'isolated' : settings && !settings.autostart_available ? 'unavailable' : settings?.warning ? 'warning' : null;
    message('dtStartupNotice', startupKey);
    message('dtSettingsStatus', settingsMessage);
    message('dtCheckStatus', checkMessage, report?.summary);
    message('dtReportStatus', reportMessage);
    renderChecks();
  }
  function fillPreferences() {
    const p = settings.preferences;
    $('dtKeep').checked = p.keep_running_on_close;
    $('dtLogin').checked = p.start_at_login;
    $('dtLocal').checked = p.start_local_node;
    $('dtReminder').value = String(p.backup_reminder_days);
    document.dispatchEvent(new CustomEvent('desktop-preferences-change'));
  }
  async function loadPreferences() {
    if (!invoke) return;
    try { settings = await invoke('get_desktop_preferences'); settingsMessage = null; fillPreferences(); }
    catch { settings = null; settingsMessage = 'loadFailed'; }
    paint();
  }
  async function savePreferences(event) {
    event.preventDefault();
    if (!invoke || !settings || saving) return;
    const preferences = {
      keep_running_on_close: $('dtKeep').checked,
      start_at_login: $('dtLogin').checked,
      start_local_node: $('dtLocal').checked,
      backup_reminder_days: Number($('dtReminder').value),
      language: document.documentElement.lang === 'fi' ? 'fi' : 'en',
    };
    saving = true; settingsMessage = null; paint();
    try {
      settings = await invoke('save_desktop_preferences', { preferences });
      fillPreferences(); settingsMessage = 'saved';
    } catch { settingsMessage = 'failed'; }
    finally { saving = false; paint(); }
  }
  const actions = {
    open_server: 'server.html', open_connections: 'index.html#listTitle', open_settings: 'server.html#settingsSection',
    open_log: 'server.html#logSection', start_node: 'server.html', restart_node: 'server.html', open_ai: 'server.html#aiSection',
  };
  function element(tag, cls, text) {
    const item = document.createElement(tag); item.className = cls; item.textContent = text; return item;
  }
  function renderChecks() {
    const target = $('dtChecks'); target.replaceChildren();
    if (!report) return;
    const priority = { error: 0, warning: 1, info: 2, ok: 3 };
    for (const check of [...report.checks].sort((a, b) => priority[a.status] - priority[b.status])) {
      const row = element('div', 'poster-row desktop-check', '');
      const heading = element('div', 'desktop-check-heading', '');
      heading.append(element('strong', '', t(check.subject)), element('span', 'poster-chip', t(check.status === 'warning' ? 'warningStatus' : check.status)));
      row.append(heading, element('p', '', t(check.code, { count: check.count ?? 0 })));
      if (check.action !== 'none') {
        const key = check.action === 'retry' ? 'retryAction' : check.action;
        if (actions[check.action]) {
          const link = element('a', 'poster-action', t(key)); link.href = actions[check.action]; row.append(link);
        } else row.append(element('p', 'hint', t(key)));
      }
      target.append(row);
    }
  }
  async function checkComputer() {
    if (!invoke || checking) return;
    checking = true; checkMessage = null; paint();
    try { report = await invoke('run_diagnostics'); checkMessage = 'checked'; }
    catch { report = null; checkMessage = 'checkFailed'; }
    finally { checking = false; paint(); }
  }
  $('dtPreferenceForm').addEventListener('submit', savePreferences);
  $('dtReload').addEventListener('click', loadPreferences);
  $('dtCheck').addEventListener('click', checkComputer);
  $('dtPreview').addEventListener('click', () => {
    if (!report || checking) return;
    $('dtReportText').value = report.report_text;
    reportMessage = null; paint(); dialog.showModal(); $('dtClose').focus();
    $('dtReportText').setSelectionRange(0, 0); $('dtReportText').scrollTop = 0;
  });
  $('dtClose').addEventListener('click', () => dialog.close());
  $('dtCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('dtReportText').value); reportMessage = 'copied'; }
    catch { reportMessage = 'copyFailed'; $('dtReportText').focus(); $('dtReportText').select(); }
    message('dtReportStatus', reportMessage);
  });
  $('dtQuit').addEventListener('click', async () => {
    if (!invoke) return;
    $('dtQuit').disabled = true;
    try { await invoke('quit_desktop'); }
    catch { settingsMessage = 'quitFailed'; $('dtPreferences').open = true; }
    finally { paint(); }
  });
  async function saveLanguage() {
    paint();
    if (!invoke) return;
    try { await invoke('set_desktop_language', { language: document.documentElement.lang === 'fi' ? 'fi' : 'en' }); }
    catch { /* Screen language remains usable when Desktop preferences cannot be saved. */ }
  }
  window.DesktopTools = { preferences: () => settings?.preferences || null };
  document.addEventListener('desktop-language-change', saveLanguage);
  paint();
  loadPreferences().then(saveLanguage);
})();
