// Front-door interactions. Local profiles and notices survive a language change.
(function () {
  const model = window.DesktopFrontdoor;
  const invoke = window.__TAURI__?.core?.invoke;
  const $ = (id) => document.getElementById(id);
  const strings = {
    en: {
      title: 'Your AI tools', lead: 'Add your AIMEAT to the AI tools on this computer. Then sign in in each tool and try the first read below.',
      environment: 'AIMEAT environment', personal: 'Personal', work: 'Work', localKind: 'On this computer', custom: 'Another AIMEAT', name: 'Name', address: 'Address',
      addressHint: 'For example aimeat.io or http://localhost:41050. You can also paste the full MCP address.',
      environmentHint: 'Names and addresses are saved on this computer. Changing this selection does not change any AI tool.',
      check: 'Check address and tools', newEnvironment: 'Add an environment', access: 'Manage AI access', listTitle: 'On this computer',
      firstTitle: 'Try the first read', firstHint: 'After signing in, paste this prompt into the tool you added. It asks the AI to read what your AIMEAT can do.',
      firstPrivacy: 'This app cannot see the tool’s sign-in or its answer. Removing a local setting leaves its account permissions unchanged. Use Manage AI access to withdraw them.',
      copyPrompt: 'Copy the prompt', local: 'Run an AIMEAT on this computer', language: 'Language',
      absent: 'not found on this computer', added: '✓ address added', off: 'not added', cloud: 'in its own settings', unreadable: 'settings could not be read',
      add: 'Add', addSeparate: 'Add as a separate connection', remove: 'Remove this setting', replace: 'Replace this connection', confirmReplace: 'Confirm replacement', cancel: 'Cancel',
      addAll: 'Add to all available tools', addedAll: 'Added to {count} of {total} tools. Existing connections were kept. Restart the tools you added and sign in.', partialAll: 'Added to {count} of {total} tools. These tools need attention: {tools}. The other additions remain in place.',
      replaceHint: 'Replace {name} at {old} with {next}? Other connections stay as they are.',
      removing: 'Removing the selected setting…', checking: 'Checking the address…', adding: 'Checking the address and adding the connection…', replacing: 'Checking the address and replacing the selected connection…',
      addedNotice: '{tool} now has the address. Restart the tool, sign in, then try the prompt below.', removedNotice: 'The selected setting was removed. Restart {tool}. Its account permissions remain until you withdraw them in Manage AI access.',
      checked: 'This address answers as AIMEAT. The list below shows the settings on this computer.', copied: 'Copied.', copyFailed: 'The clipboard was not available. Select and copy the visible text.',
      copyAddress: 'Copy the address', cloudHint: 'In Claude Desktop, open Settings, Connectors, then Add custom connector. Paste this address and sign in. This app cannot read those account settings.',
      cloudLocal: 'Claude Desktop’s remote connector reaches the address from Anthropic’s cloud. Use an AIMEAT reachable from the internet, or a local tool such as Claude Code.',
      signin: 'Restart {tool}, open its MCP server settings and sign in to {name}. Then try the prompt below.',
      'signin.claude-code': 'Start a new Claude Code session. Enter /mcp, select {name}, then Authenticate. Sign in in the browser, then try the prompt below.',
      'signin.cursor': 'Restart Cursor. Open its MCP settings, find {name} and complete its sign-in. Then try the prompt below.',
      'signin.vscode': 'In VS Code, run MCP: List Servers, choose {name}, and start it. Complete its sign-in, then try the prompt below.',
      'signin.codex': 'Start a new Codex session. Open its MCP server list and complete the sign-in for {name}. Then try the prompt below.',
      noBackend: 'This page is open in a browser. Open the desktop app to read or change this computer’s tool settings.', empty: 'Enter this environment’s address, then check it.', failed: 'The action did not complete.', technical: 'Technical details',
      ADDRESS_INVALID: 'Enter a valid web address without a query, fragment or account details.', ADDRESS_INSECURE: 'Use HTTPS for an internet address. HTTP is allowed for a local address.',
      ADDRESS_UNREACHABLE: 'The address did not answer. Check the address and network. For a local AIMEAT, start it first.', ADDRESS_NOT_AIMEAT: 'The address did not identify itself as AIMEAT. Check that you used the right address.',
      CONFIG_INVALID: 'The settings file could not be read in its expected format. It was left unchanged.', CONFIG_READ: 'The settings file could not be read. It was left unchanged.', CONFIG_WRITE: 'The settings could not be saved.',
      CONFIG_CHANGED: 'The settings changed while this action was running. Check the tools again and retry.', CONNECTION_CHANGED: 'This connection changed. Check the tools again before changing it.', CONNECTION_EXISTS: 'That name already belongs to another connection. Add a separate connection or choose one to replace.',
      CONNECTION_MISSING: 'The selected connection is no longer in the settings.', TOOL_UNSUPPORTED: 'This tool is configured in its own settings.',
    },
    fi: {
      title: 'Tekoälysi', lead: 'Lisää oma AIMEATisi tämän koneen tekoälyohjelmiin. Kirjaudu sitten kussakin ohjelmassa ja kokeile alla olevaa kehotetta.',
      environment: 'AIMEAT-ympäristö', personal: 'Oma', work: 'Työ', localKind: 'Tällä koneella', custom: 'Muu AIMEAT', name: 'Nimi', address: 'Osoite',
      addressHint: 'Esimerkiksi aimeat.io tai http://localhost:41050. Voit myös liittää koko MCP-osoitteen.',
      environmentHint: 'Nimet ja osoitteet tallentuvat tälle koneelle. Valinnan vaihtaminen ei muuta tekoälyohjelmien asetuksia.',
      check: 'Tarkista osoite ja ohjelmat', newEnvironment: 'Lisää ympäristö', access: 'Hallitse tekoälyn oikeuksia', listTitle: 'Tällä koneella',
      firstTitle: 'Kokeile yhteyttä', firstHint: 'Kun olet kirjautunut, liitä tämä kehote lisäämääsi ohjelmaan. Se pyytää tekoälyä lukemaan, mitä AIMEATissasi voi tehdä.',
      firstPrivacy: 'Tämä sovellus ei näe ohjelman kirjautumista eikä sen vastausta. Paikallisen asetuksen poistaminen ei peru tilillä annettuja oikeuksia. Voit perua ne kohdasta Hallitse tekoälyn oikeuksia.',
      copyPrompt: 'Kopioi kehote', local: 'Oma AIMEAT tällä koneella', language: 'Kieli',
      absent: 'ei löytynyt tältä koneelta', added: '✓ osoite lisätty', off: 'ei lisätty', cloud: 'omissa asetuksissaan', unreadable: 'asetuksia ei voitu lukea',
      add: 'Lisää', addSeparate: 'Lisää erillinen yhteys', remove: 'Poista tämä asetus', replace: 'Korvaa tämä yhteys', confirmReplace: 'Vahvista korvaaminen', cancel: 'Peruuta',
      addAll: 'Lisää kaikkiin käytettävissä oleviin ohjelmiin', addedAll: 'Lisätty {count} ohjelmaan. Ohjelmia oli {total}. Aiemmat yhteydet säilyivät. Käynnistä ohjelmat, joihin lisäsit yhteyden, uudelleen ja kirjaudu.', partialAll: 'Lisätty {count} ohjelmaan. Ohjelmia oli {total}. Näiden ohjelmien lisäys ei onnistunut: {tools}. Muut lisäykset säilyvät.',
      replaceHint: 'Korvataanko yhteyden {name} osoite {old} osoitteella {next}? Muut yhteydet säilyvät.',
      removing: 'Poistan valitun asetuksen…', checking: 'Tarkistan osoitetta…', adding: 'Tarkistan osoitteen ja lisään yhteyden…', replacing: 'Tarkistan osoitteen ja korvaan valitun yhteyden…',
      addedNotice: '{tool} tuntee nyt osoitteen. Käynnistä ohjelma uudelleen, kirjaudu ja kokeile alla olevaa kehotetta.', removedNotice: 'Valittu asetus on poistettu. Käynnistä {tool} uudelleen. Tilillä annetut oikeudet säilyvät, kunnes perut ne kohdasta Hallitse tekoälyn oikeuksia.',
      checked: 'Osoitteessa vastaa AIMEAT. Alla näkyvät tämän koneen ohjelmien asetukset.', copied: 'Kopioitu.', copyFailed: 'Leikepöytä ei ollut käytettävissä. Valitse näkyvä teksti ja kopioi se.',
      copyAddress: 'Kopioi osoite', cloudHint: 'Avaa Claude Desktopin asetukset, sitten Liittimet ja Lisää oma liitin. Liitä osoite ja kirjaudu. Tämä sovellus ei voi lukea Claude-tilisi asetuksia.',
      cloudLocal: 'Claude Desktopin etäliitin ottaa yhteyden Anthropicin pilvestä. Käytä internetistä tavoitettavaa AIMEATia tai tällä koneella toimivaa ohjelmaa, kuten Claude Codea.',
      signin: 'Käynnistä {tool} uudelleen, avaa sen MCP-palvelinten asetukset ja kirjaudu yhteyteen {name}. Kokeile sitten alla olevaa kehotetta.',
      'signin.claude-code': 'Aloita uusi Claude Code -istunto. Kirjoita /mcp, valitse {name} ja sitten Authenticate. Kirjaudu selaimessa ja kokeile alla olevaa kehotetta.',
      'signin.cursor': 'Käynnistä Cursor uudelleen. Avaa sen MCP-asetukset, etsi {name} ja kirjaudu. Kokeile sitten alla olevaa kehotetta.',
      'signin.vscode': 'Suorita VS Codessa MCP: List Servers, valitse {name} ja käynnistä se. Kirjaudu ja kokeile sitten alla olevaa kehotetta.',
      'signin.codex': 'Aloita uusi Codex-istunto. Avaa sen MCP-palvelinten luettelo ja kirjaudu yhteyteen {name}. Kokeile sitten alla olevaa kehotetta.',
      noBackend: 'Tämä sivu on auki selaimessa. Avaa työpöytäsovellus, jotta voit lukea tai muuttaa tämän koneen ohjelmien asetuksia.', empty: 'Anna tämän ympäristön osoite ja tarkista se.', failed: 'Toiminto ei onnistunut.', technical: 'Tekniset tiedot',
      ADDRESS_INVALID: 'Anna kelvollinen verkko-osoite ilman kyselyä, sivuviitettä tai tilin tietoja.', ADDRESS_INSECURE: 'Käytä internet-osoitteessa HTTPS-yhteyttä. HTTP sopii paikalliseen osoitteeseen.',
      ADDRESS_UNREACHABLE: 'Osoite ei vastannut. Tarkista osoite ja verkkoyhteys. Käynnistä paikallinen AIMEAT ensin.', ADDRESS_NOT_AIMEAT: 'Osoite ei vastannut AIMEATina. Tarkista, että osoite on oikea.',
      CONFIG_INVALID: 'Asetustiedostoa ei voitu lukea odotetussa muodossa. Tiedosto säilyi ennallaan.', CONFIG_READ: 'Asetustiedostoa ei voitu lukea. Tiedosto säilyi ennallaan.', CONFIG_WRITE: 'Asetuksia ei voitu tallentaa.',
      CONFIG_CHANGED: 'Asetukset muuttuivat toiminnon aikana. Tarkista ohjelmat uudelleen ja yritä sitten uudestaan.', CONNECTION_CHANGED: 'Tämä yhteys on muuttunut. Tarkista ohjelmat uudelleen ennen sen muuttamista.', CONNECTION_EXISTS: 'Nimi on jo toisen yhteyden käytössä. Lisää erillinen yhteys tai valitse korvattava yhteys.',
      CONNECTION_MISSING: 'Valittua yhteyttä ei enää ole asetuksissa.', TOOL_UNSUPPORTED: 'Tämä ohjelma liitetään sen omista asetuksista.',
    },
  };
  function stored(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  let lang = stored('aimeat.lang') || (navigator.language || 'en').slice(0, 2);
  if (!strings[lang]) lang = 'en';
  const profiles = model.initial(stored(model.STORAGE_KEY), stored('aimeat.address'), new URLSearchParams(location.search).get('local'));
  let connectors = [], busy = false, notice = null, replacement = null;
  const snippets = new Map();
  function t(key, vars = {}) { let text = strings[lang][key] || strings.en[key] || key; for (const [k, v] of Object.entries(vars)) text = text.replaceAll('{' + k + '}', v); return text; }
  function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function title(profile) { return profile.name || t(profile.kind === 'local' ? 'localKind' : profile.kind); }
  function persist() { try { localStorage.setItem(model.STORAGE_KEY, JSON.stringify(profiles)); localStorage.setItem('aimeat.address', model.current(profiles).address); } catch (_) { /* Storage can be unavailable. */ } }
  function draft() { model.saveDraft(profiles, $('environmentName').value, $('addr').value); persist(); }
  function fillProfile() { const p = model.current(profiles); $('environmentName').value = p.name; $('environmentName').placeholder = title(p); $('addr').value = p.address; }
  function address() { return $('addr').value.trim(); }
  function say(key, vars = {}, error = '') { notice = { key, vars, error }; renderNotice(); }
  function renderNotice() {
    const box = $('notice'); box.replaceChildren(); if (!notice) return;
    const aside = node('div', 'poster-aside' + (notice.error ? ' notice-error' : ''), t(notice.key, notice.vars));
    if (notice.error) { const details = node('details', 'technical'); details.append(node('summary', '', t('technical')), node('p', '', notice.error)); aside.append(details); }
    box.append(aside);
  }
  function report(error) { const code = model.errorCode(error); say(strings.en[code] ? code : 'failed', {}, String(error)); }
  function button(key, action) { const b = node('button', 'poster-action', t(key)); b.disabled = busy; b.addEventListener('click', action); return b; }
  function paintBusy() {
    // Updates own their own busy state. A connector refresh must not unlock an installer button.
    for (const el of document.querySelectorAll('.environment button, .environment input, .environment select, #list button, #copyPrompt, #connectAll')) el.disabled = busy;
    if (!invoke) { $('recheck').disabled = true; $('access').disabled = true; }
    $('list').setAttribute('aria-busy', String(busy));
  }
  async function run(key, operation) { if (busy) return; busy = true; say(key); paintBusy(); try { await operation(); } catch (e) { report(e); } finally { busy = false; render(); } }
  async function readTools() { connectors = await invoke('detect_connectors', { nodeUrl: address() }); }
  async function refresh(check = false) {
    draft(); replacement = null;
    if (!invoke) { say('noBackend'); return; }
    if (!address()) { connectors = []; say('empty'); render(); return; }
    await run('checking', async () => {
      if (check) { const result = await invoke('check_connector_address', { nodeUrl: address() }); $('addr').value = result.base_url; draft(); }
      await readTools(); if (check) say('checked'); else notice = null;
    });
  }
  async function add(c, entry) {
    draft();
    await run(entry ? 'replacing' : 'adding', async () => {
      const p = model.current(profiles);
      await invoke('connect_connector', { id: c.id, nodeUrl: address(), name: 'aimeat-' + (p.name || p.id), replaceName: entry?.name || null, replaceUrl: entry?.url || null });
      replacement = null; await readTools(); say('addedNotice', { tool: c.name });
    });
  }
  async function remove(c, entry) {
    await run('removing', async () => {
      await invoke('disconnect_connector', { id: c.id, nodeUrl: address(), name: entry.name });
      await readTools(); say('removedNotice', { tool: c.name });
    });
  }
  function pendingTools() { return connectors.filter((c) => c.installed && c.method === 'file' && !c.connected && !c.config_error); }
  async function addAll() {
    draft(); const pending = pendingTools();
    await run('adding', async () => {
      const errors = []; let count = 0; const p = model.current(profiles);
      for (const c of pending) {
        try { await invoke('connect_connector', { id: c.id, nodeUrl: address(), name: 'aimeat-' + (p.name || p.id), replaceName: null, replaceUrl: null }); count++; }
        catch (e) { errors.push({ tool: c.name, error: String(e) }); }
      }
      await readTools();
      say(errors.length ? 'partialAll' : 'addedAll', { count, total: pending.length, tools: errors.map((e) => e.tool).join(', ') }, errors.map((e) => e.tool + ': ' + e.error).join('\n'));
    });
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); say('copied'); } catch (_) { say('copyFailed'); } }
  function renderRows() {
    const list = $('list'); list.replaceChildren();
    for (const c of connectors) {
      const row = node('div', 'poster-row'), line = node('div', 'tool');
      line.append(node('div', 'name', c.name));
      const key = !c.installed ? 'absent' : c.config_error ? 'unreadable' : c.method === 'cloud' ? 'cloud' : c.connected ? 'added' : 'off';
      const state = node('div', 'state'); state.append(node('span', 'poster-chip' + (c.connected ? ' poster-chip--on' : ''), t(key))); line.append(state); row.append(line);
      if (!c.installed) { list.append(row); continue; }
      if (c.config_error) row.append(node('p', 'why', t(model.errorCode(c.config_error))));
      if (c.method === 'cloud') {
        row.append(node('p', 'why', t(c.address_is_local ? 'cloudLocal' : 'cloudHint')));
        if (!c.address_is_local) {
          row.append(button('copyAddress', async () => {
            try { const text = await invoke('connector_snippet', { id: c.id, nodeUrl: address() }); snippets.set(c.id, text); render(); await copy(text); } catch (e) { report(e); }
          }));
          if (snippets.has(c.id)) row.append(node('pre', 'snippet', snippets.get(c.id)));
        }
      } else {
        const entries = c.entries || [];
        if (!c.connected && !c.config_error) row.append(button(entries.length ? 'addSeparate' : 'add', () => add(c)));
        for (const entry of entries) {
          const part = node('div', 'connection'); part.append(node('div', 'connection-name', entry.name), node('div', 'path', entry.url));
          const actions = node('div', 'acts');
          if (entry.matches_selected) {
            actions.append(button('remove', () => remove(c, entry)));
            part.append(node('p', 'why', t('signin.' + c.id, { tool: c.name, name: entry.name })));
          } else if (!c.config_error) actions.append(button('replace', () => { replacement = { tool: c.id, entry }; render(); }));
          part.append(actions);
          if (replacement?.tool === c.id && replacement.entry.name === entry.name) {
            const ask = node('div', 'poster-aside', t('replaceHint', { name: entry.name, old: entry.url, next: address() }));
            const choices = node('div', 'acts below'); choices.append(button('confirmReplace', () => add(c, entry)), button('cancel', () => { replacement = null; render(); })); ask.append(choices); part.append(ask);
          }
          row.append(part);
        }
      }
      if (c.config_path) row.append(node('div', 'path', c.config_path));
      list.append(row);
    }
    $('connectAll').hidden = pendingTools().length < 2;
  }
  function render() {
    document.documentElement.lang = lang; $('lang').value = lang; $('lang').setAttribute('aria-label', t('language'));
    for (const el of document.querySelectorAll('[data-text]')) el.textContent = t(el.dataset.text);
    $('environment').replaceChildren(...profiles.items.map((p) => { const option = node('option', '', title(p)); option.value = p.id; return option; }));
    $('environment').value = profiles.selected; $('environmentName').placeholder = title(model.current(profiles));
    $('crumb').textContent = title(model.current(profiles)); $('firstPrompt').textContent = model.FIRST_PROMPT;
    renderRows(); renderNotice(); paintBusy();
  }
  $('environment').addEventListener('change', async (event) => { const next = event.target.value; draft(); profiles.selected = next; persist(); fillProfile(); snippets.clear(); await refresh(); });
  $('environmentName').addEventListener('input', () => { draft(); $('crumb').textContent = title(model.current(profiles)); });
  $('environmentName').addEventListener('change', render);
  $('addr').addEventListener('change', () => { snippets.clear(); refresh(); });
  $('recheck').addEventListener('click', () => refresh(true));
  $('newEnvironment').addEventListener('click', () => { draft(); const id = 'custom-' + Date.now() + '-' + profiles.items.length; profiles.items.push({ id, kind: 'custom', name: '', address: '' }); profiles.selected = id; persist(); connectors = []; replacement = null; fillProfile(); say('empty'); render(); $('environmentName').focus(); });
  $('copyPrompt').addEventListener('click', () => copy(model.FIRST_PROMPT));
  $('connectAll').addEventListener('click', addAll);
  $('access').addEventListener('click', () => run('checking', async () => { const result = await invoke('check_connector_address', { nodeUrl: address() }); await invoke('open_external', { url: result.base_url + '/v1/profile?tab=mcp' }); notice = null; }));
  $('lang').addEventListener('change', (event) => { lang = event.target.value; try { localStorage.setItem('aimeat.lang', lang); } catch (_) {} render(); document.dispatchEvent(new CustomEvent('desktop-language-change')); });
  fillProfile(); persist(); render(); refresh();
  if (window.__TAURI__?.app?.getVersion) window.__TAURI__.app.getVersion().then((v) => { $('version').textContent = 'v' + v; }).catch(() => {});
})();
