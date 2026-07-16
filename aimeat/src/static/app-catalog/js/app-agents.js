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
 */
import { escapeHtml, jsArg } from './util.js';
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
    parts.push(o.price.morsels + ' \u{1F969}' + (o.price.unit ? '/' + escapeHtml(o.price.unit) : ''));
  }
  if (o.price_money && typeof o.price_money.amount === 'number') {
    parts.push((o.price_money.amount / 1e6).toFixed(2) + ' ' + escapeHtml(o.price_money.currency || 'EUR'));
  }
  return parts.length ? parts.join(' · ') : t('agents.askPrice');
}

/** One crew-def's inspector block: who's in the crew, what it does, which tools/skills it needs. */
function inspectorHtml(def) {
  var crew = (def.agents || []).map(function(a) {
    var tools = (a.tools || []).map(function(x) { return '<span class="aga-chip">' + escapeHtml(x) + '</span>'; }).join('');
    var skills = (a.skills || []).map(function(x) { return '<span class="aga-chip aga-chip-skill">' + escapeHtml(x) + '</span>'; }).join('');
    return '<div class="aga-crew-row"><strong>' + escapeHtml(a.role || '') + '</strong>' +
      (a.goal ? ' — <span class="aga-goal">' + escapeHtml(a.goal) + '</span>' : '') +
      ((tools || skills) ? '<div class="aga-chips">' + tools + skills + '</div>' : '') +
      '</div>';
  }).join('');
  var tasks = (def.tasks || []).map(function(tk) {
    var desc = String(tk.description || '');
    if (desc.length > 140) desc = desc.slice(0, 140) + '…';
    return '<li>' + escapeHtml(desc) + (tk.expected_output ? ' <span class="aga-goal">→ ' + escapeHtml(String(tk.expected_output).slice(0, 80)) + '</span>' : '') + '</li>';
  }).join('');
  return '<div class="aga-inspector">' +
    '<div class="aga-label">' + t('agents.crew') + (def.llm_profile ? ' <span class="aga-chip">' + escapeHtml(def.llm_profile) + '</span>' : '') +
      (def.process ? ' <span class="aga-chip">' + escapeHtml(def.process) + '</span>' : '') + '</div>' +
    crew +
    '<div class="aga-label">' + t('agents.tasks') + '</div><ul class="aga-tasks">' + tasks + '</ul>' +
    '</div>';
}

function instanceHtml(inst, appOwner, appFilename, agentName) {
  var dot = inst.online ? '<span class="aga-dot aga-dot-on"></span>' : '<span class="aga-dot"></span>';
  var who = escapeHtml(inst.owner) + (inst.is_yours ? ' <span class="aga-chip">' + t('agents.you') + '</span>' : '') +
    (inst.source === 'author' ? ' <span class="aga-chip">' + t('agents.author') + '</span>' : '');
  var offers = (inst.offers || []).map(function(o) {
    return '<div class="aga-offer">' +
      '<span class="aga-offer-title">' + escapeHtml(o.title || o.id) + '</span>' +
      '<span class="aga-price">' + fmtOfferPrice(o) + (o.callable ? ' · ' + t('agents.instant') : '') + '</span>' +
      '</div>';
  }).join('');
  var undeploy = (inst.is_yours && inst.source === 'deployed')
    ? '<button class="modal-btn secondary aga-btn-sm" onclick="window._launcher.agentsUndeploy(\'' + jsArg(appOwner) + '\', \'' + jsArg(appFilename) + '\', \'' + jsArg(agentName) + '\')">' + t('agents.undeploy') + '</button>'
    : '';
  return '<div class="aga-inst">' +
    '<div class="aga-inst-head">' + dot + '<strong>' + who + '</strong>' +
      '<span class="aga-goal">' + t('agents.trust') + ' ' + (inst.trust_score != null ? inst.trust_score : '—') + '</span>' + undeploy + '</div>' +
    (offers || '<div class="aga-goal">' + t('agents.noOffers') + '</div>') +
    '</div>';
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
  var html = '<div class="aga-intro">' + t('agents.declares') + '</div>';
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    html += '<div class="aga-def">' +
      '<h3>\u{1F916} ' + escapeHtml(def.agent_name || '') + '</h3>' +
      inspectorHtml(def) +
      '<div class="aga-label">' + t('agents.hostedTitle') + '</div>' +
      '<div id="aga-instances-' + i + '" class="aga-goal">' + t('agents.loading') + '</div>' +
      '<div class="aga-label">' + t('agents.deployTitle') + '</div>' +
      (token
        ? '<div class="aga-deploy-row">' +
            '<label>' + t('agents.runner') + ' <select id="aga-runner-' + i + '" class="modal-input aga-select"><option value="">' + t('agents.loading') + '</option></select></label>' +
            '<label>' + t('agents.organism') + ' <select id="aga-organism-' + i + '" class="modal-input aga-select"><option value="">—</option></select></label>' +
            '<button class="modal-btn aga-deploy-btn" onclick="window._launcher.agentsDeploy(\'' + jsArg(owner) + '\', \'' + jsArg(filename) + '\', \'' + jsArg(def.agent_name) + '\', ' + i + ')">' + t('agents.deployBtn') + '</button>' +
          '</div>' +
          '<div class="aga-goal">' + t('agents.deployDesc') + '</div>'
        : '<div class="aga-goal">' + t('agents.needLogin') + '</div>') +
      '</div>';
  }
  body.innerHTML = html;
  document.getElementById('agents-overlay').hidden = false;

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
        el.className = '';
        el.innerHTML = list.length
          ? list.map(function(inst) { return instanceHtml(inst, owner, filename, def.agent_name); }).join('')
          : '<div class="aga-goal">' + t('agents.hostedNone') + '</div>';
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
