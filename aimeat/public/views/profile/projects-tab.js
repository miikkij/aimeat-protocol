/**
 * @file projects-tab.js
 * @description Profile tab for the project brain. Lists project-type organisms, creates one
 *   (applying the project template), and opens a manifest-driven workspace where you add drafts,
 *   publish them (versioned, optionally gated for review), resolve gate approvals, and toggle the
 *   publish-review gate. Reads the generic GET /:id/workspace; writes via the generic memory API
 *   and the publish/approvals endpoints (services/projects.js).
 * @structure
 *   - ProjectsTab — list + create + open
 *   - Workspace — the opened-project view (objects, drafts, approvals, gate, decisions)
 * @usage import ProjectsTab from '/views/profile/projects-tab.js';
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 5 slice 1.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as projects from '/js/services/projects.js';

export default function ProjectsTab({ session, showToast }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState('');
  const [cSummary, setCSummary] = useState('');
  const [busy, setBusy] = useState(false);

  const ownerName = session?.owner || '';

  const loadList = useCallback(async () => {
    try { setList(await projects.listProjects(ownerName)); }
    catch { setList([]); }
  }, [ownerName]);

  useEffect(() => { if (session) loadList(); }, [session, loadList]);

  const liveRef = useRef(loadList);
  liveRef.current = loadList;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!cName.trim()) { showToast(t('projects.nameRequired') || 'Name is required'); return; }
    setBusy(true);
    try {
      const id = await projects.createProject({ name: cName.trim(), summary: cSummary.trim() });
      showToast(t('projects.created') || 'Project created');
      setShowCreate(false); setCName(''); setCSummary('');
      await loadList();
      setOpenId(id);
    } catch (e) {
      showToast((e && e.message) || (t('projects.createError') || 'Failed to create project'));
    } finally { setBusy(false); }
  }, [cName, cSummary, showToast, loadList]);

  if (!list) return html`<${Spinner} text=${t('projects.loading') || 'Loading projects...'} />`;

  if (openId) {
    return html`<${Workspace} orgId=${openId} session=${session} showToast=${showToast} onBack=${() => { setOpenId(null); loadList(); }} />`;
  }

  return html`
    <div class="section-title">${t('projects.title') || 'Projects'}</div>
    <div class="section-desc">${t('projects.desc') || 'A project is a governed workspace — goals, plans, deliverables and decisions in one place, versioned on publish. Create one and your AI can read and write it across tools.'}</div>

    <div class="mb-1">
      ${!showCreate ? html`
        <button class="btn-primary" onClick=${() => setShowCreate(true)}>${t('projects.createNew') || 'New project'}</button>
      ` : html`
        <div class="create-form">
          <h4 class="card-h3 mb-half">${t('projects.createTitle') || 'New project'}</h4>
          <div class="flex-col">
            <input type="text" class="input-field input-sm" placeholder=${t('projects.namePlaceholder') || 'Project name'} value=${cName} onInput=${e => setCName(e.target.value)} />
            <textarea class="input-field input-sm" rows="2" placeholder=${t('projects.summaryPlaceholder') || 'One-line summary'} value=${cSummary} onInput=${e => setCSummary(e.target.value)} />
            <div class="form-actions">
              <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${busy}>${busy ? '...' : (t('projects.create') || 'Create')}</button>
              <button class="btn-ghost btn-sm" onClick=${() => setShowCreate(false)}>${t('projects.cancel') || 'Cancel'}</button>
            </div>
          </div>
        </div>
      `}
    </div>

    ${list.length === 0
      ? html`<div class="empty">${t('projects.empty') || 'No projects yet. Create one to get started.'}</div>`
      : list.map(p => html`
        <div class="card pj-card" key=${p.id}>
          <div class="card-header card-clickable" onClick=${() => setOpenId(p.id)}>
            <div class="card-title">${escHtml(p.name)}</div>
            <span class="badge badge-info">${t('projects.badge') || 'project'}</span>
          </div>
          ${p.description ? html`<div class="card-subtitle">${escHtml(p.description.slice(0, 120))}</div>` : null}
          <div class="card-actions">
            <button class="btn-outline btn-sm" onClick=${() => setOpenId(p.id)}>${t('projects.open') || 'Open'}</button>
          </div>
        </div>
      `)
    }
  `;
}

/** A primary text field per object type (for the minimal add-draft form). */
const PRIMARY_FIELD = { goal: 'title', plan: 'approach', deliverable: 'title', resource: 'label', decision: 'summary' };

