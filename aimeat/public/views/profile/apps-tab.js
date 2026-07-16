/**
 * @file apps-tab.js
 * @description Profile tab for HTML app management — upload, gallery, access code editing.
 * @version-history
 *   v1.6.0 — 2026-07-16 — Agent-Bundled Apps: My-Apps cards show a "ships an agent" badge for apps
 *     declaring manifest.cortex.agents, with per-agent Deploy/Undeploy onto the owner's own fleet
 *     and liveness read from the deploy status endpoint (AppAgents component).
 *   v1.5.0 — 2026-07-06 — Bound skills (2d): each My-Apps card shows the skills that teach agents
 *     this app + an attach/detach picker (rewrites the skill's frontmatter metadata.binding).
 *   v1.4.0 — 2026-06-26 — Add "Edit details" (rename + edit description) to My Apps — updates the
 *     display name in place without re-publishing; the app link (owner/filename) stays the same.
 *   v1.3.0 — 2026-06-24 — Show a "moderated by operator: hidden" badge + hint (with reason) on My Apps
 *     when an operator has hidden the app; the owner sees it but cannot lift it.
 *   v1.2.0 — 2026-06-20 — Add Park/Unpark control + Parked badge/hint to My Apps (hide an app
 *     from the public catalogue while keeping it usable by its owner)
 *   v1.1.0 — 2026-03-19 — Add launch button to My Apps list
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS utility classes (card-h3, text-caption, etc.)
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, handleImgError, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { listApps, uploadApp, deleteApp, patchApp, deployAppAgent, undeployAppAgent, appAgentStatus } from '/js/services/apps.js';
import * as skillsService from '/js/services/skills.js';
import { getNodeUrl } from '/js/services/auth.js';
import { recordRecent } from '/js/recents.js';

/**
 * Per-app bound skills (2d): the skills that teach agents how to use THIS app.
 * Binding lives in the SKILL's frontmatter (metadata.binding: app:{owner}/{filename});
 * attach/detach here rewrites that frontmatter and republishes the skill.
 */
function AppSkills({ owner, filename, showToast }) {
  const [skills, setSkills] = useState(null);
  const [mySkills, setMySkills] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const binding = `app:${owner}/${filename}`;

  const load = useCallback(async () => {
    try { setSkills(await skillsService.listAppSkills(owner, filename)); } catch { setSkills([]); }
  }, [owner, filename]);
  useEffect(() => { load(); }, [load]);

  async function openPicker() {
    if (pickerOpen) { setPickerOpen(false); return; }
    setPickerOpen(true);
    if (!mySkills) {
      try {
        const mine = await skillsService.listScope('user');
        const bound = new Set((skills ?? []).map(s => s.ref));
        const options = mine.filter(s => !bound.has(s.ref));
        setMySkills(options);
        setSelected(options[0]?.name ?? '');
      } catch { setMySkills([]); }
    }
  }

  async function attach() {
    if (!selected) return;
    setBusy(true);
    try {
      await skillsService.setSkillBinding(selected, binding);
      showToast(t('profile.apps.skillAttached') || 'Skill attached to this app');
      setPickerOpen(false); setMySkills(null);
      await load();
    } catch (err) {
      showToast((t('profile.apps.skillAttachError') || 'Failed to attach skill') + ': ' + err.message, true);
    } finally { setBusy(false); }
  }

  async function detach(skill) {
    setBusy(true);
    try {
      await skillsService.setSkillBinding(skill.name, null);
      showToast(t('profile.apps.skillDetached') || 'Skill detached');
      setMySkills(null);
      await load();
    } catch (err) {
      showToast((t('profile.apps.skillAttachError') || 'Failed to attach skill') + ': ' + err.message, true);
    } finally { setBusy(false); }
  }

  return html`
    <div class="pf-app-skills">
      <span class="text-meta">${t('profile.apps.skillsLabel') || 'Skills'}:</span>
      ${skills === null ? html`<span class="text-meta-sm">…</span>`
        : skills.length === 0 ? html`<span class="text-meta-sm">${t('profile.apps.skillsNone') || 'none — attach a skill that teaches agents this app'}</span>`
        : skills.map(s => html`
            <span key=${s.ref} class="badge badge-info pf-app-skill-chip" title=${s.description}>
              ${escHtml(s.name)}
              ${s.scope === 'user' ? html`<button class="pf-app-skill-x" disabled=${busy} onClick=${() => detach(s)} title=${t('profile.apps.skillDetach') || 'Detach'}>×</button>` : ''}
            </span>
          `)}
      <button class="btn-ghost btn-sm" onClick=${openPicker}>+ ${t('profile.apps.skillAttach') || 'Attach skill'}</button>
      ${pickerOpen ? html`
        <span class="pf-app-skill-picker">
          ${mySkills === null ? html`<span class="text-meta-sm">…</span>` : mySkills.length === 0
            ? html`<span class="text-meta-sm">${t('profile.apps.skillsNoneToAttach') || 'No unbound skills — create one in the Skills tab first'}</span>`
            : html`
              <select value=${selected} onChange=${e => setSelected(e.target.value)}>
                ${mySkills.map(s => html`<option key=${s.name} value=${s.name}>${s.name} — ${s.description.slice(0, 50)}</option>`)}
              </select>
              <button class="btn-primary btn-sm" disabled=${busy || !selected} onClick=${attach}>${t('profile.apps.skillAttachConfirm') || 'Attach'}</button>
            `}
        </span>
      ` : ''}
    </div>
  `;
}

