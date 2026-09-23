/**
 * @file app-agents.js
 * @description Agent-Bundled Apps surface for the catalog: the "Bundled agents" modal — a
 *   crew-def inspector (crew, tasks, tools, skills), the HOSTED instances shelf (who already
 *   runs this agent + their public offers/prices, via GET .../agents/:name/instances), and the
 *   "deploy your own" form (runner + organism pickers → POST .../deploy on the SIGNED-IN owner's
 *   own fleet). Opened from community cards, library cards, and the owner detail view.
 * @structure
 *   - appManifestAgents()/appHasAgents() — manifest.cortex.agents accessors (server manifest cache)
 *   - showAppAgentsModal() — render + fetch instances/pickers; agentsDeploy()/agentsUndeploy()
 * @usage import { initAppAgents, showAppAgentsModal, agentsDeploy, agentsUndeploy } from './app-agents.js';
 *   initAppAgents({ getServerManifests }) — dep-injected like initDetail, so no import cycle
 *   back through render.js (which imports detail.js, which imports this module).
 * @version-history
 *   v1.0.0 — 2026-07-17 — Initial creation (Agent-Bundled Apps Slice 2: catalog surface)
 *   v1.1.0 — 2026-09-13 — The modal opens through dialogs.js (the site's one dialog).
 *   v1.2.0 — 2026-09-22 — The modal's content is drawn from the shared set (parts-html.js): each
 *     crew-def in a box, crew members as list rows with their tools and skills as chips, the tasks
 *     as numbered steps, each hosted instance as a row with an online marker and its offers as
 *     label-value lines, the runner and organism pickers as fields and Deploy as the dialog's slab.
 *     The robot and morsel emoji are gone (a price says "morsels", as the cost section does).
 */
