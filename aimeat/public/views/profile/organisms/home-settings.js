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
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, Sections, Fields, tab-style
 *     radio choices; the reversible act is the dashed aside and the irreversible one a solid box. No
 *     class of its own.
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
import { Page, Rail, Section, Columns, Stack, Surface, Field, Chip, Action, Text } from '/components/poster-parts.js';
import { TagInput } from '/views/profile/shared.js';
import * as orgService from '/js/services/organisms.js';
import { copyToClipboard } from '/js/utils.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { swallowed } from '/js/swallowed.js';

const TYPE_PRESETS = ['community', 'team', 'club', 'cooperative', 'project'];
const JOIN = ['open', 'approval_required', 'invite_only'];
const VIS = ['public', 'listed', 'private'];
const MEMBER_VIS = ['authenticated', 'members', 'admins', 'public'];

/** A row of choices, the chosen one on the sun. */
function Choice({ options, value, onPick, label }) {
  return html`
    <${Stack} direction="wrap" role="radiogroup" label=${label}>
      ${options.map(o => html`
        <${Action} key=${o.id} kind="tab" semantics="radio" selected=${value === o.id} onClick=${() => onPick(o.id)}>${o.label}<//>`)}
    <//>`;
}

export function OrganismSettings({ org, isCreator, isMember, canEdit, showToast, confirm, onBack, onChanged, onLeave, onDeleted }) {
  const baseline = useMemo(() => ({
    name: org.name || '', description: org.description || '', type: org.type || 'community',
    join_policy: org.joinPolicy || 'open', visibility: org.visibility || 'public',
    member_visibility: org.memberVisibility || 'authenticated',
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
      && form.interests.join(' ') === prev.interests.join(' ');
    if (untouched) { setForm(baseline); setCustomType(!TYPE_PRESETS.includes(baseline.type)); }
    prevBaselineRef.current = baseline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);
  const dirty = form.name !== baseline.name || form.description !== baseline.description
    || form.type !== baseline.type || form.join_policy !== baseline.join_policy
    || form.visibility !== baseline.visibility
    || form.member_visibility !== baseline.member_visibility
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
    ...TYPE_PRESETS.map(id => ({ id, label: t(`organisms.types.${id}`) || id })),
    { id: '__custom', label: t('organisms.typeCustom') || 'Other' },
  ];
  const pickType = (id) => {
    if (id === '__custom') { setCustomType(true); setForm(f => ({ ...f, type: TYPE_PRESETS.includes(f.type) ? '' : f.type })); }
    else { setCustomType(false); setForm(f => ({ ...f, type: id })); }
  };
  const label = (k, fb) => t(`organisms.${k}`) || fb;

  const hint = (text) => html`<${Text} kind="caption" tone="muted">${text}<//>`;
  const railEntries = canEdit ? [
    { id: 'og-set-name', href: '#og-set-name', label: label('setNameDesc', 'Name and description'), current: true },
    { id: 'og-set-access', href: '#og-set-access', label: label('setAccess', 'Who gets in') },
    { id: 'og-set-vis', href: '#og-set-vis', label: label('setVisibility', 'Who sees') },
    { id: 'og-set-danger', href: '#og-set-danger', label: label('setDanger', 'Archive and delete') },
  ] : [];

  return html`<${Page} title=${t('organisms.settings') || 'Settings'}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInformation') }, { label: t('organisms.title') || 'Organisms', onClick: leave }, { label: org.name || org.id, onClick: leave }, { label: t('organisms.settings') || 'Settings' }]}
    identity=${html`<${Stack} direction="wrap" density="compact" align="center">
      ${org.createdAt ? html`<${Chip} tone="muted">${t('organisms.createdAt') || 'Created'} ${fmtDate(org.createdAt)}<//>` : null}
      <${Chip} tone="muted">${t('organisms.creator') || 'Creator'} ${org.creatorGhii || '-'}<//>
      ${extraAdmins.length > 0 ? html`<${Chip} tone="muted">${t('organisms.admins') || 'Admins'} ${extraAdmins.join(', ')}<//>` : null}
      ${org.boardId ? html`<${Action} kind="text" title=${t('organisms.copyId') || 'Copy ID'} onClick=${copyBoardId}>${t('organisms.board') || 'Board'} ${boardIdShort}<//>` : null}
    <//>`}
    rail=${html`<${Rail} kind="index" title=${t('organisms.settings') || 'Settings'} entries=${railEntries}>
      <${Action} kind="text" onClick=${leave}>← ${label('backToOrganism', 'Back to the organism')}<//>
    <//>`}>
    ${canEdit ? html`
      <${Section} id="og-set-name" title=${label('setNameDesc', 'Name and description')} count="01" density="compact">
        <${Stack}>
          <${Field} label=${label('fieldName', 'Name')} value=${form.name} onInput=${(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          <${Field} type="textarea" rows=${3} label=${label('fieldDescription', 'Description')} value=${form.description} onInput=${(e) => setForm(f => ({ ...f, description: e.target.value }))} />
          <${Stack} density="compact">
            <${Text} kind="label">${label('fieldInterests', 'Interests')}<//>
            <${TagInput} tags=${form.interests} onChange=${(tags) => setForm(f => ({ ...f, interests: tags }))} placeholder=${t('organisms.addTag') || 'Add…'} />
          <//>
          <${Stack} density="compact">
            <${Text} kind="label">${label('fieldType', 'Type')}<//>
            <${Choice} label=${label('fieldType', 'Type')} options=${typeOptions} value=${customType ? '__custom' : form.type} onPick=${pickType} />
            ${customType ? html`<${Field} maxLength=${40} value=${form.type} placeholder=${t('organisms.typeCustomPlaceholder') || 'Your own word'}
              onInput=${(e) => setForm(f => ({ ...f, type: e.target.value }))} />` : null}
          <//>
        <//>
      <//>

      <${Section} id="og-set-access" title=${label('setAccess', 'Who gets in')} count="02" density="compact">
        <${Stack} density="compact">
          <${Text} kind="label">${label('setJoin', 'Joining')}<//>
          <${Choice} label=${label('setJoin', 'Joining')} value=${form.join_policy} onPick=${(id) => setForm(f => ({ ...f, join_policy: id }))}
            options=${JOIN.map(id => ({ id, label: t(`organisms.policyShort.${id}`) || id }))} />
          ${policyHint && !policyHint.startsWith('organisms.') ? hint(policyHint) : null}
        <//>
      <//>

      <${Section} id="og-set-vis" title=${label('setVisibility', 'Who sees')} count="03" density="compact">
        <${Columns} collapse="640">
          <${Stack} density="compact">
            <${Text} kind="label">${label('setOrganismVis', 'Organism')}<//>
            <${Choice} label=${label('setOrganismVis', 'Organism')} value=${form.visibility} onPick=${(id) => setForm(f => ({ ...f, visibility: id }))}
              options=${VIS.map(id => ({ id, label: t(`organisms.vis${id[0].toUpperCase()}${id.slice(1)}`) || id }))} />
            ${visHint && !visHint.startsWith('organisms.') ? hint(visHint) : null}
          <//>
          <${Stack} density="compact">
            <${Text} kind="label">${label('memberVisLabel', 'Member list')}<//>
            <${Choice} label=${label('memberVisLabel', 'Member list')} value=${form.member_visibility} onPick=${(id) => setForm(f => ({ ...f, member_visibility: id }))}
              options=${MEMBER_VIS.map(id => ({ id, label: t(`organisms.memberVis.${id}`) || id }))} />
            ${hint(t('organisms.memberVisHint') || 'Who can see who belongs here. Hides the member list only; content authorship stays visible.')}
          <//>
        <//>
      <//>

      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" onClick=${saveEdit} disabled=${saving || !dirty || !form.name.trim()}>
          ${saving ? '...' : (t('organisms.saveChanges') || 'Save changes')}<//>
        <${Action} onClick=${leave}>${t('organisms.cancel') || 'Cancel'}<//>
        ${hint(label('savesNote', 'Changes apply at once.'))}
      <//>

      <${Section} id="og-set-danger" title=${label('setDanger', 'Archive and delete')} count="04" density="compact">
        <${Stack}>
          <${Surface} kind="aside">
            <${Stack} density="compact">
              <${Text} kind="label">${label('reversible', 'Reversible')}<//>
              <${Stack} direction="wrap" align="between">
                <${Text}><strong>${org.archived ? (t('organisms.unarchiveOrganismTitle') || 'Unarchive this organism') : (t('organisms.archiveOrganismTitle') || 'Archive this organism')}.</strong> ${org.archived
                  ? (t('organisms.unarchiveOrganismSub') || 'Make it active again. Workspaces archived together with it are restored.')
                  : (t('organisms.archiveOrganismSub') || 'Make it read-only and hide it (and its workspaces) from AI operations. Nothing is deleted.')}<//>
                <${Action} onClick=${() => doArchive(!org.archived)}>${org.archived ? (t('organisms.unarchive') || 'Unarchive') : (t('organisms.archive') || 'Archive')}<//>
              <//>
            <//>
          <//>
          ${isCreator ? html`
            <${Surface} kind="box">
              <${Stack} density="compact">
                <${Text} kind="label">${label('irreversible', 'Cannot be undone')}<//>
                <${Stack} direction="wrap" align="between">
                  <${Text}><strong>${t('organisms.deleteOrganismTitle') || 'Delete this organism'}.</strong> ${delStatsText}<//>
                  <${Action} kind="tab" selected=${delOpen} expanded=${delOpen} onClick=${() => { setDelOpen(o => !o); setDelName(''); }}>${t('organisms.deleteDots') || 'Delete…'}<//>
                <//>
                ${delOpen ? html`
                  <${Stack} direction="horizontal" align="end">
                    <${Field} label=${(t('organisms.confirmTypeName') || 'Type the organism’s name to confirm') + ': ' + (org.name || '')}
                      value=${delName} onInput=${(e) => setDelName(e.target.value)} placeholder=${org.name || ''} />
                    <${Action} kind="primary" tone="danger" disabled=${delName.trim() !== (org.name || '').trim()} onClick=${doDelete}>${t('organisms.delete') || 'Delete'}<//>
                  <//>` : null}
              <//>
            <//>` : null}
        <//>
      <//>
    ` : null}

    ${isMember && !isCreator ? html`
      <${Surface} kind="box">
        <${Stack} direction="wrap" align="between">
          <${Text}><strong>${t('organisms.leave') || 'Leave'}.</strong><//>
          <${Action} onClick=${onLeave}>${t('organisms.leave') || 'Leave'}<//>
        <//>
      <//>` : null}
  <//>`;
}
