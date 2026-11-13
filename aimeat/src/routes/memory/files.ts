/**
 * @file src/routes/memory/files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description File-storage routes under /v1/memory/files: upload (presigned or inline base64),
 *   visibility/tags PATCH, list, download, delete. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.16.3 -- 2026-11-13 -- SECURITY: GET /v1/memory/files lists only the files the caller's
 *     classification reader shows, as GET /v1/memory/files/:key and the MCP storage resource do
 *     (storedFilesShownTo; structure programme 2026-11, unit 7). The count of every file
 *     (?count=true alone) stays one aggregate: a count is not a name.
 *   v1.16.2 -- 2026-11-11 -- GET /v1/memory/files names a caller other than the owner in person by
 *     resolveIdentity, as the routes beside it do, not by raw `sub`. The value is the same for every
 *     caller (verifyJWT already gives a visitor its home GHII as `sub`); the resolve-identity rules
 *     flagged the raw read.
 *   v1.16.1 -- 2026-11-10 -- GET /v1/memory/files?count=true counts with one aggregate
 *     (sumStorageBytesForOwners, the same rows) instead of listing every file; with exclude_prefix it
 *     still lists and counts.
 *   v1.16.0 -- 2026-11-10 -- GET /v1/memory/files takes exclude_prefix, limit and offset (additive): the
 *     Memory page reads its files a page at a time instead of all of them.
 *   v1.15.3 -- 2026-11-09 -- GET /v1/memory/files lists the owner's and every agent's files in one IN
 *     query (listStorageFilesForOwners), in the same order: 81 queries at 79 agents before.
 *   v1.15.2 -- 2026-11-08 -- GET /v1/memory/files/:key asks the labels a data package version keeps, as
 *     GET /v1/pub does (datapackage/source-labels.ts storedFileShownTo; secaudit2026nov08b round 15b).
 *   v1.15.1 -- 2026-11-05 -- POST refuses a group_id naming no group, inline and presigned (storage-file-write.ts).
 *   v1.15.0 -- 2026-11-01 -- The presigned mint carries the welcome page's writer in the token
 *     (`page_writer`), and DELETE notes it through the shared delete (services/storage-page-keys.ts;
 *     secaudit2026oct31w2 round 11).
 *   v1.14.0 -- 2026-11-01 -- The presigned mint and DELETE of a company's page key ask what the company
 *     page route asks, as the inline write does through the shared write (services/storage-page-keys.ts;
 *     secaudit2026oct31w2 round 11).
 *   v1.14.0 -- 2026-11-04 -- POST refuses visibility 'group' with no group_id, inline and presigned, and
 *     PATCH .../visibility refuses 'group' on a file that has no group (storage-file-write.ts).
 *   v1.13.0 -- 2026-10-30 -- POST takes `store`, the store the writer names for the bytes (inline and
 *     presigned), and the upload answer and the list say each file's `store`
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.12.0 -- 2026-10-18 -- The presigned mint refuses a level wider than the file's label allows with
 *     409 LABEL_CAPS_AUDIENCE, as the shared mint does (plan doc-mvdipuyqraas, L3.2).
 *   v1.11.0 -- 2026-10-18 -- On a node that shows its content to signed-in accounts only, a file asked as
 *     public (inline, presigned, or the visibility change) lands at 'members' and the answer carries
 *     `warnings` with PUBLIC_IS_SIGNED_IN_HERE (services/closed-node-level.ts, plan V1.6).
 *   v1.10.0 -- 2026-10-18 -- POST without a visibility takes visibility.file_default; `visibility: 'default'`
 *     takes visibility.app_upload_default for an app grant and the file default for anyone else (plan
 *     doc-mvcn6c7e4e5q, V5.2), before validation and the publish gate.
 *   v1.9.0 -- 2026-10-18 -- POST (inline and presigned) and PATCH .../visibility ask the publish gate
 *     (services/storage-file-publish.ts; plan doc-mvcn6c7e4e5q, V4): a file made public by a caller the
 *     node asks the owner about keeps the level it had (a new one: private) and the answer is 202 with
 *     `publish_request`. The visibility change is the shared changeStorageFileVisibility.
 *   v1.8.0 -- 2026-10-17 -- POST and PATCH .../visibility take 'organism:<id>' and refuse one naming an
 *     organism the uploader's account is not an active member of (plan doc-mvcn6c7e4e5q, V3.3).
 *   v1.7.1 -- 2026-10-11 -- Upload and delete leave the change event to their service, which scopes
 *     it to the owner of a file nobody else reads; the tag update scopes its own.
 *   v1.7.0 -- 2026-10-08 -- POST takes ai_provenance / ai_provenance_id (inline and presigned), and the
 *     inline write goes through services/storage-file-write.ts writeStorageFile, so the anonymous key
 *     fence and the group binding apply here as on POST /v1/storage. The answer carries `ai_provenance`.
 *   v1.6.2 -- 2026-10-05 -- The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 *   v1.6.1 -- 2026-10-05 -- The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.6.0 -- 2026-09-29 -- The download passes the classification reader (TARGET-082).
 *   v1.5.0 -- 2026-09-24 -- POST refuses an app's icon and screenshot keys with 403, through the
 *     same appOwnedKeyRefusal() as POST /v1/storage, before the mint and the inline write (A7-2).
 *   v1.4.1 -- 2026-09-24 -- The federated test is isForeignPrincipal(), the one question (secaudit 2026-09, F-1).
 *   v1.4.0 -- 2026-09-14 -- The owner branch of the listing is for a LOCAL owner session. It built
 *     the GHII from the owner name, which for a session signed in from another node is the local
 *     part of THEIR name, so a same-named visitor listed the local account's files and its agents'.
 *   v1.3.0 -- 2026-09-13 -- POST /v1/memory/files answers versioned_url, as the storage upload doors do.
 *   v1.2.0 -- 2026-09-06 -- Review item 3.2: the tag PATCH, the listing and the DELETE take the
 *     storage words their siblings already carried, and the DELETE goes through the shared
 *     removeStorageFile -- it had reimplemented the removal inline and skipped the key fence.
 *   v1.1.0 — 2026-08-10 — Security audit H-12: upload, visibility and download enforce storage:write /
 *     storage:read, matching the /v1/storage twin over the same store. This route was the unscoped way in.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 *   v1.1.0 — 2026-07-31 — POST accepts `mode: 'presigned'` and mints an upload URL, so a file no
 *     longer has to fit inside a JSON body. Inline base64 was the ONLY way in, and this route is not
 *     on server.ts's large-body list, so every upload here died at security.json_body_limit_mb (5 MB
 *     of JSON = ~3.7 MB of file) with a bare 413 — while quota.storage_max_file_size_mb said 50.
 */

