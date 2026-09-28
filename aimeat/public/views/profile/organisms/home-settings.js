/**
 * @file public/views/profile/organisms/home-settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's settings as a page of its own (design canvas "AIMEAT Organismin sivu",
 *   direction A): its own breadcrumb, the metadata as the title's small print, then four sections
 *   with shared B1 headlines. Name and description (name, description, interests, the type as preset chips
 *   plus a free word), who gets in (join policy), who sees (organism visibility, member list), and
 *   archive and delete as one section where the reversible act sits in a dashed box and the
 *   irreversible one in a solid box. A member who did not create the organism gets the leave row.
 *
 *   Moved out of home.js, where the same form replaced the tab content while the tabs stayed lit
 *   and the danger zone was two red boxes; the logic (dirty check, delete stats, archive, delete)
 *   is the same, the shape is the poster face.
 * @structure OrganismSettings
 * @usage
 *   import { OrganismSettings } from '/views/profile/organisms/home-settings.js';
 *   <OrganismSettings org ghii isCreator isMember canEdit showToast confirm onBack onChanged onLeave onDeleted />
 * @version-history
 *   2026-09-28 — "Who gets in" has the Agents choice: every member's agents, or only the agents in the Agents
 *     section (agent_access). Sent only when changed.
 *   v1.9.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the page is the SettingsPage (crumb, title with its small print, the rail as data with the first section marked and the way back), the sections the Section (the member's Leave box a plain one), the fields the TextField, TextArea, TagInput and Choice with their labels and hints, the danger boxes the SettingBox with SettingRow and SettingConfirm, the board id's copy the Action's link tone. The local Choice goes (the kit's Choice draws the same tabs). The page writes no class.
 *   v1.8.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- Compose section headlines with poster-section-title.
 *   v1.0.1 — 2026-08-29 — The rail scrolls the content region only (poster-parts scrollTo), never the window.
 *   v1.0.0 — 2026-08-29 — Extracted from home.js and redrawn on the canvas; the type is a preset or any
 *     word of the owner's own.
 */
import { h } from 'preact';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { TagInput } from '/components/TagInput.js';
import { Choice } from '/components/Choice.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox, SettingRow, SettingConfirm } from '/components/Box.js';
import * as orgService from '/js/services/organisms.js';
import { copyToClipboard } from '/js/utils.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { swallowed } from '/js/swallowed.js';

const TYPE_PRESETS = ['community', 'team', 'club', 'cooperative', 'project'];
const JOIN = ['open', 'approval_required', 'invite_only'];
const VIS = ['public', 'listed', 'private'];
const MEMBER_VIS = ['authenticated', 'members', 'admins', 'public'];
const AGENT_ACCESS = ['all', 'listed'];

