/**
 * @file secretary/use-specialists.js
 * @description Secretary-side specialist management (Phase 3 surface). List the owner's specialists,
 *   create one from a role template (+ a brain purpose), run its queued tasks now, or remove it. A
 *   specialist is a stripped-down Secretary (node-run, own brain) that publishes a workflow-compatible
 *   offer on creation — so creating one here gives the workflow designer a new building block.
 * @structure useSpecialists({ showToast }) -> { list, form, openForm, closeForm, setField, create, busy, remove, runNow }
 *   · specialistsCard(p) -> section
 * @usage const spec = useSpecialists({ showToast }); specialistsCard({ ...spec })
 * @version-history
 *   v0.1.0 — 2026-06-28 — Phase 3: specialist create/list/run/delete card driven by /v1/specialists.
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
/** Role templates a specialist can be created from (each selects a scope profile server-side). */
export const SPECIALIST_ROLES = ['specialist', 'sdr', 'prep', 'finance', 'recruiter'];

export function useSpecialists({ showToast }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);   // null = closed; { name, role, purpose }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiGet('/v1/specialists').catch(() => null);
    setList((r && r.data && r.data.specialists) || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const openForm = useCallback(() => setForm({ name: '', role: 'specialist', purpose: '' }), []);
  const closeForm = useCallback(() => setForm(null), []);
  const setField = useCallback((k, v) => setForm((f) => (f ? { ...f, [k]: v } : f)), []);

  const create = useCallback(async () => {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      const body = { name: form.name.trim(), role: form.role || 'specialist' };
      if ((form.purpose || '').trim()) body.brain = { purpose: form.purpose.trim() };
      await apiPost('/v1/specialists', body);
      showToast(t('secretary.spec.created'));
      setForm(null);
      await load();
    } catch (e) {
      showToast(`${t('secretary.spec.error')}: ${e.message}`, true);
    } finally {
      setBusy(false);
    }
  }, [form, load, showToast]);

  const remove = useCallback(async (name) => {
    await apiDelete(`/v1/specialists/${encodeURIComponent(name)}`).catch(() => {});
    await load();
  }, [load]);

  const runNow = useCallback(async (name) => {
    try {
      const r = await apiPost(`/v1/specialists/${encodeURIComponent(name)}/run`, {});
      showToast(t('secretary.spec.ran', { n: (r && r.data && r.data.ran) || 0 }));
      await load();
    } catch (e) {
      showToast(`${t('secretary.spec.error')}: ${e.message}`, true);
    }
  }, [load, showToast]);

  return { list, form, openForm, closeForm, setField, create, busy, remove, runNow };
}

/** Specialists card: list + create-from-role-template + run-now / remove. */
export function specialistsCard(p) {
  return html`
    <section class="sec-card sec-specialists">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.spec.title')}</h2>
        <button class="btn-outline btn-sm" onClick=${p.form ? p.closeForm : p.openForm}>${p.form ? t('secretary.spec.cancel') : t('secretary.spec.add')}</button>
      </div>
      ${p.list.length === 0 && !p.form ? html`<p class="sec-hint">${t('secretary.spec.empty')}</p>` : null}
      ${p.list.length ? html`<ul class="sec-goal-list">
        ${p.list.map((s) => html`<li class="sec-goal-row" key=${s.name}>
          <div class="sec-goal-main"><span class="sec-goal-title">${s.display_name || s.name}</span> <span class="sec-hint">· ${s.role}</span></div>
          <button class="sec-linkbtn" onClick=${() => p.runNow(s.name)}>${t('secretary.spec.run')}</button>
          <button class="sec-linkbtn sec-next-discard" onClick=${() => p.remove(s.name)}>${t('secretary.spec.remove')}</button>
        </li>`)}
      </ul>` : null}
      ${p.form ? html`<div class="sec-form">
        <input class="sec-input" placeholder=${t('secretary.spec.namePh')} value=${p.form.name} onInput=${(e) => p.setField('name', e.target.value)} />
        <select class="sec-input" value=${p.form.role} onChange=${(e) => p.setField('role', e.target.value)}>
          ${SPECIALIST_ROLES.map((r) => html`<option value=${r} selected=${p.form.role === r}>${r}</option>`)}
        </select>
        <textarea class="sec-paste" placeholder=${t('secretary.spec.purposePh')} value=${p.form.purpose} onInput=${(e) => p.setField('purpose', e.target.value)}></textarea>
        <button class="btn-primary btn-sm" disabled=${p.busy || !p.form.name.trim()} onClick=${p.create}>${p.busy ? t('secretary.saving') : t('secretary.spec.create')}</button>
      </div>` : null}
    </section>`;
}