import { escapeHtml, jsArg } from './util.js';
import { listRow, chip, action, keyValue, stack, columns, surface, text, field, steps } from './parts-html.js';
import { openDlg } from './dialogs.js';
import { showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';

let getServerManifests;
export function initAppAgents(deps) {
  ({ getServerManifests } = deps);
}

function aimeatBase() {
  var config = loadConfig();
  return config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
}

/** The crew-defs a SERVER app declares (from the manifest cache loadPublishedApps fills). */
export function appManifestAgents(owner, filename) {
  var m = getServerManifests ? getServerManifests()[(owner || '') + '\n' + (filename || '')] : null;
  return (m && m.cortex && Array.isArray(m.cortex.agents)) ? m.cortex.agents : [];
}

export function appHasAgents(manifest) {
  return !!(manifest && manifest.cortex && Array.isArray(manifest.cortex.agents) && manifest.cortex.agents.length);
}

/** "12 morsels/run · 2.50 EUR" — an offer's price line, or the ask-for-price fallback. */
function fmtOfferPrice(o) {
  var parts = [];
  if (o.price && typeof o.price.morsels === 'number') {
    // The unit is the word the cost section uses (it was an emoji).
    parts.push(o.price.morsels + ' morsels' + (o.price.unit ? '/' + escapeHtml(o.price.unit) : ''));
  }
  if (o.price_money && typeof o.price_money.amount === 'number') {
    parts.push((o.price_money.amount / 1e6).toFixed(2) + ' ' + escapeHtml(o.price_money.currency || 'EUR'));
  }
  return parts.length ? parts.join(' · ') : t('agents.askPrice');
}

/** One crew-def's inspector block: who's in the crew, what it does, which tools/skills it needs. */
function chipRow(content) { return content ? stack({ direction: 'wrap', density: 'compact' }, content) : ''; }
function quiet(content) { return text({ kind: 'caption', tone: 'muted' }, content); }

function inspectorHtml(def) {
  var crew = (def.agents || []).map(function(a) {
    var tools = (a.tools || []).map(function(x) { return chip(escapeHtml(x)); }).join('');
    var skills = (a.skills || []).map(function(x) { return chip(escapeHtml(x), 'sun'); }).join('');
    return listRow({ density: 'compact', name: escapeHtml(a.role || ''), detail: a.goal ? escapeHtml(a.goal) : '', detailKind: 'text',
      body: chipRow(tools + skills) });
  }).join('');
  var tasks = (def.tasks || []).map(function(tk) {
    var desc = String(tk.description || '');
    if (desc.length > 140) desc = desc.slice(0, 140) + '…';
    return escapeHtml(desc) + (tk.expected_output ? ' → ' + escapeHtml(String(tk.expected_output).slice(0, 80)) : '');
  });
  return stack({ density: 'compact' },
    stack({ direction: 'wrap', align: 'center', density: 'compact' }, text({ kind: 'label' }, t('agents.crew')) +
      (def.llm_profile ? chip(escapeHtml(def.llm_profile)) : '') + (def.process ? chip(escapeHtml(def.process)) : '')) +
    crew +
    text({ kind: 'label' }, t('agents.tasks')) + steps(tasks));
}

function instanceHtml(inst, appOwner, appFilename, agentName) {
  var who = escapeHtml(inst.owner) + (inst.is_yours ? ' ' + chip(t('agents.you')) : '') +
    (inst.source === 'author' ? ' ' + chip(t('agents.author')) : '');
  var offers = (inst.offers || []).map(function(o) {
    return keyValue(escapeHtml(o.title || o.id), fmtOfferPrice(o) + (o.callable ? ' · ' + t('agents.instant') : ''));
  }).join('');
  var undeploy = (inst.is_yours && inst.source === 'deployed')
    ? action({ kind: 'text', tone: 'danger', onclick: 'window._launcher.agentsUndeploy(\'' + jsArg(appOwner) + '\', \'' + jsArg(appFilename) + '\', \'' + jsArg(agentName) + '\')' }, t('agents.undeploy'))
    : '';
  // The marker is the online light: success while the instance is online, muted otherwise.
  return listRow({ marker: inst.online ? 'success' : 'muted', name: who,
    detail: t('agents.trust') + ' ' + (inst.trust_score != null ? inst.trust_score : '—'),
    actions: undeploy, body: offers || quiet(t('agents.noOffers')) });
}

/**
 * Open the Bundled-agents modal for a server app. Renders the inspector immediately, then
 * fills the hosted-instances shelf + the runner/organism pickers asynchronously.
 */
export function showAppAgentsModal(owner, filename) {
  var defs = appManifestAgents(owner, filename);
  if (!defs.length) { showNotice(t('agents.none')); return; }
  var base = aimeatBase();
  if (!base) { showNotice('Set AIMEAT server URL in Settings first'); return; }
  var token = getCortexOwnerToken();

  document.getElementById('agents-modal-app').textContent = owner + '/' + filename;
  var body = document.getElementById('agents-modal-body');
  var html = text({ kind: 'body' }, t('agents.declares'));
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    html += surface({ kind: 'box' }, stack({},
      text({ kind: 'heading', size: 'small' }, escapeHtml(def.agent_name || '')) +
      inspectorHtml(def) +
      text({ kind: 'label' }, t('agents.hostedTitle')) +
      // The shelf fills itself in when the instances answer (by this id).
      '<div id="aga-instances-' + i + '">' + quiet(t('agents.loading')) + '</div>' +
      text({ kind: 'label' }, t('agents.deployTitle')) +
      (token
        ? columns({ layout: 'equal', density: 'compact', collapse: 560 },
            field({ id: 'aga-runner-' + i, type: 'select', label: t('agents.runner'), options: [{ value: '', label: t('agents.loading') }] }) +
            field({ id: 'aga-organism-' + i, type: 'select', label: t('agents.organism'), options: [{ value: '', label: '—' }] })) +
          stack({ direction: 'wrap', align: 'center' },
            action({ kind: 'primary', onclick: 'window._launcher.agentsDeploy(\'' + jsArg(owner) + '\', \'' + jsArg(filename) + '\', \'' + jsArg(def.agent_name) + '\', ' + i + ')' }, t('agents.deployBtn'))) +
          quiet(t('agents.deployDesc'))
        : quiet(t('agents.needLogin')))));
  }
  body.innerHTML = stack({}, html);
  openDlg('agents-overlay');

  // Hosted instances per def (public endpoint — works signed out too).
  defs.forEach(function(def, i) {
    var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
    fetch(base + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) +
          '/agents/' + encodeURIComponent(def.agent_name) + '/instances', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        var el = document.getElementById('aga-instances-' + i);
        if (!el) return;
        var list = (json.data && json.data.instances) || [];
        el.innerHTML = list.length
          ? list.map(function(inst) { return instanceHtml(inst, owner, filename, def.agent_name); }).join('')
          : quiet(t('agents.hostedNone'));
      })
      .catch(function() {
        var el = document.getElementById('aga-instances-' + i);
        if (el) el.textContent = t('agents.hostedError');
      });
  });

  // Runner + organism pickers (signed-in only): my agents (task-runners first) + my organisms.
  if (token) {
    fetch(base + '/v1/agents', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        var agents = (json.data && json.data.agents) || [];
        agents.sort(function(a, b) {
          var rank = function(m) { return m === 'task-runner' ? 0 : m === 'autonomous' ? 1 : 2; };
          return rank(a.mode) - rank(b.mode);
        });
        var opts = agents.length
          ? agents.map(function(a) {
              var label = a.name + (a.mode === 'task-runner' ? ' · task-runner' : a.mode ? ' · ' + a.mode : '');
              var sel = a.name === 'crew-forge' ? ' selected' : '';
              return '<option value="' + escapeHtml(a.name) + '"' + sel + '>' + escapeHtml(label) + '</option>';
            }).join('')
          : '<option value="">' + t('agents.noRunnerOption') + '</option>';
        defs.forEach(function(_, i) {
          var el = document.getElementById('aga-runner-' + i);
          if (el) el.innerHTML = opts;
        });
      }).catch(function() { /* picker keeps its loading placeholder */ });

    var me = null;
    try { me = JSON.parse(localStorage.getItem('aimeat_session')).owner || null; } catch (e) { /* signed out */ }
    if (me) {
      fetch(base + '/v1/organisms?member=' + encodeURIComponent(me), { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(json) {
          var orgs = (json.data && json.data.organisms) || [];
          var opts = '<option value="">—</option>' + orgs.map(function(o) {
            return '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.name || o.id) + '</option>';
          }).join('');
          defs.forEach(function(_, i) {
            var el = document.getElementById('aga-organism-' + i);
            if (el) el.innerHTML = opts;
          });
        }).catch(function() { /* organism stays optional */ });
    }
  }
}