function Workspace({ orgId, session, showToast, onBack }) {
  const [ws, setWs] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [gateOn, setGateOn] = useState(false);
  const [adding, setAdding] = useState(null); // object-type name being added
  const [draftId, setDraftId] = useState('');
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, ap, cfg] = await Promise.all([
      projects.getWorkspace(orgId),
      projects.listApprovals(orgId, 'pending').catch(() => []),
      projects.getConfig(orgId).catch(() => ({})),
    ]);
    setWs(w); setApprovals(ap); setGateOn(!!(cfg?.gates?.publish?.enabled));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const types = (ws?.manifest?.objectTypes || []).filter(ot => ot.backing === 'memory');

  const startAdd = (typeName) => { setAdding(typeName); setDraftId(''); setDraftText(''); };

  const saveDraft = useCallback(async (ot) => {
    const id = (draftId.trim() || `${ot.name}-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    const field = PRIMARY_FIELD[ot.name] || 'title';
    const value = { id };
    value[field] = draftText.trim();
    if (ot.name === 'goal') value.status = 'open';
    if (ot.name === 'deliverable') value.status = 'proposed';
    if (ot.name === 'plan') { value.version = 1; value.status = 'proposed'; }
    if (ot.name === 'resource') { value.kind = 'link'; value.origin = 'link'; value.pointer = draftText.trim(); value.visibility = 'private'; }
    setBusy(true);
    try {
      const r = await projects.writeDraft(orgId, ot.namespace, id, value);
      if (r?.ok === false) { showToast(r?.error?.message || 'Draft rejected'); }
      else { showToast(t('projects.draftSaved') || 'Draft saved'); setAdding(null); await load(); }
    } catch (e) { showToast((e && e.message) || 'Failed to save draft'); }
    finally { setBusy(false); }
  }, [draftId, draftText, orgId, showToast, load]);

  const publish = useCallback(async (ot, instanceId) => {
    setBusy(true);
    try {
      const r = await projects.publishDraft(orgId, ot.namespace, instanceId);
      if (r?.data?.gated) showToast(t('projects.publishGated') || 'Sent for review (publish gate is on)');
      else showToast((t('projects.published') || 'Published') + (r?.data?.version ? ` v${r.data.version}` : ''));
      await load();
    } catch (e) { showToast((e && e.message) || 'Failed to publish'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const resolve = useCallback(async (aid, decision) => {
    setBusy(true);
    try { await projects.resolveApproval(orgId, aid, decision); showToast(decision === 'approve' ? (t('projects.approved') || 'Approved') : (t('projects.rejected') || 'Rejected')); await load(); }
    catch (e) { showToast((e && e.message) || 'Failed to resolve'); }
    finally { setBusy(false); }
  }, [orgId, showToast, load]);

  const toggleGate = useCallback(async () => {
    setBusy(true);
    try { await projects.setPublishGate(orgId, !gateOn); setGateOn(!gateOn); showToast(t('projects.gateToggled') || 'Publish gate updated'); }
    catch (e) { showToast((e && e.message) || 'Failed to update gate'); }
    finally { setBusy(false); }
  }, [orgId, gateOn, showToast]);

  if (!ws) return html`<${Spinner} text=${t('projects.loading') || 'Loading...'} />`;

  const draftsFor = (name) => (ws.drafts && ws.drafts[name]) || [];
  const objectsFor = (name) => (ws.objects && ws.objects[name]) || [];

  return html`
    <div class="pj-ws">
      <div class="card-actions mb-half">
        <button class="btn-ghost btn-sm" onClick=${onBack}>${'← '}${t('projects.back') || 'All projects'}</button>
      </div>
      <div class="section-title">${escHtml(ws.manifest?.name || 'Project')}</div>
      <div class="section-desc">
        <span class="badge badge-success">${escHtml(ws.manifest?.status || 'active')}</span>
        ${ws.manifest?.summary ? html` ${escHtml(ws.manifest.summary)}` : null}
      </div>

      <div class="pj-gate">
        <label class="pj-gate-label">
          <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
          ${' '}${t('projects.publishGate') || 'Require review before publishing'}
        </label>
      </div>

      ${approvals.length > 0 && html`
        <div class="pj-inbox">
          <div class="card-h3">${t('projects.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
          ${approvals.map(a => html`
            <div class="pj-approval" key=${a.id}>
              <div class="pj-approval-text">${escHtml(a.prompt || a.action)}</div>
              <div class="card-actions">
                <button class="btn-success btn-sm" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('projects.approve') || 'Approve'}</button>
                <button class="btn-danger btn-sm" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('projects.reject') || 'Reject'}</button>
              </div>
            </div>
          `)}
        </div>
      `}

      ${types.map(ot => html`
        <div class="pj-section" key=${ot.name}>
          <div class="pj-section-head">
            <span class="pj-section-title">${escHtml(ot.name)}${ot.versioned === false ? '' : ''}</span>
            ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot.name)}>${'+ '}${t('projects.addDraft') || 'Add draft'}</button>`}
          </div>

          ${adding === ot.name && html`
            <div class="create-form pj-draft-form">
              <div class="flex-col">
                <input type="text" class="input-field input-sm" placeholder=${t('projects.idOptional') || 'id (optional)'} value=${draftId} onInput=${e => setDraftId(e.target.value)} />
                <input type="text" class="input-field input-sm" placeholder=${(PRIMARY_FIELD[ot.name] || 'title')} value=${draftText} onInput=${e => setDraftText(e.target.value)} />
                <div class="form-actions">
                  <button class="btn-primary btn-sm" onClick=${() => saveDraft(ot)} disabled=${busy || !draftText.trim()}>${t('projects.saveDraft') || 'Save draft'}</button>
                  <button class="btn-ghost btn-sm" onClick=${() => setAdding(null)}>${t('projects.cancel') || 'Cancel'}</button>
                </div>
              </div>
            </div>
          `}

          ${draftsFor(ot.name).length > 0 && html`
            <div class="pj-drafts">
              ${draftsFor(ot.name).map((d, i) => html`
                <div class="pj-item pj-item-draft" key=${'d' + i}>
                  <span class="badge badge-warn">${t('projects.draft') || 'draft'}</span>
                  <span class="pj-item-text">${escHtml(String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || ''))}</span>
                  <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('projects.publish') || 'Publish'}</button>
                </div>
              `)}
            </div>
          `}

          ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
            ? html`<div class="pj-empty">${t('projects.noneYet') || 'none yet'}</div>`
            : objectsFor(ot.name).map((o, i) => html`
              <div class="pj-item" key=${'o' + i}>
                <span class="pj-item-text">${escHtml(String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || ''))}</span>
                ${o.status ? html`<span class="badge badge-info">${escHtml(o.status)}</span>` : null}
              </div>
            `)
          }
        </div>
      `)}

      ${(ws.decisions || []).length > 0 && html`
        <div class="pj-section">
          <div class="pj-section-title">${t('projects.decisions') || 'Recent decisions'}</div>
          ${ws.decisions.slice(-8).reverse().map((d, i) => html`
            <div class="pj-item pj-decision" key=${'dec' + i}>
              <span class="pj-item-text">${escHtml(String(d.summary || ''))}</span>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}
