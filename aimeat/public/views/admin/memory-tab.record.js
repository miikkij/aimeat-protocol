/**
 * @file public/views/admin/memory-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two views of the admin Memory page that are not the finder: one record shown
 *   whole, and the reach view that sorts every record by how far it can be read.
 *
 *   WHY A RECORD IS SHOWN WHOLE. These are other people's records, and an operator looking at one is
 *   answering a question about somebody's own knowledge. A page that shows nine of the twenty fields
 *   decides for them which nine mattered — and the eleven the old listing dropped were the ones that
 *   say who can reach the record and where its value came from. So every field is here, and an empty
 *   one says it is empty rather than being left out.
 *
 * @structure
 *   - Record({ rec, onBack, onDelete, onRestore, busy }): the value, every field, the two writes
 *   - Reach({ counts, rows, onPick, onOpen }): the six audiences, widest first
 *   - Field / readWord / openJson: the pieces both views share
 * @usage Imported by memory-tab.js; not mounted on its own.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page rebuilt around the question.
 */
import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from './shared.js';

const S = (key, params) => t('admin.mem.' + key, params);

/** Every audience a record can have, widest reach FIRST — the order a mistake costs most in. */
export const REACH = ['public', 'members', 'workspace', 'group', 'owner', 'private'];

/** Bytes as a person reads them. */
export function size(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' kB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * A value opened for reading.
 *
 * A great many records store a STRING whose contents are JSON — the Design Book parts among them —
 * and JSON.stringify on a string pretty-prints nothing, so the old panel showed one escaped line
 * running off the side. Parse first, then print.
 */
export function openJson(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return v; }   // a plain string is already readable
  }
  try { return JSON.stringify(v, null, 2); } catch { return String(value); }
}

/** One field of the record. `empty` is what an absent value says, and it is never blank. */
function Field({ name, value, empty, note }) {
  const bare = value === null || value === undefined || value === '';
  return html`
    <div class="adm-mem-f">
      <dt>${name}</dt>
      <dd>
        ${bare
          ? html`<i class="adm-mem-f-none">${empty || S('notSet')}</i>`
          : value}
        ${note && html`<em>${note}</em>`}
      </dd>
    </div>`;
}