import type { Router } from 'express';
import type { StorageFileRecord } from '../../storage/interface.js';
import { normalizeWorkspaceRefs } from '../../utils/workspace-ref.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { isOwnerInPerson, isForeignPrincipal } from '../../utils/gaii.js';
import { STORED_VISIBILITY_WORDS } from '../../utils/visibility-words.js';
import { isStoredVisibility, organismVisibilityRefusal } from '../../services/organism-visibility.js';
import { success, error } from '../../middleware/envelope.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../services/resource-events.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../../services/doc-images.js';
import { versionedAddress } from '../../utils/http-range.js';
import { emitRecordChange } from '../../services/event-bus.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sniffedContentType } from '../../utils/app-content-type.js';
import { generateUploadToken, buildUploadMeta } from '../../services/upload-token.js';
import {
  removeStorageFile, appOwnedKeyRefusal, groupBindingRefusal, writeStorageFile, storageProvenanceMintRefusal, changeStorageFileVisibility,
} from '../../services/storage-file-write.js';
import { pageKeyWriteRefusal, pageWriterOf, pageWriterMeta } from '../../services/storage-page-keys.js';
import { mintPublishCarry, closedFileLevel, fileCapRefusal } from '../../services/storage-file-publish.js';
import { closedNodeWarnings } from '../../services/closed-node-level.js';
import { callerOf } from '../../middleware/caller.js';
import { storageProvenanceFromBody, uploadProvenanceBlock } from '../storage-provenance-input.js';
import { loadServedProvenance, setProvenanceHeaders } from '../../services/ai/provenance-marks.js';
import type { MemoryRouteCtx } from './shared.js';
import { readerFor } from '../../services/classification/reader.js';
import { storedFileShownTo, storedFilesShownTo } from '../../services/datapackage/source-labels.js';
import { uploadVisibilityOf, isAppGrantRoles } from '../../services/content-defaults.js';
import { choiceIdOf, resolveChoice } from '../../services/file-store/file-store-resolver.js';
import { parseBlobRef } from '../../storage/blob/blob-types.js';