export function OrganismSettings({ org, isCreator, isMember, canEdit, showToast, confirm, onBack, onChanged, onLeave, onDeleted }) {
  const baseline = useMemo(() => ({
    name: org.name || '', description: org.description || '', type: org.type || 'community',
    join_policy: org.joinPolicy || 'open', visibility: org.visibility || 'public',
    member_visibility: org.memberVisibility || 'authenticated',
    agent_access: org.agentAccess === 'listed' ? 'listed' : 'all',
    interests: [...(org.interests || [])],
  }), [org]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  // The type is a preset or a word of the owner's own; "other" opens the field with the custom word.
  const [customType, setCustomType] = useState(!TYPE_PRESETS.includes(baseline.type));

  // Fresher org data replaces the form only while the person has not touched it, so a live update
  // never clobbers typing.
  const prevBaselineRef = useRef(baseline);
  useEffect(() => {
    const prev = prevBaselineRef.current;
    const untouched = form.name === prev.name && form.description === prev.description
      && form.type === prev.type && form.join_policy === prev.join_policy
      && form.visibility === prev.visibility && form.member_visibility === prev.member_visibility
      && form.agent_access === prev.agent_access
      && form.interests.join(' ') === prev.interests.join(' ');
    if (untouched) { setForm(baseline); setCustomType(!TYPE_PRESETS.includes(baseline.type)); }
    prevBaselineRef.current = baseline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);
  const dirty = form.name !== baseline.name || form.description !== baseline.description
    || form.type !== baseline.type || form.join_policy !== baseline.join_policy
    || form.visibility !== baseline.visibility
    || form.member_visibility !== baseline.member_visibility
    || form.agent_access !== baseline.agent_access
    || form.interests.join(' ') !== baseline.interests.join(' ');

  const saveEdit = async () => {
    if (!form.name.trim()) { showToast(t('organisms.nameRequired') || 'Name is required'); return; }
    if (!form.type.trim()) { showToast(t('organisms.typeCustomPlaceholder') || 'Give the type a word'); return; }
    setSaving(true);
    try {
      const result = await orgService.updateOrganism(org.id, {
        name: form.name.trim(), description: form.description.trim(),
        type: form.type.trim(), join_policy: form.join_policy, visibility: form.visibility,
        member_visibility: form.member_visibility, interests: form.interests,
        // Sent only when changed: an unchanged setting is no request to change it.
        ...(form.agent_access !== baseline.agent_access ? { agent_access: form.agent_access } : {}),
      });
      if (result?.ok !== false) { showToast(t('organisms.updated') || 'Organism updated'); onChanged?.(); }
      else showToast(result?.error?.message || (t('organisms.updateError') || 'Failed to update'));
    } catch (err) { swallowed('home-settings', err); showToast(t('organisms.updateError') || 'Failed to update'); }
    finally { setSaving(false); }
  };
  // Leaving a dirty form asks before dropping the changes.
  const leave = () => {
    if (dirty) confirm(t('organisms.discardChanges') || 'Discard unsaved changes?', () => { setForm(baseline); onBack(); }, { danger: true });
    else onBack();
  };

  const boardIdShort = org.boardId && org.boardId.length > 20
    ? `${org.boardId.slice(0, 12)}…${org.boardId.slice(-6)}` : (org.boardId || '');
  const copyBoardId = async () => {
    const ok = await copyToClipboard(org.boardId);
    showToast(ok ? (t('common.copied') || 'Copied') : (t('organisms.copyFailed') || 'Could not copy'));
  };

  // What a delete actually removes, counted from the accessible workspaces.
  const [delStats, setDelStats] = useState(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  useEffect(() => {
    if (!isCreator) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const wss = (await orgService.discoverWorkspaces(org.id)).filter(w => w.access !== 'none');
        let recs = 0, docs = 0;
        await Promise.all(wss.map(async (w) => {
          const wsData = await orgService.getWorkspace(org.id, w.id).catch(err => { swallowed('home-settings: wss', err); return null; });
          for (const ot of (wsData?.manifest?.objectTypes || []).filter(orgService.isMemorySpace)) {
            const n = new Set([...(wsData.drafts?.[ot.name] || []), ...(wsData.objects?.[ot.name] || [])].map(d => d.id)).size;
            if (orgService.isDocSpace(ot)) docs += n; else recs += n;
          }
        }));
        if (!cancelled) setDelStats({ ws: wss.length, recs, docs });
      } catch (err) { swallowed('home-settings: wss', err); }
    })();
    return () => { cancelled = true; };
  }, [org.id, isCreator]);
  const delStatsText = delStats
    ? (t('organisms.deleteOrganismStats') || 'Deletes {w} workspaces, {r} records and {d} documents. This cannot be undone.')
        .replace('{w}', String(delStats.ws)).replace('{r}', String(delStats.recs)).replace('{d}', String(delStats.docs))
    : (t('organisms.deleteWarnGeneric') || 'Deletes the organism with all its workspaces and content. This cannot be undone.');
  const doDelete = () => {
    confirm(`${(t('organisms.confirmDeleteName') || 'Delete “{name}”?').replace('{name}', org.name || org.id)} ${delStatsText}`, async () => {
      try {
        await orgService.deleteOrganism(org.id);
        showToast(t('organisms.deleted') || 'Organism deleted');
        onDeleted();
      } catch (err) { swallowed('home-settings', err); showToast(t('organisms.deleteError') || 'Failed to delete'); }
    }, { danger: true, title: t('organisms.deleteOrganismTitle') || 'Delete this organism' });
  };
  // Archive / unarchive the whole organism: read-only and hidden from AI materials, cascades to
  // its workspaces, fully reversible. Unlike delete, nothing is destroyed.
  const doArchive = (archived) => {
    confirm(
      (archived
        ? (t('organisms.confirmArchive') || 'Archive “{name}”? It becomes read-only and is hidden from AI operations until you unarchive it. Its workspaces are archived too.')
        : (t('organisms.confirmUnarchive') || 'Unarchive “{name}”? It and the workspaces archived with it become active again.')
      ).replace('{name}', org.name || org.id),
      async () => {
        try {
          if (archived) await orgService.archiveContent(org.id, { level: 'organism' });
          else await orgService.unarchiveContent(org.id, { level: 'organism' });
          showToast(archived ? (t('organisms.organismArchived') || 'Organism archived') : (t('organisms.organismUnarchived') || 'Organism restored'));
          onChanged?.();
        } catch (e) { showToast((e && e.message) || 'Failed'); }
      },
      { title: archived ? (t('organisms.archive') || 'Archive') : (t('organisms.unarchive') || 'Unarchive') },
    );
  };

  const extraAdmins = (org.admins || []).filter(a => a !== org.creatorGhii);
  const visHint = t(`organisms.visHint.${form.visibility}`);
  const policyHint = t(`organisms.policyHint.${form.join_policy}`);
  const typeOptions = [
    ...TYPE_PRESETS.map(id => ({ value: id, label: t(`organisms.types.${id}`) || id })),
    { value: '__custom', label: t('organisms.typeCustom') || 'Other' },
  ];
  const pickType = (id) => {
    if (id === '__custom') { setCustomType(true); setForm(f => ({ ...f, type: TYPE_PRESETS.includes(f.type) ? '' : f.type })); }
    else { setCustomType(false); setForm(f => ({ ...f, type: id })); }
  };
  const label = (k, fb) => t(`organisms.${k}`) || fb;

  const settingsWord = t('organisms.settings') || 'Settings';
  // The rail: the four sections (links that scroll, the first one marked), then the way back.
  const sectionLinks = [
    ['og-set-name', '01', label('setNameDesc', 'Name and description')],
    ['og-set-access', '02', label('setAccess', 'Who gets in')],
    ['og-set-vis', '03', label('setVisibility', 'Who sees')],
    ['og-set-danger', '04', label('setDanger', 'Archive and delete')],
  ].map(([id, num, words], i) => ({ section: id, href: '#' + id, mark: num, label: words, on: i === 0, key: id }));
  const back = { back: true, label: label('backToOrganism', 'Back to the organism'), onClick: leave, key: 'back' };
  const rail = {
    title: settingsWord,
    groups: canEdit
      ? [{ label: settingsWord, items: sectionLinks }, { items: [back] }]
      : [{ label: settingsWord, items: [back] }],
  };
  // The small line under the title: when it was made, by whom, its admins, and its board's id (a copy).
  const sub = html`
    ${org.createdAt ? html`<span>${t('organisms.createdAt') || 'Created'} ${fmtDate(org.createdAt)}</span>` : null}
    <span>${t('organisms.creator') || 'Creator'} ${org.creatorGhii || '-'}</span>
    ${extraAdmins.length > 0 ? html`<span>${t('organisms.admins') || 'Admins'} ${extraAdmins.join(', ')}</span>` : null}
    ${org.boardId ? html`<${Action} tone="link" title=${t('organisms.copyId') || 'Copy ID'} onClick=${copyBoardId}>${t('organisms.board') || 'Board'} ${boardIdShort}<//>` : null}`;

  return html`
    <${SettingsPage} name="settings" rail=${rail} title=${settingsWord} sub=${sub}
      crumb=${[
        { label: t('organisms.title') || 'Organisms', onClick: () => { leave(); } },
        { label: org.name || org.id, onClick: leave },
        settingsWord,
      ]}>
      ${canEdit ? html`
        <${Section} first id="og-set-name" num="01" title=${label('setNameDesc', 'Name and description')}>
          <${Fields}>
            <${TextField} label=${label('fieldName', 'Name')} value=${form.name} onInput=${(v) => setForm(f => ({ ...f, name: v }))} />
            <${TextArea} label=${label('fieldDescription', 'Description')} rows=${3} value=${form.description} onInput=${(v) => setForm(f => ({ ...f, description: v }))} />
            <${TagInput} label=${label('fieldInterests', 'Interests')} tags=${form.interests} onChange=${(tags) => setForm(f => ({ ...f, interests: tags }))} placeholder=${t('organisms.addTag') || 'Add…'} />
            <${Field} label=${label('fieldType', 'Type')} group>
              <${Choice} ariaLabel=${label('fieldType', 'Type')} options=${typeOptions} value=${customType ? '__custom' : form.type} onChange=${pickType} />
              ${customType ? html`<${TextField} maxLength=${40} value=${form.type} placeholder=${t('organisms.typeCustomPlaceholder') || 'Your own word'}
                ariaLabel=${label('fieldType', 'Type')} onInput=${(v) => setForm(f => ({ ...f, type: v }))} />` : null}
            <//>
          <//>
        <//>

        <${Section} id="og-set-access" num="02" title=${label('setAccess', 'Who gets in')}>
          <${Fields}>
          <${Choice} label=${label('setJoin', 'Joining')} value=${form.join_policy} onChange=${(id) => setForm(f => ({ ...f, join_policy: id }))}
            hint=${policyHint && !policyHint.startsWith('organisms.') ? policyHint : undefined}
            options=${JOIN.map(id => ({ value: id, label: t(`organisms.policyShort.${id}`) || id }))} />
          <${Choice} label=${label('setAgentAccess', 'Agents')} value=${form.agent_access} onChange=${(id) => setForm(f => ({ ...f, agent_access: id }))}
            hint=${t('organisms.agentAccessHint') || "A member's agents can read and write here with the member's rights. When you bring in people from outside, choose the second option: then only the agents you add in the Agents section can act here, and the member list shows only them."}
            options=${AGENT_ACCESS.map(id => ({ value: id, label: t(`organisms.agentAccess.${id}`) || id }))} />
          <//>
        <//>

        <${Section} id="og-set-vis" num="03" title=${label('setVisibility', 'Who sees')}>
          <${Fields} cols=${2}>
            <${Choice} label=${label('setOrganismVis', 'Organism')} value=${form.visibility} onChange=${(id) => setForm(f => ({ ...f, visibility: id }))}
              hint=${visHint && !visHint.startsWith('organisms.') ? visHint : undefined}
              options=${VIS.map(id => ({ value: id, label: t(`organisms.vis${id[0].toUpperCase()}${id.slice(1)}`) || id }))} />
            <${Choice} label=${label('memberVisLabel', 'Member list')} value=${form.member_visibility} onChange=${(id) => setForm(f => ({ ...f, member_visibility: id }))}
              hint=${t('organisms.memberVisHint') || 'Who can see who belongs here. Hides the member list only; content authorship stays visible.'}
              options=${MEMBER_VIS.map(id => ({ value: id, label: t(`organisms.memberVis.${id}`) || id }))} />
          <//>
        <//>

        <${FormActions}>
          <${Loud} control onClick=${saveEdit} disabled=${saving || !dirty || !form.name.trim()}>
            ${saving ? '...' : (t('organisms.saveChanges') || 'Save changes')}<//>
          <${Action} small soft onClick=${leave}>${t('organisms.cancel') || 'Cancel'}<//>
          <${Note} inline>${label('savesNote', 'Changes apply at once.')}<//>
        <//>

        <${Section} id="og-set-danger" num="04" title=${label('setDanger', 'Archive and delete')}>
          <${SettingBox} label=${label('reversible', 'Reversible')}>
            <${SettingRow}>
              <span><b>${org.archived ? (t('organisms.unarchiveOrganismTitle') || 'Unarchive this organism') : (t('organisms.archiveOrganismTitle') || 'Archive this organism')}.</b> ${org.archived
                ? (t('organisms.unarchiveOrganismSub') || 'Make it active again. Workspaces archived together with it are restored.')
                : (t('organisms.archiveOrganismSub') || 'Make it read-only and hide it (and its workspaces) from AI operations. Nothing is deleted.')}</span>
              <${Action} small onClick=${() => doArchive(!org.archived)}>${org.archived ? (t('organisms.unarchive') || 'Unarchive') : (t('organisms.archive') || 'Archive')}<//>
            <//>
          <//>
          ${isCreator ? html`
            <${SettingBox} irreversible label=${label('irreversible', 'Cannot be undone')}>
              <${SettingRow}>
                <span><b>${t('organisms.deleteOrganismTitle') || 'Delete this organism'}.</b> ${delStatsText}</span>
                <${Action} small tone="danger" expanded=${delOpen} onClick=${() => { setDelOpen(o => !o); setDelName(''); }}>${t('organisms.deleteDots') || 'Delete…'}<//>
              <//>
              ${delOpen ? html`
                <${SettingConfirm}>
                  <${TextField} label=${(t('organisms.confirmTypeName') || 'Type the organism’s name to confirm') + ': ' + (org.name || '')}
                    value=${delName} onInput=${setDelName} placeholder=${org.name || ''} />
                  <${Loud} control danger disabled=${delName.trim() !== (org.name || '').trim()} onClick=${doDelete}>${t('organisms.delete') || 'Delete'}<//>
                <//>` : null}
            <//>` : null}
        <//>
      ` : null}

      ${isMember && !isCreator ? html`
        <${Section} plain first=${!canEdit}>
          <${SettingBox} irreversible>
            <${SettingRow}>
              <span><b>${t('organisms.leave') || 'Leave'}.</b></span>
              <${Action} small tone="danger" onClick=${onLeave}>${t('organisms.leave') || 'Leave'}<//>
            <//>
          <//>
        <//>` : null}
    <//>`;
}
