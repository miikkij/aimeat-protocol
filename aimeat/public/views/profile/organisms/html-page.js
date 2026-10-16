/**
 * @file public/views/profile/organisms/html-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An HTML page of a document space, in the member's view: HtmlPageView shows it in its
 *   frame (components/HtmlPageFrame.js) with the bar every document has (which copy, Edit, Publish,
 *   its own window) and, for a page nobody opened or changed for six months, the line that offers to
 *   archive it. HtmlPageEditor takes the page: a title, the HTML pasted or read from a file, and the
 *   ready-made prompt for an AI that cannot reach this node. The node checks the page and writes its
 *   text when the draft is saved (POST /v1/organisms/:id/workspace/drafts).
 *   The frame carries the page's AI label and who made it. The editor asks whether an AI made the
 *   page (ticked for a new one) and saves the answer as the page's provenance.
 * @structure HtmlPageView · HtmlPageEditor
 * @usage import { HtmlPageView, HtmlPageEditor } from '/views/profile/organisms/html-page.js';
 * @version-history
 *   v1.1.0 — 2026-10-16 — The frame shows the page's AI label and its writer (members only). The
 *     editor's "An AI made this page", saved as the page's provenance declaration.
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { DocView } from '/components/DocView.js';
import { Facts } from '/components/Facts.js';
import { Tabs } from '/components/Tabs.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Check } from '/components/Check.js';
import { FormActions } from '/components/Field.js';
import { Spinner } from '/components/Spinner.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { HtmlPageFrame } from '/components/HtmlPageFrame.js';
import { dt } from '/js/format.js';
import * as htmlPages from '/js/services/html-pages.js';
import { writerName, recordedAsAiMade } from '/js/page-authorship.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const STALE_DAYS = 180;

/** Neither opened nor changed for STALE_DAYS (the rule services/workspace-opened.ts isPageStale applies). */
function isStale(lastOpened, updatedAt) {
  const opened = lastOpened ? Date.parse(`${lastOpened}T00:00:00Z`) : NaN;
  const changed = updatedAt ? Date.parse(updatedAt) : NaN;
  const latest = Math.max(Number.isFinite(opened) ? opened : 0, Number.isFinite(changed) ? changed : 0);
  return latest > 0 && Date.now() - latest > STALE_DAYS * 86_400_000;
}

/* The page in its frame. The parent passes the merged `page` (the draft, carrying the published copy
 * on `page._pub`), as it does to DocumentView; remounted per page via `key`. */