/** ONE RECORD, whole. */
export function Record({ rec, onBack, onDelete, onRestore, busy, graceDays }) {
  const pretty = useMemo(() => openJson(rec.value), [rec.value]);
  const origins = rec.allowed_origins && rec.allowed_origins.length ? rec.allowed_origins.join(' · ') : null;

  return html`
    <div class="adm-mem-page">
      <div class="adm-mem-crumb">
        <button type="button" onClick=${onBack}>${S('crumbAll')}</button>
        <span>&#8201;/&#8201; ${rec.owner_gaii}</span>
      </div>

      <div class="adm-mem-rhead">
        <div class="adm-mem-lbl">${S('recordEyebrow')}</div>
        <div class="adm-mem-rkey">${rec.key}</div>
        <p class="adm-mem-rlead">${S('recordLead')}</p>
      </div>

      <div class="adm-mem-two">
        <div>
          <div class="adm-mem-vhead">
            <span>${S('valueLabel')}</span>
            <span>${size(rec.byte_size)}${typeof rec.value === 'string' ? ' · ' + S('valueIsString') : ''}</span>
          </div>
          <pre class="adm-mem-value">${pretty}</pre>

          ${rec.history?.length > 0 && html`
            <div class="adm-mem-vhead adm-mem-vhead--hist">
              <span>${S('historyLabel')}</span>
              <span>${S('historyCount', { n: rec.history.length })}</span>
            </div>
            <div class="adm-mem-hist">
              ${rec.history.map(v => html`
                <div class="adm-mem-hrow" key=${v.version}>
                  <b>v${v.version}</b>
                  <span>${dt(v.recorded_at)}</span>
                  <span>${v.actor || S('noActor')}</span>
                  <span class="r">${size(v.byte_size)}</span>
                </div>`)}
            </div>`}
        </div>

        <div>
          <div class="adm-mem-vhead"><span>${S('everyField')}</span></div>
          <dl class="adm-mem-fields">
            <${Field} name="ownerGaii" value=${rec.owner_gaii} />
            <${Field} name="visibility" value=${rec.visibility} note=${S('vis_' + rec.visibility)} />
            <${Field} name="groupId" value=${rec.group_id} />
            <${Field} name="workspaceRef" value=${rec.workspace_ref} />
            <${Field} name="allowedOrigins" value=${origins} note=${origins ? null : S('noOriginLimit')} />
            <${Field} name="tags" value=${rec.tags?.length ? rec.tags.join(' · ') : null} empty=${S('noTags')} />
            <${Field} name="version" value=${String(rec.version)} />
            <${Field} name="trackable" value=${String(!!rec.trackable)} note=${rec.trackable ? S('trackableYes') : S('trackableNo')} />
            <${Field} name="byteSize" value=${size(rec.byte_size)} />
            <${Field} name="ttlHours" value=${rec.ttl_hours} note=${rec.ttl_hours ? null : S('neverExpires')} />
            <${Field} name="flagCount" value=${String(rec.flag_count ?? 0)} />
            <${Field} name="aiProvenanceId" value=${rec.ai_provenance_id} empty=${S('notStated')} />
            <${Field} name="archived" value=${String(!!rec.archived)} />
            <${Field} name="archivedAt" value=${rec.archived_at} empty="—" />
            <${Field} name="archivedBy" value=${rec.archived_by} empty="—" />
            <${Field} name="archivedRoot" value=${rec.archived_root} empty="—" />
            <${Field} name="createdAt" value=${rec.created_at} />
            <${Field} name="updatedAt" value=${rec.updated_at} />
          </dl>

          ${!rec.ai_provenance_id && html`
            <div class="adm-mem-say">
              <p><b>${S('provenanceHeading')}</b> ${S('provenanceBody')}</p>
            </div>`}

          <div class="adm-mem-acts">
            <button type="button" class="adm-btn" disabled=${busy} onClick=${onDelete}>${S('deleteBtn')}</button>
          </div>
          <p class="adm-mem-actnote">${S('deleteNote', { days: graceDays ?? 7 })}</p>
          ${onRestore && html`
            <div class="adm-mem-acts">
              <button type="button" class="adm-mem-door" disabled=${busy} onClick=${onRestore}>${S('restoreBtn')}</button>
            </div>`}
        </div>
      </div>
    </div>`;
}

/** WHO CAN READ WHAT — every record sorted by how far it reaches, widest first. */
export function Reach({ counts, total, originCount, onPick, onBack }) {
  return html`
    <div class="adm-mem-page">
      <div class="adm-mem-crumb">
        <button type="button" onClick=${onBack}>${S('crumbAll')}</button>
        <span>&#8201;/&#8201; ${S('reachCrumb')}</span>
      </div>

      <div class="adm-mem-rhead">
        <div class="adm-mem-lbl">${S('reachEyebrow')}</div>
        <h2 class="adm-mem-rtitle">${S('reachTitle')}</h2>
        <p class="adm-mem-rlead">${S('reachLead')}</p>
      </div>

      <div class="adm-mem-ladder">
        ${REACH.map(v => {
          const n = counts?.[v] ?? 0;
          return html`
            <div class=${'adm-mem-rung' + (n > 0 ? '' : ' is-none')} key=${v}>
              <div class="adm-mem-rung-n">${v}</div>
              <div class="adm-mem-rung-c">${n}</div>
              <div>
                <div class="adm-mem-rung-w">${S('vis_' + v)}</div>
                <div class="adm-mem-rung-note">${S('visNote_' + v)}</div>
              </div>
              <div class="r">
                ${n > 0
                  ? html`<button type="button" class="adm-mem-door" onClick=${() => onPick(v)}>${S('listThem')}</button>`
                  : html`<span class="adm-mem-door is-quiet">${S('none')}</span>`}
              </div>
            </div>`;
        })}
      </div>

      <div class="adm-mem-origins">
        <div class="adm-mem-vhead"><span>${S('originsLabel')}</span></div>
        <div class="adm-mem-origins-n"><b>${originCount ?? 0}</b> <span>${S('ofTotal', { n: total ?? 0 })}</span></div>
        <p class="adm-mem-rlead">${S('originsBody')}</p>
      </div>
    </div>`;
}
