/**
 * @file notebook.js
 * @description Notebook slice B client service. classifyNote() asks the backend AI classifier where a
 *   note belongs; materializeDocument() then ORCHESTRATES the placement over the existing generic
 *   memory/organism APIs (no-SSR — the client composes create-organism / create-workspace /
 *   write-document; there is no per-feature backend write route). Supports an existing target, a new
 *   workspace in an existing organism, or a brand-new organism+workspace, always materializing the
 *   note as a workspace DOCUMENT.
 * @structure
 *   - classifyNote(text) — POST /v1/librarian/classify
 *   - distributeNote(text) — POST /v1/librarian/distribute (split into placed chunks)
 *   - materializeDocument(plan) — resolve/create org → ws → document space → draft→publish doc → drop source
 *   - distributeChunks(chunks, sourceKey, onProgress) — materialize each chunk to its home
 *   - parkMessageToNotebook(msg) — park ONE inbox message for later processing
 *   - parkConversationToNotebook({conv,thread,peerName,summary,images}) — park a WHOLE thread (transcript +
 *     inline image embeds, optional AI/pasted summary) as one entry, ready for classify/distribute
 *   - getNotebookSettings/saveNotebookSettings — the per-owner trust toggles (notebook.settings)
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: classify + materialize-document orchestration (slice B).
 *   v1.1.0 — 2026-06-21 — Phase 3: distribute (split → many homes) + notebook.settings trust toggles.
 *   v1.2.0 — 2026-06-21 — (reverted) materializeRecord/patchRecord removed — the Tracked Response flow
 *     now writes records through the proper workspace draft→publish path (services/organisms.js), not a
 *     raw memory write, so records land in the right namespace/owner and show up with activity.
 *   v1.3.0 — 2026-06-23 — materializeDocument now writes via writeDraft + publishDraft (was a raw
 *     `.latest` memory write) so notebook documents get version history and appear in the workspace
 *     activity log/heatmap — the document-path counterpart to the v1.2.0 record fix.
 *   v1.4.0 — 2026-07-19 — parkConversationToNotebook: capture a whole inbox thread (transcript + inline
 *     image embeds, optional summary) as one notebook entry for the "→ Notebook" conversation capture.
 */
import { api, apiPost } from '/js/api.js';
import { createMemory, getMemory, deleteMemory } from '/js/services/memory.js';
import { createOrganism, saveManifest, listWorkspaces, saveWorkspaceRegistry, wsRoot, writeDraft, publishDraft } from '/js/services/organisms.js';
import { handleOf } from '/js/services/messages-ai-prompts.js';
import { swallowed } from '/js/swallowed.js';

const DOC_SPACE = 'pages';

function rid(prefix) {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return prefix + r;
}

/** Ask the backend AI classifier where a note belongs. Returns the ClassifyResult envelope's data.
 *  This is a slow AI call — give it the full AI timeout (30 min) and DO NOT retry, otherwise the
 *  default 30s client timeout aborts a model that is still thinking and re-fires the request. */
export async function classifyNote(text) {
  const resp = await api('/v1/librarian/classify', {
    method: 'POST',
    body: JSON.stringify({ text }),
    timeoutMs: 1_800_000,
    retries: 0,
  });
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Classify failed');
  return resp?.data || null;
}

/** Ask the backend to SPLIT a note into placed chunks (notebook stage 3). Slow AI call — full timeout,
 *  no retry (same reasoning as classifyNote). Returns the DistributeResult envelope's data. */
