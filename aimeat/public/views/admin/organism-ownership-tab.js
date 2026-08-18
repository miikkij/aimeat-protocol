/**
 * @file organism-ownership-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's break-glass over an organism's ownership, on a screen. Look up an
 *   organism by id, see who holds it and who made it, and add an owner to one whose own owners can
 *   no longer be reached.
 *
 *   Why an operator screen exists for this at all: every gate inside an organism defers to its
 *   owners, so an organism whose owners are unreachable cannot be repaired from the inside, and the
 *   node operator had no override either. The repair used to be a hand-written SQL transaction
 *   against the production database.
 *
 *   It is ADDITIVE. Adding an owner takes nothing from the people already there, so the operator
 *   never has to decide who loses their organism in order to fix it.
 * @structure OrganismOwnershipTab — lookup form, ownership card, add-owner form
 * @usage registered in views/admin.js under the Identity group
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial, beside POST /v1/admin/organisms/:id/ownership.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt, Empty, DataTable } from './shared.js';
import { KeyValueRow } from '/components/KeyValueRow.js';
import { apiGet, apiPost } from '/js/api.js';

export default function OrganismOwnershipTab() {
  const [orgId, setOrgId] = useState('');
  const [state, setState] = useState(null);      // { id, name, owners, created_by, admins, members }
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);          // { text, bad }

  const load = useCallback(async (id) => {
    const target = (id ?? orgId).trim();
    if (!target) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiGet(`/v1/admin/organisms/${encodeURIComponent(target)}/ownership`);
      if (r?.data) { setState(r.data); }
      else { setState(null); setMsg({ text: r?.error?.message || t('admin.orgOwnership.notFound') || 'Organism not found', bad: true }); }
    } catch (e) {
      setState(null);
      setMsg({ text: e?.message || 'Lookup failed', bad: true });
    }
    setBusy(false);
  }, [orgId]);

  const addOwner = useCallback(async () => {
    const name = candidate.trim();
    if (!name || !state) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiPost(`/v1/admin/organisms/${encodeURIComponent(state.id)}/ownership`, { ghii: name });
      if (r?.data) {
        setMsg({ text: (t('admin.orgOwnership.added') || 'Added {name} as an owner').replace('{name}', name), bad: false });
        setCandidate('');
        await load(state.id);
      } else {
        setMsg({ text: r?.error?.message || 'Failed', bad: true });
      }
    } catch (e) {
      setMsg({ text: e?.message || 'Failed', bad: true });
    }
    setBusy(false);
  }, [candidate, state, load]);

  const rows = (state?.members || []).map(m => [
    m.ghii,
    (state.owners || []).includes(m.ghii)
      ? html`<span class="badge badge-success">${t('admin.orgOwnership.owner') || 'owner'}</span>`
      : m.role,
    m.status,
    dt(m.joined_at),
  ]);

  return html`
    <div class="admin-section">
      <p class="section-desc">
        ${t('admin.orgOwnership.desc')
          || 'Put an owner back on an organism whose own owners can no longer be reached. Adding is additive: nobody inside loses anything.'}
      </p>

      <div class="adm-oo-row">
        <input class="input-field" type="text" value=${orgId} placeholder=${t('admin.orgOwnership.idPlaceholder') || 'Organism id'}
          onInput=${(e) => setOrgId(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') load(); }} />
        <button class="btn-outline" disabled=${busy || !orgId.trim()} onClick=${() => load()}>
          ${t('admin.orgOwnership.look') || 'Look up'}
        </button>
      </div>

      ${msg ? html`<p class=${msg.bad ? 'form-error' : 'form-note'}>${msg.text}</p>` : null}

      ${state ? html`
        <div class="adm-oo-card">
          <${KeyValueRow} label=${t('admin.orgOwnership.name') || 'Organism'} value=${state.name} />
          <${KeyValueRow} label=${t('admin.orgOwnership.owners') || 'Owners'} value=${(state.owners || []).join(', ')} />
          <${KeyValueRow} label=${t('admin.orgOwnership.createdBy') || 'Created by'} value=${state.created_by || '—'} />
          <${KeyValueRow} label=${t('admin.orgOwnership.created') || 'Created'} value=${dt(state.created_at)} />
        </div>

        <div class="adm-oo-row">
          <input class="input-field" type="text" value=${candidate}
            placeholder=${t('admin.orgOwnership.addPlaceholder') || 'Owner name to add'}
            onInput=${(e) => setCandidate(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') addOwner(); }} />
          <button class="btn-primary" disabled=${busy || !candidate.trim()} onClick=${addOwner}>
            ${t('admin.orgOwnership.add') || 'Add owner'}
          </button>
        </div>

        ${rows.length
          ? html`<${DataTable} headers=${[
              t('admin.orgOwnership.member') || 'Member',
              t('admin.orgOwnership.role') || 'Role',
              t('admin.orgOwnership.status') || 'Status',
              t('admin.orgOwnership.joined') || 'Joined',
            ]} rows=${rows} />`
          : html`<${Empty} text=${t('admin.orgOwnership.noMembers') || 'This organism has no members.'} />`}
      ` : null}
    </div>`;
}