/**
 * Agent-Bundled Apps: the crew-defs this app ships (manifest.cortex.agents), each with
 * Deploy/Undeploy onto the OWNER'S OWN fleet and liveness from the status endpoint
 * (agent registration + the agents.<name>.deploy key the fleet writes). Deploy targets
 * the signed-in owner by construction — the node hard-rejects any other target.
 */
function AppAgents({ owner, filename, agents, showToast }) {
  const [statuses, setStatuses] = useState({});
  const [busy, setBusy] = useState('');

  const loadStatuses = useCallback(async () => {
    const next = {};
    await Promise.all(agents.map(async (def) => {
      try {
        const resp = await appAgentStatus(owner, filename, def.agent_name);
        if (resp?.ok !== false && resp?.data) next[def.agent_name] = resp.data;
      } catch { /* leave unknown */ }
    }));
    setStatuses(next);
  }, [owner, filename, agents]);

  useEffect(() => {
    loadStatuses();
    const handler = () => loadStatuses();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadStatuses]);

  async function act(def, deploy) {
    setBusy(def.agent_name);
    try {
      const resp = deploy
        ? await deployAppAgent(owner, filename, def.agent_name)
        : await undeployAppAgent(owner, filename, def.agent_name);
      if (resp?.ok !== false) {
        const auto = resp?.data?.auto_activated;
        showToast(deploy
          ? (auto ? (t('profile.apps.agentDeployStarted') || 'Deploy task started on your fleet') : (t('profile.apps.agentDeployQueued') || 'Deploy task queued — start it from the Tasks tab'))
          : (t('profile.apps.agentUndeployQueued') || 'Undeploy task sent to your fleet'));
        setTimeout(loadStatuses, 1500);
      } else {
        showToast(resp?.error?.message || (t('profile.apps.agentDeployFailed') || 'Deploy failed'), true);
      }
    } catch (err) {
      showToast((t('profile.apps.agentDeployFailed') || 'Deploy failed') + ': ' + err.message, true);
    } finally { setBusy(''); }
  }

  return html`
    <div class="pf-app-skills">
      <span class="text-meta">${t('profile.apps.agentsLabel') || 'Bundled agents'}:</span>
      ${agents.map(def => {
        const s = statuses[def.agent_name];
        const live = !!s?.live && s?.deploy_state?.status !== 'undeployed';
        return html`
          <span key=${def.agent_name} class="pf-app-skill-chip flex-row">
            <span class="badge ${live ? 'badge-success' : 'badge-dim'}" title=${s?.deployed_agent_name || ''}>
              \u{1F916} ${escHtml(def.agent_name)} ${live ? '● ' + (t('profile.apps.agentLive') || 'live') : '○ ' + (t('profile.apps.agentOffline') || 'not deployed')}
            </span>
            ${live
              ? html`<button class="btn-outline btn-sm" disabled=${busy === def.agent_name} onClick=${() => act(def, false)}>${t('profile.apps.agentUndeploy') || 'Undeploy'}</button>`
              : html`<button class="btn-primary btn-sm" disabled=${busy === def.agent_name} onClick=${() => act(def, true)}>${t('profile.apps.agentDeploy') || 'Deploy to my fleet'}</button>`}
          </span>`;
      })}
      <button class="btn-ghost btn-sm" onClick=${loadStatuses} title=${t('profile.apps.agentRefresh') || 'Refresh status'}>↻</button>
    </div>`;
}