export async function distributeNote(text) {
  const resp = await api('/v1/librarian/distribute', {
    method: 'POST',
    body: JSON.stringify({ text }),
    timeoutMs: 1_800_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Distribute failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

/**
 * Park an inbox message into the notebook for later processing, preserving the link back to the
 * original message and the "owes a reply" intent (so when the note is later turned into a tracked
 * response, the binding re-attaches to the source message). Stored as a normal notebook inbox entry.
 * @param {object} msg  The inbox message ({ id, body, conversationId, direction, senderGhii, recipientGhii }).
 * @param {{ title?: string, content?: string, mode?: 'auto'|'approve' }} [opts]
 */
export async function parkMessageToNotebook(msg, opts = {}) {
  const key = 'notebook.inbox.' + Date.now();
  const peerGhii = msg?.direction === 'outbound' ? (msg?.recipientGhii || '') : (msg?.senderGhii || '');
  const value = {
    text: (opts.content && opts.content.trim()) || msg?.body || '',
    title: opts.title || '',
    capturedAt: new Date().toISOString(),
    source: { kind: 'message', messageId: msg?.id, conversationId: msg?.conversationId, peerGhii, originNodeId: (peerGhii.split('@')[1] || '') },
    trackedResponseIntent: { owes: true, mode: opts.mode || 'approve' },
  };
  const resp = await createMemory(key, value, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not park to notebook');
  return { key };
}

/** A short, stable UTC timestamp for a transcript line (locale-independent so the note is reproducible). */
function nbStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
}

/** Render a whole thread as a Markdown transcript, embedding each message's image attachments inline
 *  (by url) so they survive into the materialized workspace document. `images` groups by messageId. */
function renderConversationMarkdown(thread, peerGhii, peerName, images) {
  const them = peerName || handleOf(peerGhii);
  const byMsg = {};
  for (const im of (images || [])) (byMsg[im.messageId] || (byMsg[im.messageId] = [])).push(im);
  return (thread || []).map((m) => {
    const who = m.direction === 'outbound' ? 'Me' : them;
    const when = nbStamp(m.createdAt);
    const body = String(m.body || '').trim();
    const imgs = (byMsg[m.id] || []).map((im) => `\n\n![${im.name || 'image'}](${im.url})`).join('');
    return `**${who}**${when ? ` — ${when}` : ''}\n\n${body}${imgs}`;
  }).join('\n\n---\n\n');
}

/** Pull an H1/first line out of a summary to use as the note title, or null. */
function summaryTitle(summary) {
  const first = String(summary || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return null;
  return first.replace(/^#+\s*/, '').slice(0, 120) || null;
}

/**
 * Park a WHOLE conversation into the notebook as one entry (text + inline image embeds), ready for the
 * existing classify/distribute enrichment. The three inbox capture modes all land here:
 *   - a server-side / pasted AI summary → stored above a "Full transcript" section, or
 *   - raw (no summary) → just the transcript.
 * @param {object} [args]
 * @param {{ conversationId?:string, peerGhii?:string, subject?:string }} [args.conv]
 * @param {Array} [args.thread]   The loaded thread messages.
 * @param {string} [args.peerName]
 * @param {string} [args.summary]  An AI (server or pasted) summary markdown; omit for a raw capture.
 * @param {Array<{messageId:string,id:string,name?:string,url:string}>} [args.images]  Image attachments.
 */
export async function parkConversationToNotebook({ conv, thread, peerName, summary, images } = {}) {
  const peerGhii = conv?.peerGhii || '';
  const transcriptMd = renderConversationMarkdown(thread, peerGhii, peerName, images);
  const sum = (summary || '').trim();
  const text = sum
    ? `${sum}\n\n---\n\n## Full transcript\n\n${transcriptMd}`
    : transcriptMd;
  const title = summaryTitle(sum) || `Conversation with ${peerName || handleOf(peerGhii)}`;
  const key = 'notebook.inbox.' + Date.now();
  const value = {
    text,
    title,
    capturedAt: new Date().toISOString(),
    source: {
      kind: 'conversation',
      conversationId: conv?.conversationId,
      peerGhii,
      originNodeId: (peerGhii.split('@')[1] || ''),
      messageCount: (thread || []).length,
      attachments: (images || []).map((im) => ({ messageId: im.messageId, id: im.id, name: im.name, url: im.url })),
    },
    // A summarized thread is a knowledge capture, not an unanswered message — it owes no reply.
    trackedResponseIntent: { owes: false, mode: 'approve' },
  };
  const resp = await createMemory(key, value, 'private');
  if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not park conversation to notebook');
  return { key };
}

/** The per-owner notebook trust toggles ({ autoDetectIntent, autoRunPlan, autoDistribute }). */
export async function getNotebookSettings() {
  try { const r = await getMemory('notebook.settings'); return (r?.data?.value) || {}; }
  catch (err) { swallowed('notebook', err); return { }; }
}
export async function saveNotebookSettings(settings) {
  return createMemory('notebook.settings', settings, 'private');
}

/** A document-space objectType for a memory-backed workspace. */
function docSpaceObjectType() {
  return { name: 'Pages', namespace: DOC_SPACE, schemaRef: 'schema:document@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true };
}

function newWorkspaceManifest(orgId, name) {
  return { manifestVersion: '1.0', id: orgId, name: name || 'Notebook', kind: 'project', status: 'active', objectTypes: [docSpaceObjectType()] };
}

/** Read a workspace manifest (raw value), or null if it has none / is unreadable. */
async function readManifest(orgId, wsId) {
  try {
    const r = await getMemory(`${wsRoot(orgId, wsId)}.meta.manifest`);
    return r?.data?.value || null;
  } catch (err) { swallowed('notebook: readManifest', err); return null; }
}

/**
 * Materialize a note into a workspace document.
 * @param {object} plan
 * @param {string|null} plan.organismId  Existing organism id, or null to create one.
 * @param {string} [plan.organismName]   Name for a new organism (when organismId is null).
 * @param {string|null} plan.workspaceId Existing workspace id, or null to create one.
 * @param {string} [plan.workspaceName]  Name for a new workspace (when workspaceId is null).
 * @param {string|null} plan.space       Existing document-space namespace, or null to use/create the default.
 * @param {string} plan.title
 * @param {string} plan.markdown
 * @param {string} [plan.sourceKey]      Inbox note key to delete once filed.
 * @returns {Promise<{organismId:string, workspaceId:string, space:string, docId:string}>}
 */
export async function materializeDocument(plan) {
  let { organismId, workspaceId, space } = plan;

  // 1. Organism — create if needed.
  if (!organismId) {
    const resp = await createOrganism({
      name: (plan.organismName || 'Notebook').trim(),
      description: 'Created from the notebook',
      type: 'project',
      join_policy: 'approval_required',
      visibility: 'private',
    });
    if (resp?.ok === false) throw new Error(resp.error?.message || 'Could not create organism');
    organismId = resp?.data?.organism?.id;
    if (!organismId) throw new Error('Organism creation returned no id');
  }

  // 2. Workspace — create if needed (registry + manifest with a document space).
  if (!workspaceId) {
    workspaceId = rid('ws-');
    const manifest = newWorkspaceManifest(organismId, plan.workspaceName);
    await saveManifest(organismId, workspaceId, manifest);
    await apiPost('/v1/memory', { key: `${wsRoot(organismId, workspaceId)}.meta.readme`, value: `# ${manifest.name}\n\nCreated from the notebook.`, visibility: 'private' });
    const existing = await listWorkspaces(organismId);
    await saveWorkspaceRegistry(organismId, [...existing, { id: workspaceId, name: manifest.name, createdAt: new Date().toISOString() }]);
    space = DOC_SPACE;
  }

  // 3. Document space — ensure one exists on the chosen workspace.
  if (!space) {
    const manifest = await readManifest(organismId, workspaceId);
    const existingDoc = (manifest?.objectTypes || []).find(ot => (ot.mode === 'document') || (!ot.mode && ot.kind === 'document'));
    if (existingDoc?.namespace) {
      space = existingDoc.namespace;
    } else if (manifest) {
      // Best-effort: add a default document space to the manifest so the doc renders.
      const updated = { ...manifest, objectTypes: [...(manifest.objectTypes || []), docSpaceObjectType()] };
      await saveManifest(organismId, workspaceId, updated).catch(err => { swallowed('notebook: existingDoc', err); });
      space = DOC_SPACE;
    } else {
      space = DOC_SPACE;
    }
  }

  // 4. Write the document through the proper workspace draft→publish path (NOT a raw `.latest` write).
  //    A raw write to `…{space}.{docId}.latest` lands the content but produces no version history and
  //    no activity event (the feed is derived from `.draft`/`.version.N` keys), so notebook documents
  //    used to be invisible in the workspace activity log / heatmap. Going through writeDraft +
  //    publishDraft mints `.version.1` + `.latest` and shows up like every other published object —
  //    matching the Tracked-Response record path migrated in v1.2.0.
  const docId = rid('doc-');
  const docValue = { id: docId, title: plan.title, markdown: plan.markdown };
  const draftResp = await writeDraft(organismId, workspaceId, space, docId, docValue);
  if (draftResp?.ok === false) throw new Error(draftResp.error?.message || 'Could not write document');
  const pubResp = await publishDraft(organismId, workspaceId, space, docId);
  if (pubResp?.ok === false) throw new Error(pubResp.error?.message || 'Could not publish document');

  // 5. Drop the source inbox note (it has been filed).
  if (plan.sourceKey) await deleteMemory(plan.sourceKey).catch(err => { swallowed('notebook: existingDoc', err); });

  return { organismId, workspaceId, space, docId };
}

/**
 * Materialize each chunk of a distribute plan into its own home. Chunks with a resolved home go there;
 * chunks the model proposed a NEW name for create that org/workspace; chunks with neither are grouped
 * into a single shared "Notebook" organism (created once, reused) so unplaced pieces are never lost.
 * The source inbox note is dropped ONLY after every chunk has been filed.
 * @param {Array} chunks  DistributeChunk[] from distributeNote().
 * @param {string} [sourceKey]  Inbox note key to delete once all chunks are filed.
 * @param {(index:number, status:'running'|'done'|'failed', result?:object)=>void} [onProgress]
 * @returns {Promise<Array>} per-chunk materialize results
 */
export async function distributeChunks(chunks, sourceKey, onProgress) {
  const results = [];
  let notebookFallback = null;   // { organismId, workspaceId, space } for unplaced chunks
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onProgress?.(i, 'running');
    const organismName = c.createNew?.organismName || c.organismName;
    const plan = {
      organismId: c.organismId || null,
      organismName,
      workspaceId: c.workspaceId || null,
      workspaceName: c.createNew?.workspaceName || c.workspaceName,
      space: c.space || null,
      title: c.title,
      markdown: c.markdown,
    };
    const unplaced = !plan.organismId && !organismName;
    if (unplaced && notebookFallback) {
      plan.organismId = notebookFallback.organismId;
      plan.workspaceId = notebookFallback.workspaceId;
      plan.space = notebookFallback.space;
    }
    try {
      const res = await materializeDocument(plan);   // no sourceKey — don't delete per chunk
      if (unplaced && !notebookFallback) notebookFallback = { organismId: res.organismId, workspaceId: res.workspaceId, space: res.space };
      results.push(res);
      onProgress?.(i, 'done', res);
    } catch (e) {
      onProgress?.(i, 'failed');
      throw e;   // surface the failure; source note is NOT deleted so nothing is lost
    }
  }
  if (sourceKey) await deleteMemory(sourceKey).catch(err => { swallowed('notebook: distributeChunks', err); });
  return results;
}
