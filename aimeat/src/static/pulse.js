/**
 * @file pulse.js
 * @description PULSE app logic — polls as one-organism-per-poll on AIMEAT primitives:
 *   auth = aimeat-auth.js owner session (main origin); poll + votes = workspace records
 *   (ws 'poll', spaces 'poll'/'vote') so every vote is written under the voter's own
 *   identity; sharing = organism invitation + workspace-contributor grant; revocation =
 *   member removal + grant revoke (membership gate → server-side deny); deletion =
 *   organism delete (purges every member's poll/vote keys server-side).
 * @structure api() envelope fetch → index (pulse.index in own memory) → views
 *   (login/home/poll/denied) → flows: createPoll / openPoll / vote / share / revoke /
 *   closePoll / deletePoll / acceptInvite. 5s refresh tick for the active view.
 * @usage Loaded by /pulse.html (defer, after /v1/libs/aimeat-auth.js). No inline JS (CSP).
 * @version-history
 *   v1.0.0 — 2026-07-13 — initial benchmark build.
 */
(function () {
'use strict';

var WS = 'poll';
var INDEX_KEY = 'pulse.index';

var me = null;            // bare owner name
var view = 'login';
var index = { mine: [], shared: [] };
var current = null;       // { orgId, data } for the open poll
var tick = null;

// ── helpers ──
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function slugName(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60); }

function session() {
  var s = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession();
  return s || null;
}

async function api(path, opts) {
  var s = session();
  if (!s) throw new Error('Not signed in');
  var r = await s.fetch(path, opts);
  if (r && typeof r.json === 'function') r = await r.json();
  if (r && r.ok === false) {
    var e = new Error((r.error && (r.error.message || r.error.code)) || 'Request failed');
    e.code = r.error && r.error.code;
    throw e;
  }
  return (r && r.data !== undefined) ? r.data : r;
}
function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function del(path) { return api(path, { method: 'DELETE' }); }

function stripMeta(v) {
  var out = {};
  Object.keys(v || {}).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = v[k]; });
  return out;
}

// ── own-memory poll index ──
async function loadIndex() {
  try {
    var d = await api('/v1/memory/' + encodeURIComponent(INDEX_KEY));
    var v = d && (d.value !== undefined ? d.value : (d.record && d.record.value));
    if (v && typeof v === 'object') index = { mine: v.mine || [], shared: v.shared || [] };
  } catch (e) { index = { mine: [], shared: [] }; }
}
function saveIndex() {
  return post('/v1/memory', { key: INDEX_KEY, value: index, visibility: 'private' });
}

// ── views ──
function show(name) {
  view = name;
  ['login', 'home', 'poll', 'denied'].forEach(function (v) {
    $('pl-view-' + v).classList.toggle('pl-hidden', v !== name);
  });
}

function setErr(id, msg) { $(id).textContent = msg || ''; }

// ── home ──
function optionInputs() {
  return Array.prototype.slice.call($('pl-opts').querySelectorAll('input'));
}
function addOptionInput(focus) {
  var n = optionInputs().length;
  if (n >= 6) return;
  var row = el('div', 'pl-opt-row');
  var inp = el('input', 'pl-input');
  inp.maxLength = 120;
  inp.placeholder = 'Option ' + (n + 1);
  row.appendChild(inp);
  $('pl-opts').appendChild(row);
  if (focus) inp.focus();
}

function renderList(rootId, items, emptyText, openFn, kind) {
  var root = $(rootId);
  root.textContent = '';
  if (!items.length) { root.appendChild(el('p', 'pl-dim', emptyText)); return; }
  items.forEach(function (it) {
    var row = el('div', 'pl-list-item');
    var t = el('span', 'pl-list-title', it.question || it.orgId);
    t.addEventListener('click', function () { openPoll(it.orgId); });
    row.appendChild(t);
    row.appendChild(el('span', 'pl-badge', kind));
    root.appendChild(row);
  });
}

async function renderInvites() {
  var root = $('pl-invites');
  var d;
  try { d = await api('/v1/organisms/invitations/mine'); }
  catch (e) { return; }
  var invites = (d && d.invitations) || [];
  invites = invites.filter(function (i) { return /^PULSE · /.test((i.organism && i.organism.name) || ''); });
  root.textContent = '';
  if (!invites.length) { root.appendChild(el('p', 'pl-dim', 'No pending invitations.')); return; }
  invites.forEach(function (i) {
    var row = el('div', 'pl-list-item');
    row.appendChild(el('span', 'pl-list-title', i.organism.name.replace(/^PULSE · /, '')));
    var btn = el('button', 'pl-btn pl-btn-primary', 'Accept & open');
    btn.type = 'button';
    btn.addEventListener('click', function () { acceptInvite(i.organism.id, i.organism.name); });
    row.appendChild(btn);
    root.appendChild(row);
  });
}