export default function AppsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const [myApps, setMyApps] = useState(null);
  const [allApps, setAllApps] = useState(null);
  const [showAppUpload, setShowAppUpload] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [editCode, setEditCode] = useState('');
  const [editingMeta, setEditingMeta] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Reload the app lists when the session becomes available / changes. loadData closes over the
  // optional onStats prop (not guaranteed memoized), so we key on session only to avoid re-running
  // on every parent render.
  useEffect(() => {
    if (session) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadData() {
    try {
      const list = await listApps();
      const own = list.filter(a => a.owner === session.owner);
      setMyApps(own);
      setAllApps(list);
      onStats?.({ apps: own.length });
    } catch { setMyApps([]); setAllApps([]); }
  }

  async function handleUpload(file, description, screenshot, accessCode) {
    if (!file) { showToast(t('profile.apps.selectFile'), true); return; }
    // A description is required for a NEW app (server enforces it, apps.ts); guard here so the user
    // gets a clear inline prompt instead of a raw 400.
    if (!description || !description.trim()) { showToast(t('profile.apps.descriptionRequired'), true); return; }
    const readFile = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(/** @type {string} */ (r.result).split(',')[1]); r.readAsDataURL(f); });
    const contentBase64 = await readFile(file);
    const opts = { description: description.trim() };
    if (accessCode) opts.accessCode = accessCode;
    if (screenshot) {
      opts.screenshotBase64 = await readFile(screenshot);
      opts.screenshotMimeType = screenshot.type || 'image/png';
    }
    const resp = await uploadApp(file.name, contentBase64, file.type || 'text/html', opts);
    if (resp.ok !== false) { showToast(t('profile.apps.uploaded')); setShowAppUpload(false); loadData(); }
    else showToast(t('profile.apps.uploadFailed'), true);
  }

  async function handleDelete(filename) {
    confirm(t('profile.apps.confirmDelete') || 'Delete this app?', async () => {
      const resp = await deleteApp(filename);
      if (resp.ok !== false) { showToast(t('profile.apps.deleted') || 'App deleted'); loadData(); }
      else showToast(resp?.error?.message || t('profile.apps.deleteFailed') || 'Delete failed', true);
    }, { danger: true });
  }

  function startEdit(app) {
    setEditingApp(app.filename);
    setEditCode(app.access_code || '');
  }

  function cancelEdit() {
    setEditingApp(null);
    setEditCode('');
  }

  function startEditMeta(app) {
    setEditingMeta(app.filename);
    setEditName(app.manifest?.name || String(app.filename || app.name || '').replace(/\.html?$/i, ''));
    setEditDesc(app.manifest?.description || '');
  }

  function cancelEditMeta() {
    setEditingMeta(null);
    setEditName('');
    setEditDesc('');
  }

  async function handleSaveMeta(filename) {
    const name = editName.trim();
    const description = editDesc.trim();
    if (!name) { showToast(t('profile.apps.nameRequired') || 'Name cannot be empty', true); return; }
    if (!description) { showToast(t('profile.apps.descRequired') || 'Description cannot be empty', true); return; }
    const resp = await patchApp(filename, { name, description });
    if (resp.ok !== false) {
      showToast(t('profile.apps.detailsUpdated') || 'App details updated');
      cancelEditMeta();
      loadData();
    } else {
      showToast(resp?.error?.message || t('profile.apps.updateFailed') || 'Update failed', true);
    }
  }

  async function handleTogglePark(app) {
    const next = !app.parked;
    const resp = await patchApp(app.filename || app.name, { parked: next });
    if (resp.ok !== false) {
      showToast(next ? (t('profile.apps.parked') || 'App parked') : (t('profile.apps.unparked') || 'App published'));
      loadData();
    } else {
      showToast(resp?.error?.message || t('profile.apps.updateFailed') || 'Update failed', true);
    }
  }

  async function handleSaveAccessCode(filename) {
    const body = editCode.trim() ? { access_code: editCode.trim() } : { access_code: null };
    const resp = await patchApp(filename, body);
    if (resp.ok !== false) {
      showToast(t('profile.apps.updated') || 'App updated');
      setEditingApp(null);
      setEditCode('');
      loadData();
    } else {
      showToast(resp?.error?.message || t('profile.apps.updateFailed') || 'Update failed', true);
    }
  }

  return html`
    <div class="section-title">${t('profile.apps.title')}</div>
    <div class="section-desc">${t('profile.apps.desc')}</div>

    <!-- App launcher -->
    <div class="card mb-1">
      <h3 class="card-h3">\u{1F680} ${t('profile.apps.launcherTitle')}</h3>
      <p class="text-caption mb-half">${t('profile.apps.launcherDesc')}</p>
      <a href="/app-catalog.html" target="_blank" class="btn-primary pf-no-underline pf-inline-block">${t('profile.apps.launcherOpen')}</a>
    </div>

    <!-- Create guide -->
    <div class="card mb-1">
      <h3 class="card-h3">\u2728 ${t('profile.apps.createGuide')}</h3>
      <p class="text-caption mb-half">${t('profile.apps.createGuideDesc')}</p>
      <a href="/v1/aimeat-os" target="_blank" class="btn-primary pf-no-underline pf-inline-block mb-half">${t('profile.apps.downloadGuide')}</a>
      <p class="text-meta">${t('profile.apps.guideDesc')}</p>
    </div>

    <!-- Upload -->
    <button class="btn-primary mb-1" onClick=${() => setShowAppUpload(!showAppUpload)}>${t('profile.apps.uploadBtn')}</button>
    ${showAppUpload && html`<${AppUploadForm} onUpload=${handleUpload} onCancel=${() => setShowAppUpload(false)} />`}

    <!-- My Apps -->
    <div class="section-title section-title-spaced">${t('profile.apps.mine')}</div>
    ${!myApps ? html`<${Spinner} text=${t('profile.apps.loading')} />`
      : myApps.length === 0 ? html`<div class="empty">${t('profile.apps.empty')}</div>`
      : myApps.map(a => html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(a.manifest?.name || a.filename || a.name)}</div>
            <div class="flex-row">
              ${a.manifest?.version ? html`<span class="badge">${'v' + escHtml(a.manifest.version)}</span>` : ''}
              ${a.version_number > 1 ? html`<span class="badge badge-dim">${'#' + a.version_number}</span>` : ''}
              <span class="badge badge-info">${escHtml(a.mime_type || a.content_type || 'html')}</span>
              ${a.protected ? html`<span class="badge badge-warn">\u{1F512}</span>` : ''}
              ${a.parked ? html`<span class="badge badge-dim">\u{1F17F}️ ${t('profile.apps.parkedBadge') || 'Parked'}</span>` : ''}
              ${a.manifest?.cortex?.agents?.length ? html`<span class="badge badge-info" title=${t('profile.apps.agentBadgeHint') || 'This app ships its own agent — deploy it onto your fleet below'}>\u{1F916} ${t('profile.apps.agentBadge') || 'Ships an agent'}</span>` : ''}
              ${a.operator_hidden ? html`<span class="badge badge-danger">\u{1F6AB} ${t('profile.apps.operatorHiddenBadge') || 'Moderated by operator: hidden'}</span>` : ''}
            </div>
          </div>
          ${a.operator_hidden ? html`<div class="text-meta-sm mb-half">${t('profile.apps.operatorHiddenHint') || 'An operator has hidden this app from public view. Only you can still see it. Contact the operator to appeal.'}${a.operator_hide_reason ? ' — ' + escHtml(a.operator_hide_reason) : ''}</div>` : ''}
          ${a.parked ? html`<div class="text-meta-sm mb-half">${t('profile.apps.parkedHint') || 'Only you can see and use this — hidden from the public catalogue.'}</div>` : ''}
          ${a.manifest?.description ? html`<div class="text-meta mb-half">${escHtml(a.manifest.description)}</div>` : ''}
          <div class="card-subtitle">
            <a href="${NODE_URL}/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}" target="_blank">${t('profile.apps.download')}</a>
            ${a.size ? ' \u2022 ' + Math.round(a.size / 1024) + ' KB' : ''}
            ${a.created_at ? ' \u2022 ' + timeAgo(a.created_at) : ''}
            ${a.downloads ? ' \u2022 ' + a.downloads + ' \u{2B07}' : ''}
          </div>
          <div class="flex-row-wrap mb-half">
            <button class="btn-primary btn-sm" onClick=${() => {
              recordRecent({ type: 'app', id: `${a.owner || session.owner}/${a.filename || a.name}`,
                label: a.manifest?.name || String(a.filename || a.name).replace(/\.html?$/i, ''),
                data: { owner: a.owner || session.owner, filename: a.filename || a.name } });
              window.open(`/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}?mode=inline`, '_blank');
            }}>${t('profile.apps.launch') || 'Launch'}</button>
            <button class="btn-sm" onClick=${() => startEditMeta(a)}>${t('profile.apps.editDetails') || 'Edit Details'}</button>
            <button class="btn-sm" onClick=${() => startEdit(a)}>${t('profile.apps.editAccess') || 'Edit Access Code'}</button>
            <button class=${a.parked ? 'btn-success btn-sm' : 'btn-outline btn-sm'} onClick=${() => handleTogglePark(a)}>${a.parked ? (t('profile.apps.unpark') || 'Unpark') : (t('profile.apps.park') || 'Park')}</button>
            <button class="btn-danger-solid btn-sm" onClick=${() => handleDelete(a.filename || a.name)}>${t('profile.apps.deleteBtn') || 'Delete'}</button>
          </div>
          <${AppSkills} owner=${a.owner || session.owner} filename=${a.filename || a.name} showToast=${showToast} />
          ${a.manifest?.cortex?.agents?.length ? html`<${AppAgents} owner=${a.owner || session.owner} filename=${a.filename || a.name} agents=${a.manifest.cortex.agents} showToast=${showToast} />` : ''}
          ${editingMeta === a.filename ? html`
            <div class="pf-edit-panel">
              <label class="text-meta mb-half">${t('profile.apps.nameLabel') || 'App Name'}</label>
              <input class="input-field pf-flex-fill mb-half" maxLength="120" placeholder=${t('profile.apps.namePlaceholder') || 'Display name'} value=${editName} onInput=${e => setEditName(e.target.value)} />
              <label class="text-meta mb-half">${t('profile.apps.descLabel') || 'Description'}</label>
              <textarea class="input-field pf-flex-fill mb-half" rows="2" maxLength="2000" placeholder=${t('profile.apps.descPlaceholder') || 'What does this app do?'} value=${editDesc} onInput=${e => setEditDesc(e.target.value)}></textarea>
              <div class="text-meta-sm mb-half">${t('profile.apps.renameHint') || 'The app link stays the same — only the displayed name and description change.'}</div>
              <div class="flex-row">
                <button class="btn-primary btn-sm" onClick=${() => handleSaveMeta(a.filename)}>${t('profile.apps.save') || 'Save'}</button>
                <button class="btn-outline btn-sm" onClick=${cancelEditMeta}>${t('profile.cancel') || 'Cancel'}</button>
              </div>
            </div>
          ` : ''}
          ${editingApp === a.filename ? html`
            <div class="pf-edit-panel">
              <label class="text-meta mb-half">${t('profile.apps.accessCodeLabel') || 'Access Code'}</label>
              <div class="flex-row">
                <input class="input-field pf-flex-fill" placeholder=${t('profile.apps.accessCodePlaceholder') || 'Leave empty to remove protection'} value=${editCode} onInput=${e => setEditCode(e.target.value)} />
                <button class="btn-primary btn-sm" onClick=${() => handleSaveAccessCode(a.filename)}>${t('profile.apps.save') || 'Save'}</button>
                <button class="btn-outline btn-sm" onClick=${cancelEdit}>${t('profile.cancel') || 'Cancel'}</button>
              </div>
              ${editCode.trim() === '' ? html`<div class="text-meta-sm mt-xs">${t('profile.apps.removeProtectionHint') || 'Save empty to remove access code protection'}</div>` : ''}
            </div>
          ` : ''}
        </div>
      `)
    }

    <!-- Gallery -->
    <div class="section-title section-title-spaced">${t('profile.apps.gallery')}</div>
    ${!allApps ? html`<${Spinner} text=${t('profile.apps.galleryLoading')} />`
      : allApps.length === 0 ? html`<div class="empty">${t('profile.apps.galleryEmpty')}</div>`
      : html`<div class="app-grid">
          ${allApps.map(a => {
            const ssUrl = a.screenshot_url ? NODE_URL + a.screenshot_url : null;
            return html`
              <div class="app-card">
                <div class="app-screenshot">
                  ${ssUrl ? html`<img src=${ssUrl} alt=${a.filename} onError=${handleImgError} />` : html`<div class="placeholder">\u{1F4F1}</div>`}
                </div>
                <div class="app-info">
                  <div class="app-name">${escHtml(a.manifest?.name || a.filename)}</div>
                  ${a.manifest?.description ? html`<div class="text-meta-sm">${escHtml(a.manifest.description)}</div>` : ''}
                  <div class="app-meta">
                    ${escHtml(a.owner)} \u2022 ${Math.round((a.size || 0) / 1024)} KB
                    ${a.manifest?.version ? ' \u2022 v' + escHtml(a.manifest.version) : ''}
                    ${a.created_at ? ' \u2022 ' + timeAgo(a.created_at) : ''}
                    ${a.protected ? ' \u2022 \u{1F512} ' + t('profile.apps.protected') : ''}
                    ${a.parked ? ' \u2022 \u{1F17F}\ufe0f ' + (t('profile.apps.parkedBadge') || 'Parked') : ''}
                  </div>
                  <div class="mb-half"><a href="${NODE_URL + (a.download_url || '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename))}" class="btn-sm pf-no-underline pf-inline-block">${t('profile.apps.download')}</a></div>
                </div>
              </div>`;
          })}
        </div>`
    }
    <${ConfirmUI} />`;
}

function AppUploadForm({ onUpload, onCancel }) {
  const fileRef = useRef(null);
  const ssRef = useRef(null);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.apps.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" accept=".html,.htm" /></div>
      <div class="form-row"><label>${t('profile.apps.descriptionLabel')}</label><textarea class="input-field" rows="2" placeholder=${t('profile.apps.descriptionPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.apps.screenshotLabel')}</label><input type="file" ref=${ssRef} class="input-field" accept="image/*" /></div>
      <div class="form-row"><label>${t('profile.apps.accessCodeLabel')}</label><input class="input-field" placeholder=${t('profile.apps.accessCodePlaceholder')} value=${code} onInput=${e => setCode(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onUpload(fileRef.current?.files?.[0], desc, ssRef.current?.files?.[0], code)}>${t('profile.apps.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}