export function registerFilesRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, resolve } = ctx;

  // ── /v1/memory/files — File storage (MUST be before :key routes) ──

  // POST /v1/memory/files — upload file (presigned URL, or inline base64 JSON body)
  router.post('/v1/memory/files', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const { key, content, mime_type, visibility: named, tags, workspaceRef, workspace_refs, mode, group_id, store: named_store } = req.body ?? {};
    // The store the writer names for the bytes, checked with the caller's rights by the shared write
    // (inline) or here before the mint (presigned), as on POST /v1/storage.
    const store = typeof named_store === 'string' && named_store
      ? { id: named_store.slice(0, 100), operator: await callerOf(req, config.nodeId, storage).operator() } : undefined;
    // The node's starting level (plan V5.2), decided before the validation, the presigned mint and the
    // publish gate below: 'default' (the SDK's word) is the app-upload default for an app grant, none
    // at all is the file default.
    const visibility = uploadVisibilityOf(config, named as string | undefined, isAppGrantRoles(req.auth!.roles));

    // `content` is required only for the inline path; a presigned mint carries no bytes at all.
    if (!key || (mode !== 'presigned' && !content)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and content (base64) are required'));
      return;
    }
    // An app's icon and screenshot keys belong to the app's own doors, on this door as on
    // POST /v1/storage (A7-2). Refused before the mint as well as before the inline write.
    const owned = appOwnedKeyRefusal(String(key));
    if (owned) {
      res.status(owned.status).json(error(config.nodeId, owned.code, owned.message));
      return;
    }

    // Files now share memory's full tier set. 'workspace' names one or more "<org>/<ws>" (a file can be
    // shared into several workspaces) so members of ANY of them can read it (authorizeRead/canReadWorkspace).
    // 'organism:<id>' too (2026-10-17): the shared write refuses one the uploader's account is not a member of.
    if (visibility !== undefined && !isStoredVisibility(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `visibility must be one of: ${STORED_VISIBILITY_WORDS.join(', ')}, or "organism:<organism id>"`));
      return;
    }
    // Asked before a presigned URL is minted too, so no URL is handed out for a file that cannot land.
    const audience = await organismVisibilityRefusal(storage, visibility, { identity: gaii, federated: isForeignPrincipal(req.auth) });
    if (audience) {
      res.status(audience.status).json(error(config.nodeId, audience.code, audience.message));
      return;
    }
    const wsRefStr = normalizeWorkspaceRefs(workspace_refs, workspaceRef);
    if (visibility === 'workspace' && !wsRefStr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility "workspace" requires workspace_refs (or workspaceRef) as one or more "<organismId>/<workspaceId>"'));
      return;
    }
    // Asked here because the presigned branch below mints its own token. The inline branch asks again at the shared write.
    const unbound = await groupBindingRefusal(storage, visibility, group_id);
    if (unbound) {
      res.status(unbound.status).json(error(config.nodeId, unbound.code, unbound.message));
      return;
    }
    // How the bytes were made: the same statement POST /v1/storage takes, decided by the shared write.
    const stated = storageProvenanceFromBody(req.body, gaii, 'rest.memory.files', req.auth!.scopes);
    if (!stated.ok) {
      res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE', 'The ai_provenance block does not validate.', undefined, { violations: stated.violations }));
      return;
    }
    // Making the file public asks the node's publish gate (plan doc-mvcn6c7e4e5q, V4), inline and presigned.
    const publishGate = { caller: callerOf(req, config.nodeId, storage), ...(req.auth!.app ? { app: req.auth!.app } : {}) };

    // ── PRESIGNED MODE: mint a one-shot URL, the caller PUTs the raw bytes to /v1/upload/:token ──
    // The bytes then skip body parsing entirely (server.ts excludes /v1/upload/), so the only ceiling
    // left is the one the operator actually set: quota.storage_max_file_size_mb.
    if (mode === 'presigned') {
      // A key a page origin serves asks what that page's own route asks, as the shared mint does.
      const pageRefused = await pageKeyWriteRefusal({ storage, config }, gaii, String(key), pageWriterOf({ storage, config }, publishGate));
      if (pageRefused) { res.status(pageRefused.status).json(error(config.nodeId, pageRefused.code, pageRefused.message)); return; }
      const refused = await storageProvenanceMintRefusal({ storage, config }, stated.provenance);
      if (refused) { res.status(refused.status).json(error(config.nodeId, refused.code, refused.message)); return; }
      // A closed node mints public at 'members' (plan V1.6), before the gate, as the shared mint does.
      const closed = await closedFileLevel({ storage, config }, gaii, String(key), (visibility as string | undefined) ?? 'private');
      // The label's audience cap (plan doc-mvdipuyqraas, L3.2): no URL for a file that could not land.
      const capped = await fileCapRefusal({ storage, config }, gaii, String(key), closed.visibility, wsRefStr || undefined, publishGate);
      if (capped) { res.status(capped.status).json(error(config.nodeId, capped.code, capped.message)); return; }
      // The requester rides in the token, so the upload files the request when the bytes land.
      const carry = await mintPublishCarry({ storage, config }, gaii, String(key), closed.visibility, publishGate);
      if (!carry.ok) { res.status(carry.status).json(error(config.nodeId, carry.code, carry.message)); return; }
      if (store) {
        const chosen = await resolveChoice({ storage, config }, gaii, store.id, { operator: store.operator });
        if (!chosen.ok) { res.status(chosen.status).json(error(config.nodeId, chosen.code, chosen.message)); return; }
      }
      const contentType = (mime_type as string) ?? 'application/octet-stream';
      const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
      const token = await generateUploadToken({
        sub: gaii,
        actor: gaii,
        utype: 'storage',
        meta: buildUploadMeta('storage', {
          key, mime_type: contentType, visibility: closed.visibility,
          group_id, tags, workspace_refs: wsRefStr,
          ai_provenance: stated.provenance.wireBlock, ai_provenance_id: stated.provenance.declaredId,
          publish_ask: carry.requester,
          store: store?.id,
          page_writer: pageWriterMeta(String(key), pageWriterOf({ storage, config }, publishGate)),
        }),
        maxBytes,
        contentType,
      });
      res.json(success(config.nodeId, {
        upload_url: `${config.baseUrl}/v1/upload/${token}`,
        upload_method: 'PUT',
        content_type: contentType,
        max_size_bytes: maxBytes,
        expires_in_seconds: 3600,
        ...closedNodeWarnings(closed.warning),
      }, [{ description: 'PUT the raw file bytes here', method: 'PUT', url: `/v1/upload/${token}` }]));
      return;
    }

    const fileData = decodeStrictBase64(content);
    if (!fileData) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content must be base64-encoded'));
      return;
    }

    // The per-file ceiling, the account quota, the overage charge, the change events and the
    // provenance decision are the shared write (services/storage-file-write.ts), as on
    // POST /v1/storage. This door wrote its own copy until 2026-10-08, which took no statement about
    // how the bytes were made.
    const parsedTags = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
    const written = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, gaii, {
      key,
      data: fileData,
      visibility: (visibility as StorageFileRecord['visibility']) ?? 'private',
      groupId: typeof group_id === 'string' ? group_id : undefined,
      workspaceRef: visibility === 'workspace' ? wsRefStr : undefined,
      mimeType: mime_type ?? 'application/octet-stream',
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      provenance: stated.provenance,
      publishGate,
      ...(store ? { store } : {}),
    });
    if (!written.ok) {
      res.status(written.status).json(error(config.nodeId, written.code, written.message));
      return;
    }
    const file = written.file;

    // 202 when the file was stored at the level it had and making it public waits for the owner.
    res.status(written.publishRequest ? 202 : 201).json(success(config.nodeId, {
      ...(written.publishRequest ? { publish_request: written.publishRequest } : {}),
      ...(written.warnings?.length ? { warnings: written.warnings } : {}),
      ...await uploadProvenanceBlock(storage, config, file.aiProvenanceId),
      key: file.key,
      // Where the bytes went: `database`, `node:<name>` or `own:<name>`.
      store: choiceIdOf(parseBlobRef(file.blobRef)?.storeId),
      owner_gaii: file.ownerGaii,   // so a client can build the owner-addressed /v1/pub/<owner>/<key> embed URL
      size: file.size,
      mime_type: file.mimeType,
      visibility: file.visibility,
      tags: file.tags || [],
      created_at: file.createdAt,
      // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file to
      // that workspace's members on save (never the public internet) — use it, not /v1/memory/files/<key>.
      embed_url: pubEmbedUrl(file.ownerGaii, file.key),
      embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
      // Point an app at this rather than embed_url: it changes on every write to the key, so a
      // re-upload is not served from a five-minute browser copy. embed_url stays unversioned
      // because the document image normaliser reads its path as owner plus key.
      versioned_url: versionedAddress(pubEmbedUrl(file.ownerGaii, file.key), file),
    }));
    // No change event from here: writeStorageFile tells the streams, scoped to the file's owner
    // when nobody else reads it.
  });

  // PATCH /v1/memory/files/:key/visibility — update file visibility
  // Registered BEFORE generic :key PATCH to avoid Express matching "key/visibility" as a single param
  router.patch('/v1/memory/files/:key/visibility', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { visibility, workspaceRef, workspace_refs } = req.body ?? {};

    // Full tier parity (was private/owner/public only). 'workspace' (re)binds the file to one or more
    // "<org>/<ws>" — this is how a file gets shared into an ADDITIONAL workspace: PATCH the full desired
    // list. requireExternalPrincipal (not requireRole('agent')) so an app/owner can rebind its OWN file.
    if (!isStoredVisibility(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `visibility must be one of: ${STORED_VISIBILITY_WORDS.join(', ')}, or "organism:<organism id>"`));
      return;
    }
    const wsRefStr = normalizeWorkspaceRefs(workspace_refs, workspaceRef);
    if (visibility === 'workspace' && !wsRefStr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility "workspace" requires workspace_refs (or workspaceRef) as one or more "<organismId>/<workspaceId>"'));
      return;
    }
    // The organism membership, the publish gate, the change and its event (global, because this path
    // does not read who could read the file until now): the shared changeStorageFileVisibility, which
    // PATCH /v1/storage/{key}/visibility and an approved publish request run too.
    const changed = await changeStorageFileVisibility({ storage, config }, gaii, key, visibility, {
      workspaceRef: wsRefStr, federated: isForeignPrincipal(req.auth),
      publishGate: { caller: callerOf(req, config.nodeId, storage), ...(req.auth!.app ? { app: req.auth!.app } : {}) },
    });
    if (!changed.ok) {
      res.status(changed.status).json(error(config.nodeId, changed.code, changed.message));
      return;
    }

    // 202 when the file keeps its level and making it public waits for the owner.
    res.status(changed.publishRequest ? 202 : 200).json(success(config.nodeId, {
      ...(changed.publishRequest ? { publish_request: changed.publishRequest } : {}),
      ...(changed.warnings?.length ? { warnings: changed.warnings } : {}),
      key: changed.file.key,
      visibility: changed.file.visibility,
    }));
  });

  // PATCH /v1/memory/files/:key — update file tags
  // Writing tags is a write, and the visibility door beside it has always said so.
  router.patch('/v1/memory/files/:key', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { tags } = req.body ?? {};

    if (!Array.isArray(tags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    if (tags.length > 20 || tags.some((t: unknown) => typeof t !== 'string' || (t as string).length > 64)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Max 20 tags, each max 64 characters'));
      return;
    }

    const updated = await storage.updateFileTagsByKey(gaii, key, tags);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      size: updated.size,
      mime_type: updated.mimeType,
      visibility: updated.visibility,
      tags: updated.tags || [],
      created_at: updated.createdAt,
    }));
    emitRecordChange('memory', updated.ownerGaii, updated.visibility);
  });

  // GET /v1/memory/files — list files (owner sees all agents' files + GHII files)
  // ...and listing them is a read, which GET /v1/memory/files/:key beside it has always said.
  router.get('/v1/memory/files', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
    // `!federated` (inside isOwnerInPerson) for the same reason /v1/work/sent has it: the owner branch builds the GHII from
    // the owner NAME, and a session signed in from another node carries the local part of THEIR
    // name — so a visitor called `alice` listed the local alice's files and every one of her
    // agents'. requireExternalPrincipal admits the `owner` role and asks nothing about which node
    // the session came from. A federated session falls to the else branch and sees its own identity
    // (its home GHII), which is what a visitor should see. Found by the AI triage of 2026-09-13.
    const isOwnerSession = isOwnerInPerson(req.auth);
    // The identities whose files are listed: the owner in person sees the GHII's and every agent's,
    // anyone else their own resolved identity, the one the upload, download and delete beside this
    // route write and read under (resolveIdentity; for an agent, an app or a visitor it is `sub`).
    const holders = isOwnerSession
      ? [`${req.auth!.owner as string}@${config.nodeId}`, ...(await storage.getAgentsByOwner(req.auth!.owner as string)).map(a => a.gaii)]
      : [resolve(req)];
    // Additive, for the Memory page: exclude_prefix leaves out the files under one key prefix (the
    // content class pipeline's own text files), and limit/offset hand out a page. `total` counts
    // every file that matched; without the parameters the answer is what it was.
    const excludePrefix = typeof req.query.exclude_prefix === 'string' ? req.query.exclude_prefix : '';

    // A count of every file is one aggregate over the same rows the listing reads (the page asks for
    // it after each change to state the upload limit); listing 1 700 files to take their number cost
    // about 110 ms at a heavy account's size.
    if (req.query.count === 'true' && !excludePrefix) {
      res.json(success(config.nodeId, {
        count: (await storage.sumStorageBytesForOwners(holders)).count,
        max_file_size_bytes: config.storageMaxFileSizeMb * 1024 * 1024,
      }));
      return;
    }

    // GHII's own files first, then each agent's, in ONE IN query: one query per agent, in turn,
    // was 81 at 79 agents.
    let files: Awaited<ReturnType<typeof storage.listStorageFiles>>;
    if (isOwnerSession) {
      const byOwner = await storage.listStorageFilesForOwners(holders);
      files = holders.flatMap(g => byOwner[g] ?? []);
    } else {
      files = await storage.listStorageFiles(holders[0]);
    }
    if (excludePrefix) files = files.filter(f => !f.key.startsWith(excludePrefix));
    // The classification reader, as the download beside this route and the MCP storage resource ask
    // it: a file this caller's read answers as absent is not named here either (storedFilesShownTo;
    // structure programme 2026-11, unit 7). With classification off it passes every file and reads nothing.
    files = await storedFilesShownTo({ storage, config }, readerFor({ storage, config }, req.auth), files);

    if (req.query.count === 'true') {
      res.json(success(config.nodeId, {
        count: files.length,
        max_file_size_bytes: config.storageMaxFileSizeMb * 1024 * 1024,
      }));
      return;
    }

    const total = files.length;
    const limit = req.query.limit !== undefined ? Math.min(1000, Math.max(1, parseInt(req.query.limit as string, 10) || 1)) : undefined;
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
    const page = limit !== undefined || offset ? files.slice(offset, limit !== undefined ? offset + limit : undefined) : files;

    res.json(success(config.nodeId, {
      ...(limit !== undefined || offset ? { limit: limit ?? null, offset } : {}),
      files: page.map(f => ({
        key: f.key,
        owner_gaii: f.ownerGaii,
        size: f.size,
        mime_type: f.mimeType,
        visibility: f.visibility,
        tags: f.tags || [],
        created_at: f.createdAt,
        // Where the bytes are: `database`, `node:<name>` or `own:<name>`.
        store: choiceIdOf(parseBlobRef(f.blobRef)?.storeId),
      })),
      total,
      // So a client can state the REAL limit instead of a hardcoded one. The upload form said
      // "Max 10MB per file" on a node configured for 50, which is the same lie from the other side
      // as the 10 MB the MCP tool used to mint.
      max_file_size_bytes: config.storageMaxFileSizeMb * 1024 * 1024,
    }));
  });

  // GET /v1/memory/files/:key — download file
  router.get('/v1/memory/files/:key', requireAuth(), requireExternalPrincipal(), requireScope('storage:read'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    // The classification reader (TARGET-082): a file this caller may not see answers as absent, and a
    // data package version's file asks the labels the version keeps too, as GET /v1/pub does.
    const stored = await storage.getStorageFile(gaii, key);
    const file = stored ? await storedFileShownTo({ storage, config }, readerFor({ storage, config }, req.auth), gaii, key, stored) : undefined;

    if (!file) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }

    res.setHeader('Content-Type', sniffedContentType(file.mimeType, file.data));
    res.setHeader('Content-Length', file.size);
    // How the bytes were made, as GET /v1/storage/{key} answers for the same file.
    setProvenanceHeaders(res, await loadServedProvenance(storage, config, file.aiProvenanceId, { full: true }));
    res.end(file.data);
  });

  // DELETE /v1/memory/files/:key — delete file
  //
  // TWO DOORS ONTO ONE DELETION, and only one of them was gated. Its twin,
  // DELETE /v1/storage/{*key}, has taken storage:write and run the shared removeStorageFile since
  // that service was written; this one took requireRole('agent') alone — which every agent satisfies
  // by being an agent — and reimplemented the deletion inline, so it also skipped the key fence that
  // stops an anonymous principal reaching outside `anonymous/`. Same word, same service, one
  // implementation.
  router.delete('/v1/memory/files/:key', requireAuth(), requireExternalPrincipal(), requireScope('storage:write'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;

    const removed = await removeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, gaii, key,
      { caller: callerOf(req, config.nodeId, storage), ...(req.auth!.app ? { app: req.auth!.app } : {}) });
    if (!removed.ok) {
      res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
      return;
    }

    res.json(success(config.nodeId, { deleted: key }));
    // The change event is removeStorageFile's, scoped as the write's is.
  });
}