async function renderHome() {
  renderList('pl-mine', index.mine, 'No polls yet.', openPoll, 'mine');
  renderList('pl-shared', index.shared, 'Nothing shared with you yet.', openPoll, 'shared');
  await renderInvites();
}

// ── poll lifecycle ──
async function createPoll(question, options) {
  var org = await post('/v1/organisms', {
    name: 'PULSE · ' + question.slice(0, 60),
    description: 'A PULSE poll. Content is visible to invited members only.',
    type: 'project', visibility: 'private', join_policy: 'invite_only', max_members: 100,
  });
  var orgId = (org.organism && org.organism.id) || org.id;
  var now = new Date().toISOString();
  var root = 'organism.' + orgId + '.w.' + WS + '.';
  await post('/v1/memory', {
    key: 'organism.' + orgId + '.meta.workspaces',
    value: { workspaces: [{ id: WS, name: 'Poll', createdAt: now, createdBy: me }] },
    visibility: 'private',
  });
  await post('/v1/memory', {
    key: root + 'meta.manifest',
    value: {
      id: orgId, manifestVersion: '1.0', name: 'Poll', kind: 'project', status: 'active',
      objectTypes: [
        { name: 'poll', namespace: 'poll', schemaRef: 'schema:pulse-poll@1', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
        { name: 'vote', namespace: 'vote', schemaRef: 'schema:pulse-vote@1', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
      ],
    },
    visibility: 'private',
  });
  await post('/v1/memory', {
    key: root + 'poll.main.draft',
    value: { id: 'main', question: question, options: options, status: 'open', createdBy: me, createdAt: now },
    visibility: 'private',
  });
  await post('/v1/organisms/' + encodeURIComponent(orgId) + '/publish', { ws: WS, namespace: 'poll', id: 'main' });
  index.mine.unshift({ orgId: orgId, question: question, createdAt: now });
  await saveIndex();
  return orgId;
}

function readPollData(wsData) {
  var polls = (wsData.objects && wsData.objects.poll) || [];
  var poll = null;
  polls.forEach(function (p) { if (p && p.id === 'main') poll = p; });
  if (!poll && wsData.drafts && wsData.drafts.poll) {
    (wsData.drafts.poll || []).forEach(function (p) { if (p && p.id === 'main') poll = p; });
  }
  var votes = {};
  ((wsData.objects && wsData.objects.vote) || []).forEach(function (v) {
    if (!v || typeof v.id !== 'string' || v.id.indexOf('v-') !== 0) return;
    // one vote per identity: one record id per voter; keep the freshest
    if (!votes[v.id] || String(v.votedAt) > String(votes[v.id].votedAt)) votes[v.id] = v;
  });
  return { poll: poll, votes: votes };
}

async function openPoll(orgId) {
  setErr('pl-poll-err', '');
  var wsData;
  try {
    wsData = await api('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace?ws=' + WS);
  } catch (e) {
    show('denied');
    return;
  }
  var pd = readPollData(wsData);
  if (!pd.poll) { show('denied'); return; }
  current = { orgId: orgId, poll: pd.poll, votes: pd.votes };
  renderPoll();
  show('poll');
  if (location.hash !== '#p=' + orgId) location.hash = 'p=' + orgId;
}

function countVotes() {
  var poll = current.poll;
  var closedAt = poll.status === 'closed' ? (poll.closedAt || '') : null;
  var counts = poll.options.map(function () { return 0; });
  var myVote = null;
  Object.keys(current.votes).forEach(function (id) {
    var v = current.votes[id];
    if (closedAt && String(v.votedAt) > closedAt) return; // votes after close don't count
    if (typeof v.option === 'number' && v.option >= 0 && v.option < counts.length) counts[v.option]++;
    if (id === 'v-' + slugName(me)) myVote = v;
  });
  return { counts: counts, myVote: myVote, total: counts.reduce(function (a, b) { return a + b; }, 0) };
}

function renderPoll() {
  var poll = current.poll;
  var isCreator = poll.createdBy === me;
  var open = poll.status === 'open';
  $('pl-poll-q').textContent = poll.question;
  var badge = $('pl-poll-status');
  badge.textContent = open ? 'open' : 'closed';
  badge.className = 'pl-badge ' + (open ? 'pl-badge-open' : 'pl-badge-closed');
  var res = countVotes();
  $('pl-poll-meta').textContent = 'by ' + poll.createdBy + ' · ' + res.total + ' vote' + (res.total === 1 ? '' : 's');

  var body = $('pl-poll-body');
  body.textContent = '';
  poll.options.forEach(function (opt, i) {
    if (open) {
      var btn = el('button', 'pl-vote-opt' + (res.myVote && res.myVote.option === i ? ' pl-my-vote' : ''));
      btn.type = 'button';
      var label = el('span', null, opt);
      btn.appendChild(label);
      if (isCreator || res.myVote) {
        var n = res.counts[i];
        btn.appendChild(el('span', 'pl-dim', '  · ' + n));
      }
      btn.addEventListener('click', function () { vote(i); });
      body.appendChild(btn);
    } else {
      var row = el('div', 'pl-result-row');
      var lab = el('div', 'pl-result-label');
      lab.appendChild(el('span', null, opt));
      lab.appendChild(el('span', 'pl-dim', String(res.counts[i])));
      row.appendChild(lab);
      var bar = el('div', 'pl-result-bar');
      var fill = el('div', 'pl-result-fill');
      fill.style.width = (res.total ? Math.round(res.counts[i] * 100 / res.total) : 0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      body.appendChild(row);
    }
  });
  if (open && res.myVote) body.appendChild(el('p', 'pl-dim', 'You voted — click another option to change your vote.'));

  $('pl-manage').classList.toggle('pl-hidden', !isCreator);
  $('pl-close-btn').classList.toggle('pl-hidden', !open);
  if (isCreator) renderMembers();
}

async function renderMembers() {
  var root = $('pl-members');
  var d;
  try { d = await api('/v1/organisms/' + encodeURIComponent(current.orgId) + '/workspace-access?ws=' + WS); }
  catch (e) { return; }
  var members = (d && d.members) || [];
  root.textContent = '';
  if (!members.length) { root.appendChild(el('p', 'pl-dim', 'Not shared with anyone yet.')); return; }
  members.forEach(function (m) {
    var name = m.owner || m.grantee || m.ghii || '';
    name = String(name).split('@')[0];
    if (!name || name === me) return;
    var row = el('div', 'pl-list-item');
    row.appendChild(el('span', null, name));
    var btn = el('button', 'pl-btn pl-btn-danger', 'Revoke');
    btn.type = 'button';
    btn.addEventListener('click', function () { revoke(name); });
    row.appendChild(btn);
    root.appendChild(row);
  });
}

async function vote(optionIdx) {
  setErr('pl-poll-err', '');
  var orgId = current.orgId;
  var id = 'v-' + slugName(me);
  try {
    await post('/v1/memory', {
      key: 'organism.' + orgId + '.w.' + WS + '.vote.' + id + '.draft',
      value: { id: id, option: optionIdx, voter: me, votedAt: new Date().toISOString() },
      visibility: 'private',
    });
    await post('/v1/organisms/' + encodeURIComponent(orgId) + '/publish', { ws: WS, namespace: 'vote', id: id });
    await openPoll(orgId);
  } catch (e) {
    setErr('pl-poll-err', 'Vote failed: ' + e.message);
  }
}

async function share(username) {
  setErr('pl-manage-err', '');
  var orgId = current.orgId;
  username = String(username || '').trim().split('@')[0];
  if (!username) return;
  try {
    try {
      await post('/v1/organisms/' + encodeURIComponent(orgId) + '/invitations', { invitee: username });
    } catch (e) {
      if (e.code !== 'ALREADY_MEMBER' && e.code !== 'ALREADY_INVITED') throw e;
    }
    await post('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace-access/grant', { ws: WS, grantee: username, role: 'contributor' });
    $('pl-share-user').value = '';
    await renderMembers();
  } catch (e) {
    setErr('pl-manage-err', 'Share failed: ' + e.message);
  }
}

async function revoke(username) {
  setErr('pl-manage-err', '');
  var orgId = current.orgId;
  try {
    try { await post('/v1/organisms/' + encodeURIComponent(orgId) + '/workspace-access/revoke', { ws: WS, grantee: username }); }
    catch (e) { /* grant may not exist; membership removal below is the hard gate */ }
    await del('/v1/organisms/' + encodeURIComponent(orgId) + '/members/' + encodeURIComponent(username));
    await renderMembers();
  } catch (e) {
    setErr('pl-manage-err', 'Revoke failed: ' + e.message);
  }
}

async function closePoll() {
  setErr('pl-manage-err', '');
  var orgId = current.orgId;
  try {
    var v = stripMeta(current.poll);
    v.status = 'closed';
    v.closedAt = new Date().toISOString();
    await post('/v1/memory', {
      key: 'organism.' + orgId + '.w.' + WS + '.poll.main.draft',
      value: v, visibility: 'private',
    });
    await post('/v1/organisms/' + encodeURIComponent(orgId) + '/publish', { ws: WS, namespace: 'poll', id: 'main' });
    await openPoll(orgId);
  } catch (e) {
    setErr('pl-manage-err', 'Close failed: ' + e.message);
  }
}

async function deletePoll() {
  setErr('pl-manage-err', '');
  if (!window.confirm('Delete this poll and all its votes? This cannot be undone.')) return;
  var orgId = current.orgId;
  try {
    await del('/v1/organisms/' + encodeURIComponent(orgId));
    index.mine = index.mine.filter(function (p) { return p.orgId !== orgId; });
    await saveIndex();
    goHome();
  } catch (e) {
    setErr('pl-manage-err', 'Delete failed: ' + e.message);
  }
}

async function acceptInvite(orgId, orgName) {
  try {
    await post('/v1/organisms/' + encodeURIComponent(orgId) + '/invitations/accept', {});
    var q = String(orgName || '').replace(/^PULSE · /, '');
    if (!index.shared.some(function (p) { return p.orgId === orgId; })) {
      index.shared.unshift({ orgId: orgId, question: q, sharedAt: new Date().toISOString() });
      await saveIndex();
    }
    await openPoll(orgId);
  } catch (e) {
    await renderHome();
  }
}

// ── navigation + refresh ──
function goHome() {
  current = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  renderHome();
  show('home');
}

async function refreshTick() {
  try {
    if (view === 'poll' && current) {
      var wsData = await api('/v1/organisms/' + encodeURIComponent(current.orgId) + '/workspace?ws=' + WS);
      var pd = readPollData(wsData);
      if (pd.poll) { current.poll = pd.poll; current.votes = pd.votes; renderPoll(); }
      else show('denied');
    } else if (view === 'home') {
      await renderInvites();
    }
  } catch (e) {
    if (view === 'poll' && (e.code === 'ACCESS_DENIED' || e.code === 'NOT_FOUND' || e.code === 'CONSENT_REQUIRED')) show('denied');
  }
}

// ── boot ──
async function onSignedIn() {
  var s = session();
  me = (s.owner || (s.user && s.user.owner) || s.ghii || '').split('@')[0].split('#').pop();
  $('pl-whoami').textContent = me;
  await loadIndex();
  var m = location.hash.match(/^#p=([A-Za-z0-9-]+)$/);
  if (m) { await openPoll(m[1]); } else { goHome(); }
  if (!tick) tick = setInterval(refreshTick, 5000);
}

function onSignedOut() {
  me = null; current = null;
  if (tick) { clearInterval(tick); tick = null; }
  $('pl-whoami').textContent = '';
  show('login');
}

function boot() {
  // create-form wiring
  addOptionInput(); addOptionInput();
  $('pl-add-opt').addEventListener('click', function () { addOptionInput(true); });
  $('pl-create-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    setErr('pl-create-err', '');
    var q = $('pl-q').value.trim();
    var opts = optionInputs().map(function (i) { return i.value.trim(); }).filter(Boolean);
    if (!q) { setErr('pl-create-err', 'A question is required.'); return; }
    if (opts.length < 2) { setErr('pl-create-err', 'At least 2 options are required.'); return; }
    try {
      var orgId = await createPoll(q, opts.slice(0, 6));
      $('pl-q').value = '';
      $('pl-opts').textContent = ''; addOptionInput(); addOptionInput();
      await openPoll(orgId);
    } catch (e) {
      setErr('pl-create-err', 'Could not create the poll: ' + e.message);
    }
  });
  $('pl-share-form').addEventListener('submit', function (ev) { ev.preventDefault(); share($('pl-share-user').value); });
  $('pl-close-btn').addEventListener('click', closePoll);
  $('pl-delete-btn').addEventListener('click', deletePoll);
  $('pl-back').addEventListener('click', goHome);
  $('pl-denied-back').addEventListener('click', goHome);
  $('pl-login-btn').addEventListener('click', function () { window.AIMEAT.auth.login().then(function () { onSignedIn(); }).catch(function () {}); });

  // Official login pill: fires onLogin on interactive login; the lib's silent boot-restore
  // emits 'login' events the pill consumes — poll getSession() briefly to catch the restore.
  if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.mountLoginButton) {
    window.AIMEAT.auth.mountLoginButton('#pl-login-slot', {
      onLogin: function () { onSignedIn(); },
      onLogout: function () { onSignedOut(); },
    });
  }
  show('login');
  // Silent boot restore: login() hydrates the session from stored credentials / the
  // httpOnly refresh cookie without showing UI, and returns null when signed out.
  window.AIMEAT.auth.login().then(function (s) {
    if (s && !me) onSignedIn();
  }).catch(function () { /* stay on the login view */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