export function HtmlPageView({ orgId, wsId, space, page, busy, lastOpened, onEdit, onPublish, onPopOut, onArchive, inPage }) {
  const hasBoth = page._draft && page._pub;
  const [tab, setTab] = useState('draft');
  const shown = (hasBoth && tab === 'published') ? page._pub : page;
  const version = (hasBoth && tab === 'published') || !page._draft ? 'latest' : 'draft';
  const [frame, setFrame] = useState({ loading: true, url: null, error: false });

  useEffect(() => {
    let cancelled = false;
    setFrame({ loading: true, url: null, error: false });
    htmlPages.getPageFrame(orgId, wsId, space, page.id, version)
      .then(r => { if (!cancelled) setFrame({ loading: false, url: r.frame_url || null, error: false }); })
      .catch(err => { swallowed('html-page: frame', err); if (!cancelled) setFrame({ loading: false, url: null, error: true }); });
    return () => { cancelled = true; };
  }, [orgId, wsId, space, page.id, version, shown._updatedAt]);

  const created = page._createdAt || page._pub?._createdAt;
  const savedAt = page._draft ? page._updatedAt : null;
  const publishedAt = page._pub?._updatedAt || (!page._draft && page._published ? page._updatedAt : null);
  const stale = !page._draft && isStale(lastOpened, page._pub?._updatedAt || page._updatedAt);

  const tools = html`
    ${hasBoth ? html`
      <${Tabs} tone="filter" kind="view" value=${tab} onSelect=${setTab} items=${[
        { value: 'draft', label: t('organisms.draftVersion') || 'Draft' },
        { value: 'published', label: t('organisms.publishedVersion') || 'Published' },
      ]} />` : null}
    <${Action} small onClick=${onEdit}>${t('organisms.edit') || 'Edit'}<//>
    ${page._draft ? html`<${Loud} control onClick=${onPublish} disabled=${busy}>${t('organisms.publish') || 'Publish'}<//>` : null}
    ${onPopOut ? html`<${Icon} small label=${t('organisms.popOut') || 'Open in its own window'} onClick=${onPopOut}>${'⧉'}<//>` : null}`;
  const facts = html`<${Facts} rows=${[
    { k: t('htmlPage.kind'), v: t('htmlPage.kindValue') },
    created && { k: t('organisms.createdAt') || 'Created', v: dt(created) },
    savedAt && { k: t('organisms.lastSaved') || 'Last saved', v: dt(savedAt) },
    publishedAt && { k: t('organisms.publishedAt') || 'Published', v: dt(publishedAt) },
    lastOpened && { k: t('htmlPage.lastOpened'), v: lastOpened },
  ]} />`;

  return html`
    <${DocView} title=${shown.title || shown.id || page.id} tools=${tools} facts=${facts} framed=${!inPage}>
      ${stale ? html`<${Line} wrap gap="small" below="small">
        <${Note} inline>${t('htmlPage.stale')}<//>
        ${onArchive ? html`<${Action} small onClick=${onArchive}>${t('organisms.archive') || 'Archive'}<//>` : null}
      <//>` : null}
      <${HtmlPageFrame} src=${frame.url} title=${shown.title || ''} text=${shown.markdown || ''} loading=${frame.loading} error=${frame.error}
        provenance=${shown._aiProvenance ? { record: shown._aiProvenance, recordUrl: shown._aiProvenanceUrl } : null}
        author=${writerName(shown._aiProvenance?.generator?.principal || shown._writtenBy)} />
    <//>`;
}


/* The page as a member gives it: a title, and the HTML pasted or read from a file. */
export function HtmlPageEditor({ page, busy, onSave, onCancel }) {
  const [title, setTitle] = useState((page && page.title) || '');
  const [source, setSource] = useState((page && typeof page.html === 'string' && page.html) || '');
  const [topic, setTopic] = useState('');
  const [problem, setProblem] = useState(null);
  // A pasted page usually comes from an AI (the prompt below asks one for it), so a new page starts
  // ticked: over-labelling costs an icon, under-labelling is the failure (EU AI Act Art. 50(4)).
  const [aiMade, setAiMade] = useState(page && (page.html || page._aiProvenance) ? recordedAsAiMade(page) : true);
  const bytes = new TextEncoder().encode(source).length;
  const tooBig = bytes > htmlPages.HTML_PAGE_MAX_BYTES;

  const fromFile = async ([file]) => {
    if (!file) return;
    try {
      const text = await file.text();
      setSource(text);
      if (!title.trim()) {
        const m = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        setTitle(m ? m[1].trim() : file.name.replace(/\.html?$/i, ''));
      }
      setProblem(null);
    } catch (err) { swallowed('html-page: read file', err); setProblem(t('htmlPage.fileUnreadable')); }
  };

  const save = () => {
    if (!source.trim()) { setProblem(t('htmlPage.empty')); return; }
    if (tooBig) { setProblem(t('htmlPage.tooBig')); return; }
    onSave({ ...page, title: title.trim(), html: source, aiMade });
  };

  const titleWords = t('organisms.pageTitle') || 'Document title';
  return html`
    <${Stack} above="small" below="small">
      <${Note} kind="lead">${t('htmlPage.editorLead')}<//>
      <${TextField} placeholder=${titleWords} ariaLabel=${titleWords} value=${title} onInput=${setTitle} />
      <${Line} wrap gap="small">
        <${FileDrop} button=${t('htmlPage.fromFile')} accept=".html,.htm,text/html" onFiles=${fromFile} />
        <${Note} inline>${t('htmlPage.orPaste')}<//>
      <//>
      <${TextArea} code rows=${14} value=${source} onInput=${(v) => { setSource(v); setProblem(null); }}
        placeholder=${t('htmlPage.pastePlaceholder')} ariaLabel=${t('htmlPage.pastePlaceholder')} />
      <${Note} inline error=${tooBig}>${(t('htmlPage.size') || '{kb} kB of {max} kB').replace('{kb}', String(Math.ceil(bytes / 1024))).replace('{max}', String(htmlPages.HTML_PAGE_MAX_BYTES / 1024))}<//>
      ${problem ? html`<${Note} error>${problem}<//>` : null}
      <${Check} checked=${aiMade} onChange=${setAiMade} hint=${t('aiDeclare.hint')}>${t('aiDeclare.htmlPage')}<//>
      <${Stack} gap="small">
        <${Note} kind="aside">${t('htmlPage.promptLead')}<//>
        <${TextField} value=${topic} onInput=${setTopic} placeholder=${t('htmlPage.topicPlaceholder')} ariaLabel=${t('htmlPage.topicPlaceholder')} />
        <${Line} wrap gap="small">
          <${Action} small copy=${htmlPages.htmlPagePrompt(topic.trim())} copiedLabel=${t('htmlPage.promptCopied')}>${t('htmlPage.copyPrompt')}<//>
        <//>
      <//>
      <${FormActions}>
        <${Loud} control onClick=${save} disabled=${busy || !title.trim() || tooBig}>
          ${busy ? html`<${Spinner} /> ${t('organisms.saving') || 'Saving…'}` : (t('organisms.saveDraft') || 'Save draft')}
        <//>
        <${Action} small onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}<//>
      <//>
    <//>`;
}
