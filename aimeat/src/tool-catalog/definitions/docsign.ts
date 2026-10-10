/**
 * @file docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Document signing and signature validation: check the signatures on a signed PDF or
 *   CMS file, look up who signed a document on this node, and create, read, sign and cancel AIMEAT
 *   signing requests. One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by
 *   definitions.ts.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — aimeat_docsign_wallet_start and aimeat_docsign_wallet_status: signing with
 *     an EU Digital Identity Wallet (wish-allekirjoitus-eudi-lompakolla).
 *   v1.2.0 — 2026-10-10 — aimeat_docsign_wallet_start's storage_key is optional.
 *   v1.3.0 — 2026-10-10 — aimeat_docsign_delete.
 */

import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

const SHA256 = z.string().regex(/^[0-9a-fA-F]{64}$/);

export const docsignTools = [
    {
        name: 'aimeat_docsign_validate',
        description: "Check whether a signed document's digital signatures are valid. Reads a PDF (PAdES and adbe.pkcs7 signatures, document timestamps), an attached CMS file (.p7m), or a detached .p7s with the document it signs; any other file is reported as unsigned and still looked up by its hash. Each signature gets a verdict in the ETSI terms (valid, invalid, indeterminate) with reason codes and a one-line summary to repeat, the signer and issuer, the signing time and what proves it (a qualified timestamp, a timestamp, or only the signer's own claim), whether the file was changed after signing, the certificate chain and whether it reaches an EU trusted list (with the provider and its status at signing time), the revocation status (OCSP or CRL), and the eIDAS level: `qualified` is a qualified electronic signature or seal. `aimeat` lists the AIMEAT signatures this node holds for the same document. Pass the file you uploaded with aimeat_storage_upload as storage_key (preferred, nothing large passes through you), or a small file as content_base64. Tell the person the verdict and the summary in plain words; explain an `indeterminate` as 'could not be confirmed', not as forged.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Validate Document Signatures', readOnlyHint: true, openWorldHint: true },
        surfaces: ['agent'],
        input: {
            storage_key: { type: 'string', description: 'Key of the signed file in your storage (aimeat_storage_upload). For a .p7s, the signature file.', zod: z.string().max(1024) },
            document_storage_key: { type: 'string', description: 'For a detached .p7s: the key of the document it signs.', zod: z.string().max(1024) },
            content_base64: { type: 'string', description: 'The file itself, base64. Only for small files; use storage_key otherwise.' },
            online: { type: 'boolean', description: 'false: do not reach trusted lists, OCSP or CRLs for this check. Default true.' },
        },
    },
    {
        name: 'aimeat_docsign_lookup',
        description: "Who signed this document with AIMEAT on this node, by the document's SHA-256. Public: anyone holding the document can check, with or without an account. Returns each signing request for that hash with the signatures given (signer, name, time, method, identity assurance, and whether the signature and the node's seal verify). Requests nobody has signed, and cancelled ones, are not shown, and neither are the parties who have yet to sign. Use aimeat_docsign_validate instead when you have the file itself: it also checks signatures embedded in the file.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Look Up AIMEAT Signatures', readOnlyHint: true, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            sha256: { type: 'string', required: true, description: 'The SHA-256 of the document, 64 hex characters.', zod: SHA256 },
        },
    },
    {
        name: 'aimeat_docsign_request_create',
        description: "Ask people (and agents) on this node to sign a document with AIMEAT. Name the document by a file in your storage (storage_key: the node hashes it) or as `document` with its SHA-256, name and size; and the parties, 1 to 10 identities on this node (people as name@node, agents as agent#name@node). You, or the person you act for, must be a party. Each person is notified and signs in the signing app with their passkey; an agent signs with aimeat_docsign_sign. The document itself is not stored by this request, only its hash: whoever later checks a copy proves it is the same file by its hash. Returns the request with its id.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create a Signing Request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            title: { type: 'string', description: 'What is being signed, in the words the parties use (e.g. "Lease agreement, flat A1").', zod: z.string().max(200) },
            message: { type: 'string', description: 'A note to the parties.', zod: z.string().max(2000) },
            storage_key: { type: 'string', description: 'The document in your storage; its hash, name and size are read from it.', zod: z.string().max(1024) },
            document: {
                type: 'object', description: 'The document when it is not in your storage: { sha256, name, size, media_type? }.',
                zod: z.object({ sha256: SHA256, name: z.string().min(1).max(255), size: z.number().int().min(0), media_type: z.string().max(120).optional() }),
            },
            parties: { type: 'array', required: true, description: 'Who signs: 1 to 10 identities on this node.', zod: z.array(z.string().min(3).max(300)).min(1).max(10) },
        },
    },
    {
        name: 'aimeat_docsign_requests',
        description: "The signing requests you are a party to or created, and those of the person you act for, newest first. `state`: open, complete, cancelled, or waiting-for-me (open and not yet signed by you). Each carries the document, the parties and the signatures given.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Signing Requests', readOnlyHint: true, openWorldHint: false },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            state: { type: 'string', description: 'Filter by state.', enum: ['open', 'complete', 'cancelled', 'waiting-for-me'] },
        },
    },
    {
        name: 'aimeat_docsign_request_get',
        description: 'One signing request, with every signature checked again: the statement matches the request and document, the node seal verifies with this node key, and the signer evidence (passkey assertion or key signature) verifies. `valid` is all three.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read a Signing Request', readOnlyHint: true, openWorldHint: false },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
        },
    },
    {
        name: 'aimeat_docsign_sign',
        description: "Sign a request as YOURSELF, the agent: never as the person you act for. A person signs in the signing app with their passkey, because a signature is their own act; give them the link instead. method `session`: the node seals that this authenticated agent confirmed. method `key`: also sign the exact string `aimeat-docsign:v1:{id}:{sha256}:{your identity}` with your registered Ed25519 key and pass the base64 signature, which anyone can check without this node. You must be a listed party.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Sign as This Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
            method: { type: 'string', required: true, description: 'session or key.', enum: ['session', 'key'] },
            signature: { type: 'string', description: 'For method key: the base64 Ed25519 signature.', zod: z.string().min(16).max(2000) },
        },
    },
    {
        name: 'aimeat_docsign_cancel',
        description: 'Cancel an open signing request you created (or one your agent created for you). Signatures already given stay in the record; nobody can sign it any more, and the hash lookup stops showing it.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Cancel a Signing Request', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
        },
    },
    {
        name: 'aimeat_docsign_delete',
        description: 'Delete a signing request nobody has signed: a draft, a mistake or a test you created (or your agent created for you). It leaves every list, and the files the node stored for it go too (the PDF kept for wallet signing, a PDF a wallet returned and the node refused). A request that carries a signature is a record and is refused with HAS_SIGNATURES: cancel that one instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete an Unsigned Signing Request', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
        },
    },
    {
        name: 'aimeat_docsign_wallet_start',
        description: "Start a signature with an EU Digital Identity Wallet for the person you act for, on a signing request they are a party to. The wallet makes the signature itself (PAdES, through its own trust service provider) after the person confirms on their phone; you only prepare it. When the request was made from a stored file, leave storage_key out: the node uses the PDF it holds, and after a wallet signature the newest signed PDF. Otherwise pass the PDF as storage_key: the request's own document, or, once someone has signed with a wallet, the signed PDF (the request's `walletDocument`). Returns `wallet_link`: give it to the person to open on the phone that holds the wallet, or show it as a QR code the wallet scans. It works for 15 minutes; follow it with aimeat_docsign_wallet_status. Today this is the EU reference wallet (Android) with test certificates: the result is a test signature with no legal effect, and the answer says so. Check aimeat_docsign_request_get afterwards: the signature has method `eudi-wallet`, and the signed PDF is in the person's files.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Start a Wallet Signature', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
            storage_key: { type: 'string', description: 'The PDF in your storage (aimeat_storage_upload): the document the request names, or its latest wallet-signed version. Leave it out when the node holds the PDF (the request was made from a stored file).', zod: z.string().max(1024) },
        },
    },
    {
        name: 'aimeat_docsign_wallet_status',
        description: "How a wallet signature you started stands: waiting (the link has not been opened), fetched (the wallet has the document), signed, failed (with the reason, such as the person cancelling), or expired.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Wallet Signature Status', readOnlyHint: true, openWorldHint: false },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The request id (ds-…).', zod: z.string().max(60) },
            session_id: { type: 'string', required: true, description: 'The session_id aimeat_docsign_wallet_start returned.', zod: z.string().max(64) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