function postAction(owner, filename, agentName, action, bodyObj, doneMsgFor) {
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('agents.needLogin')); return; }
  fetch(aimeatBase() + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) +
        '/agents/' + encodeURIComponent(agentName) + '/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(bodyObj),
  })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (json.ok) { showNotice(doneMsgFor(json.data || {})); }
      else {
        var code = json.error && json.error.code;
        showNotice(code === 'RUNNER_NOT_FOUND'
          ? t('agents.noRunner')
          : ((json.error && json.error.message) || t('agents.deployFailed')));
      }
    })
    .catch(function(err) { showNotice(t('agents.deployFailed') + ': ' + err.message); });
}

/** Deploy handler for the modal's per-def form (reads its runner/organism selects). */
export function agentsDeploy(owner, filename, agentName, idx) {
  var runnerEl = document.getElementById('aga-runner-' + idx);
  var orgEl = document.getElementById('aga-organism-' + idx);
  var body = {};
  if (runnerEl && runnerEl.value) body.runner_agent = runnerEl.value;
  if (orgEl && orgEl.value) body.organism_id = orgEl.value;
  postAction(owner, filename, agentName, 'deploy', body, function(d) {
    return d.auto_activated ? t('agents.deployStarted') : t('agents.deployQueued');
  });
}

export function agentsUndeploy(owner, filename, agentName) {
  postAction(owner, filename, agentName, 'undeploy', {}, function() { return t('agents.undeployQueued'); });
}
