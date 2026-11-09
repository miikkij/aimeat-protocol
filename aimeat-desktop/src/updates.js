/* Desktop updates share the same states on both screens. No credentials enter this view. */
(() => {
  const area = document.getElementById('update');
  const invoke = window.__TAURI__?.core?.invoke;
  if (!area || !invoke) return;
  const words = {
    en: {
      check: 'Check for updates', checking: 'Checking for updates…', current: 'Desktop is up to date.',
      available: 'Desktop {version} is available.', install: 'Install update',
      explain: 'Your local AIMEAT will stop before installation. Your data stays on this computer.',
      downloading: 'Downloading update…', verifying: 'Verifying the download…',
      stopping: 'Saving your AIMEAT data and stopping the server…', installing: 'Installing update…',
      installed: 'Update installed. Restart Desktop to use it.', restart: 'Restart Desktop',
      failed: 'The update did not finish.', checkFailed: 'Updates could not be checked.', retry: 'Try again',
    },
    fi: {
      check: 'Tarkista päivitykset', checking: 'Tarkistetaan päivityksiä…', current: 'Desktop on ajan tasalla.',
      available: 'Desktopin versio {version} on saatavilla.', install: 'Asenna päivitys',
      explain: 'Oma AIMEAT pysäytetään ennen asennusta. Tietosi säilyvät tällä tietokoneella.',
      downloading: 'Ladataan päivitystä…', verifying: 'Tarkistetaan latausta…',
      stopping: 'Tallennetaan AIMEATin tiedot ja pysäytetään palvelinta…', installing: 'Asennetaan päivitystä…',
      installed: 'Päivitys on asennettu. Ota se käyttöön käynnistämällä Desktop uudelleen.', restart: 'Käynnistä Desktop uudelleen',
      failed: 'Päivitys ei valmistunut.', checkFailed: 'Päivitysten tarkistus epäonnistui.', retry: 'Yritä uudelleen',
    },
  };
  let phase = 'checking', version = null, error = '', downloaded = 0, total = null;
  let busy = false, installed = false;
  const t = key => (words[document.documentElement.lang] || words.en)[key];
  const element = (name, text, cls) => {
    const el = document.createElement(name);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  function render() {
    area.hidden = false;
    area.classList.add('update');
    area.replaceChildren();
    const state = element('p', phase === 'available' ? t(phase).replace('{version}', version) : t(phase));
    state.setAttribute('role', 'status');
    state.setAttribute('aria-live', 'polite');
    area.append(state);
    if (phase === 'downloading') {
      const meter = element('progress');
      meter.setAttribute('aria-label', t('downloading'));
      if (total > 0) { meter.max = total; meter.value = Math.min(downloaded, total); }
      area.append(meter);
    }
    if (error) {
      const detail = element('p', error, 'technical');
      detail.setAttribute('role', 'alert');
      area.append(detail);
    }
    if (version && !installed && !busy) area.append(element('p', t('explain'), 'hint'));
    const button = element('button', busy ? t(phase) : t(installed ? 'restart' : version ? 'install' : phase === 'checkFailed' ? 'retry' : 'check'), 'poster-action');
    button.type = 'button';
    button.disabled = busy;
    button.addEventListener('click', installed ? restart : version ? install : check);
    area.append(button);
  }
  async function check() {
    if (busy) return;
    busy = true; phase = 'checking'; error = ''; render();
    try { version = await invoke('check_update'); phase = version ? 'available' : 'current'; }
    catch (e) { phase = 'checkFailed'; error = String(e); }
    finally { busy = false; render(); }
  }
  async function install() {
    if (busy) return;
    busy = true; phase = 'checking'; error = ''; render();
    try {
      installed = await invoke('install_update');
      phase = installed ? 'installed' : 'current';
      if (!installed) version = null;
    } catch (e) { phase = 'failed'; error = String(e); }
    finally { busy = false; render(); }
  }
  async function restart() {
    if (busy) return;
    busy = true; render();
    try { await invoke('restart_desktop'); }
    catch (e) { error = String(e); busy = false; render(); }
  }
  document.addEventListener('desktop-language-change', render);
  // Subscribe before starting a download, so even the first chunk is visible.
  function acceptStatus(payload) {
    const allowed = ['checking', 'downloading', 'verifying', 'stopping', 'installing', 'installed', 'failed', 'none'];
    if (!allowed.includes(payload.phase)) return;
    phase = payload.phase === 'none' ? 'current' : payload.phase;
    busy = ['checking', 'downloading', 'verifying', 'stopping', 'installing'].includes(phase);
    installed = phase === 'installed';
    if ('version' in payload) version = payload.version;
    downloaded = payload.downloaded || 0; total = payload.total;
    error = payload.error || '';
    render();
  }
  window.__TAURI__.event.listen('update-progress', ({ payload }) => acceptStatus(payload))
    .then(async () => {
      const state = await invoke('get_update_status');
      if (state?.phase && state.phase !== 'idle') acceptStatus(state);
      else await check();
    }).catch(e => { phase = 'checkFailed'; error = String(e); render(); });
})();
