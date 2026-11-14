/**
 * @file src/auth/credential-strategies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credentials that are not a node session, verified in the auth layer instead of in
 *   each handler (codebase analysis 2026-11-03, item B8; security-architecture.md finding 7).
 *
 *   A route that takes such a credential declares it in its middleware chain:
 *
 *     router.post('/dsp/2025-1/negotiations/request', acceptCredential('dsp-participant', { config, process: 'negotiation' }), handler)
 *
 *   The strategy reads the request, verifies the credential with the one verifier its kind has, and
 *   either puts the typed principal on the request (`req.credential`, read with credentialOf()) and
 *   calls next(), or sends the refusal and ends the request. The handler no longer verifies anything.
 *
 *   SAME ANSWERS AS BEFORE. Each strategy is the helper its routes called first in their handler,
 *   moved here unchanged: the same verifier, the same status, the same body, the same log line. The
 *   middleware sits where the call was, after the route's body validation, so a request that failed
 *   either check before fails the same one now. test/unit/credential-strategies-table.test.ts holds the
 *   answers of the code before this file existed and compares every row.
 *
 *   NEVER req.auth. A participant, a party or a platform is not a node session. These paths are left
 *   alone by the global auth middleware (takesDataspaceCredential, takesPartyToken), and a strategy
 *   neither reads nor sets req.auth.
 *
 *   THE KINDS OF ANOTHER NODE (a federation peer, a package seller or claimant) are in
 *   ./credential-strategies-node.ts; the registry below names them like the others.
 * @structure CredentialPrincipals · StrategyOptions · acceptCredential(kind, options) · credentialOf(req, kind)
 * @usage
 *   router.get(path, acceptCredential('dsp-participant', { config, process: 'catalog' }), (req, res) => {
 *     const participant = credentialOf(req, 'dsp-participant');
 *   });
 * @version-history
 *   v1.6.0 — 2026-11-14 — 'secret-share-code' and 'secret-share-deposit' (services/secret-shares/): a
 *     share's pickup code and a request's deposit token, each with its one verifier.
 *   v1.5.0 — 2026-11-07 — 'receiver' (services/receivers/verify.ts): the route's :owner and :name and
 *     the key in the Authorization header.
 *   v1.4.0 — 2026-11-05 — 'intake-visitor', 'docsign-wallet', 'party-optional', and the kinds of another
 *     node ('federation-peer', 'package-seller', 'package-claimant'); a strategy may answer 'next-route'
 *     (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 *   v1.3.0 — 2026-11-04 — 'ucp-platform' and 'ucp-platform-signed': a UCP platform on the guest
 *     checkout, and ucpRawBody (codebase analysis 2026-11-03, item B8).
 *   v1.2.0 — 2026-11-04 — 'app-party': a person registered to one app (codebase analysis 2026-11-03, item B8).
 *   v1.1.0 — 2026-11-04 — 'party': an outside party on /v1/parties/me* (codebase analysis 2026-11-03, item B8).
 *   v1.0.0 — 2026-11-04 — Initial: the Dataspace Protocol participant (codebase analysis 2026-11-03, item B8).
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CredentialKind } from './credential-kinds.js';
import { error } from '../middleware/envelope.js';
import { verifyDspRequest, type Participant } from '../services/dataspace/verifier.js';
import { catalogError, negotiationError, transferError } from '../services/dataspace/contract.js';
import { partyCredentialOf, verifyParty, type PartyContext } from '../services/parties/verify.js';
import { appPartyFromRequest, type AppPartyCtx } from '../services/app-parties/service.js';
import { parseUcpAgent, platformProfile } from '../services/ucp/platform-profile.js';
import { verifyMessage } from '../services/ucp/http-signatures.js';
import { visitorThread, type VisitorThread } from '../services/intake/visitor-thread.js';
import { walletSessionFor, openWalletSessionByState, type WalletSession } from '../services/docsign/eudi.js';
import { DocsignError } from '../services/docsign/records.js';
import { verifyReceiverRequest, type ReceiverContext } from '../services/receivers/verify.js';
import { verifyShareCode } from '../services/secret-shares/pickup.js';
import { verifyDepositToken } from '../services/secret-shares/service.js';
import { logger } from '../utils/logger.js';
import {
    federationPeer, packageSeller, packageClaimant,
    type FederationPeer, type FederationPeerOptions, type PackageSeller, type PackageClaimant, type Verdict,
} from './credential-strategies-node.js';

/** The principal each kind puts on the request. */
export interface CredentialPrincipals {
    'dsp-participant': Participant;
    party: PartyContext;
    'app-party': AppPartyCtx;
    'ucp-platform': UcpPlatform;
    'ucp-platform-signed': UcpPlatform;
    'intake-visitor': VisitorThread;
    'docsign-wallet': WalletSession;
    /** `party` is null for a buyer who presented no party credential. */
    'party-optional': { party: PartyContext | null };
    'federation-peer': FederationPeer;
    'package-seller': PackageSeller;
    'package-claimant': PackageClaimant;
    receiver: ReceiverContext;
    'secret-share-code': { shareId: string };
    'secret-share-deposit': { shareId: string };
}

/** A UCP platform: the profile its UCP-Agent header names, whose keys verified the signature when one was sent. */
export interface UcpPlatform { profileUrl: string }

/** What each kind's strategy is built with at the route. */
export interface StrategyOptions {
    /** `process` picks the DSP error body: a catalog error, or a negotiation or transfer error naming the :pid. */
    'dsp-participant': { config: AimeatConfig; process: 'catalog' | 'negotiation' | 'transfer' };
    party: { storage: Storage; config: AimeatConfig };
    /** The app is the route's :owner and :filename. */
    'app-party': { storage: Storage; config: AimeatConfig };
    'ucp-platform': { config: AimeatConfig };
    'ucp-platform-signed': { config: AimeatConfig };
    /** The form is the route's :org, :ws and :formId; the token is the body's `token`. */
    'intake-visitor': { storage: Storage; config: AimeatConfig };
    /**
     * What the wallet presents: `session` the :session alone (the request object), `document` the
     * :session and its :token, `state` the :session and the form's state, `by-state` the form's state alone.
     */
    'docsign-wallet': { config: AimeatConfig; proof: 'session' | 'document' | 'state' | 'by-state' };
    'party-optional': { storage: Storage; config: AimeatConfig };
    'federation-peer': FederationPeerOptions;
    'package-seller': { storage: Storage; config: AimeatConfig; peers: FederationPeerOptions['peers'] };
    'package-claimant': { config: AimeatConfig; purpose: string };
    /** The receiver is the route's :owner and :name; the key is the Authorization header's. */
    receiver: { storage: Storage; config: AimeatConfig };
    /** The share is the route's :id; the code is the body's `code` or `code_verifier`. */
    'secret-share-code': { storage: Storage; config: AimeatConfig };
    /** The request is the route's :id; the token is the body's `token`. */
    'secret-share-deposit': { storage: Storage; config: AimeatConfig };
}

/** A principal on the request, tagged with its kind. */
export type AcceptedCredential = { [K in CredentialKind]: { kind: K; principal: CredentialPrincipals[K] } }[CredentialKind];

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /** Set by acceptCredential() when the route's declared credential verified. */
            credential?: AcceptedCredential;
        }
    }
}

/**
 * Verifies one request: the principal, null when the refusal has been sent, or 'next-route' when the
 * request is for the next route with the same path (a federation door's operator twin).
 */
type Verify<K extends CredentialKind> = (req: Request, res: Response) => Promise<Verdict<CredentialPrincipals[K]>>;
type Strategy<K extends CredentialKind> = (options: StrategyOptions[K]) => Verify<K>;

/** The Dataspace Protocol participant (was participantOf() in routes/dsp/index.ts). */
const dspParticipant: Strategy<'dsp-participant'> = ({ config, process }) => async (req, res) => {
    const v = await verifyDspRequest(config, req.headers.authorization);
    if (v.ok) return v.participant;
    logger.info('dataspace: a DSP request was refused its credential', { path: req.path, reason: v.reason });
    const pid = String(req.params.pid ?? '');
    res.status(401).json(process === 'catalog'
        ? catalogError('UNAUTHORIZED', v.reason)
        : process === 'negotiation' ? negotiationError(pid, '', 'UNAUTHORIZED', v.reason) : transferError(pid, '', 'UNAUTHORIZED', v.reason));
    return null;
};

/** An outside party of an owner (was partyOf() in routes/parties.ts). */
const outsideParty: Strategy<'party'> = (deps) => async (req, res) => {
    const cred = partyCredentialOf(req);
    if (!cred) {
        res.status(401).json(error(deps.config.nodeId, 'AUTH_REQUIRED', 'Sign in with the name and the key the owner gave you.', undefined, {
            basic_user: '<owner>/<party name>', basic_password: 'the party key', token_endpoint: '/v1/parties/token',
        }));
        return null;
    }
    const v = await verifyParty(deps, cred);
    if (!v.ok) { res.status(v.status).json(error(deps.config.nodeId, v.code, v.message)); return null; }
    return v.ctx;
};

/**
 * A person registered to the app the route names, without an account (was partyOf() in
 * routes/app-parties.ts). An admitted request is marked private, no-store, as it was there.
 */
const appParty: Strategy<'app-party'> = (deps) => async (req, res) => {
    const ref = { owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') };
    const v = await appPartyFromRequest(deps, ref, req);
    if (!v.ok) { res.status(v.status).json(error(deps.config.nodeId, v.code, v.message)); return null; }
    res.setHeader('Cache-Control', 'private, no-store');
    return v.ctx;
};

/** The raw body as it arrived, for the digest a UCP signature covers (server.ts keeps it on /ucp/ paths). */
export function ucpRawBody(req: Request): Buffer | null {
    const r = (req as Request & { rawBody?: Buffer }).rawBody;
    if (Buffer.isBuffer(r)) return r;
    return req.body && Object.keys(req.body as object).length ? Buffer.from(JSON.stringify(req.body)) : null;
}

/**
 * A UCP 2026-08-25 platform (was platformOf() in routes/ucp-checkout.ts): the profile UCP-Agent names,
 * after the signature, when the request has one, checked out against that profile's keys. `mustSign`
 * refuses an unsigned request. The checkout's own switch is read first, as it was: with commerce off
 * every endpoint answers 503 whatever the request carries. Answers are UCP protocol errors, `{ code, content }`.
 */
const ucpPlatform = (mustSign: boolean) => ({ config }: { config: AimeatConfig }): ((req: Request, res: Response) => Promise<UcpPlatform | null>) => {
    // Read once when the route is built, as the router did.
    const allowHttp = config.baseUrl.startsWith('http://');
    return async (req, res) => {
        const protocolError = (status: number, code: string, content: string): null => { res.status(status).json({ code, content }); return null; };
        if (!config.commerceEnabled) return protocolError(503, 'unavailable', 'Checkout is switched off on this node.');
        const profileUrl = parseUcpAgent(req.get('ucp-agent'), allowHttp);
        if (!profileUrl) return protocolError(400, 'invalid_profile_url', 'UCP-Agent must name the platform profile: profile="https://…".');
        const signed = req.get('signature-input') !== undefined || req.get('signature') !== undefined;
        if (!signed && mustSign) return protocolError(401, 'signature_missing', 'This request must be signed by the platform (RFC 9421).');
        if (signed) {
            const profile = await platformProfile(profileUrl);
            if (!profile) return protocolError(424, 'profile_unreachable', 'The platform profile could not be fetched to check the signature.');
            const headers: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
            const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            const r = verifyMessage({ method: req.method, url, headers }, ucpRawBody(req), profile.keys);
            if (!r.ok) return protocolError(r.code === 'digest_mismatch' || r.code === 'algorithm_unsupported' ? 400 : 401, r.code, 'The request signature did not verify.');
        }
        return { profileUrl };
    };
};

/**
 * A visitor's conversation through a public intake form (was the first lines of thread/read and
 * thread/forget in routes/organisms/intake-thread.ts): one 404 for an unknown form, a form that takes
 * no conversation, a token that opens nothing and another form's conversation.
 */
const intakeVisitor: Strategy<'intake-visitor'> = ({ storage, config }) => async (req, res) => {
    const at = { org: String(req.params.org ?? ''), ws: String(req.params.ws ?? ''), formId: String(req.params.formId ?? '') };
    const opened = await visitorThread(storage, config.nodeId, at, ((req.body ?? {}) as Record<string, unknown>).token);
    if (opened) return opened;
    res.status(404).json(error(config.nodeId, 'THREAD_NOT_FOUND', 'No conversation opens with this token.', 404));
    return null;
};

/**
 * An EU Digital Identity Wallet in a signing session (was the first lines of walletRequestObject,
 * walletDocument, receiveWalletResponse and the by-state answer in routes/docsign-wallet.ts). Answered
 * as the routes answer a DocsignError.
 */
const docsignWallet: Strategy<'docsign-wallet'> = ({ config, proof }) => async (req, res) => {
    const form = (req.body ?? {}) as Record<string, unknown>;
    if (proof === 'by-state') {
        const s = openWalletSessionByState(form);
        if (!s) res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No open wallet session has that state.'));
        return s;
    }
    try {
        return walletSessionFor(String(req.params.session ?? ''), proof === 'document'
            ? { kind: 'document', token: String(req.params.token ?? '') }
            : proof === 'state' ? { kind: 'state', form } : { kind: 'open' });
    } catch (err) {
        if (err instanceof DocsignError) res.status(err.status).json(error(config.nodeId, err.code, err.message));
        else res.status(500).json(error(config.nodeId, 'DOCSIGN_ERROR', err instanceof Error ? err.message : String(err)));
        return null;
    }
};

/**
 * An outside party buying again, or a buyer with none (was the start of POST
 * /v1/exchange/offerings/:id/buy): a party credential that names no live party is refused as on the
 * party's own doors, and a request with none passes with `party: null`.
 */
const partyOptional: Strategy<'party-optional'> = (deps) => async (req, res) => {
    const cred = partyCredentialOf(req);
    if (!cred) return { party: null };
    const v = await verifyParty(deps, cred);
    if (!v.ok) { res.status(v.status).json(error(deps.config.nodeId, v.code, v.message)); return null; }
    return { party: v.ctx };
};

/** An outside program's key for one receiver (services/receivers/verify.ts, the one verifier). */
const receiverKey: Strategy<'receiver'> = deps => async (req, res) => {
    const v = await verifyReceiverRequest(deps, {
        authorization: req.headers.authorization,
        owner: String(req.params.owner ?? ''),
        name: String(req.params.name ?? ''),
        keyInAddress: typeof req.query?.key === 'string' || typeof req.query?.token === 'string',
        method: req.method,
    });
    if (v.ok) return v.ctx;
    if (v.status === 401) res.set('WWW-Authenticate', 'Bearer realm="receiver"');
    res.status(v.status).json(error(deps.config.nodeId, v.code, v.message));
    return null;
};

/** A secret share's pickup code (services/secret-shares/pickup.ts verifyShareCode, the one verifier). */
const secretShareCode: Strategy<'secret-share-code'> = deps => async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const offered = typeof body.code === 'string' ? body.code : typeof body.code_verifier === 'string' ? body.code_verifier : '';
    const v = await verifyShareCode(deps, String(req.params.id ?? ''), offered, req.ip ?? '', null);
    if (v.ok) return { shareId: v.share.id };
    res.status(v.status).json(error(deps.config.nodeId, v.code, v.message));
    return null;
};

/** A secret request's deposit token (services/secret-shares/service.ts verifyDepositToken, the one verifier). */
const secretShareDeposit: Strategy<'secret-share-deposit'> = deps => async (req, res) => {
    const token = (req.body as Record<string, unknown> | undefined)?.token;
    const share = await verifyDepositToken(deps, String(req.params.id ?? ''), typeof token === 'string' ? token : '');
    if (share) return { shareId: share.id };
    res.status(404).json(error(deps.config.nodeId, 'NOT_FOUND', 'No such secret request, or the link is not valid.'));
    return null;
};

const STRATEGIES: { [K in CredentialKind]: Strategy<K> } = {
    receiver: receiverKey,
    'secret-share-code': secretShareCode,
    'secret-share-deposit': secretShareDeposit,
    'dsp-participant': dspParticipant,
    party: outsideParty,
    'app-party': appParty,
    'ucp-platform': ucpPlatform(false),
    'ucp-platform-signed': ucpPlatform(true),
    'intake-visitor': intakeVisitor,
    'docsign-wallet': docsignWallet,
    'party-optional': partyOptional,
    'federation-peer': federationPeer,
    'package-seller': packageSeller,
    'package-claimant': packageClaimant,
};

/**
 * The middleware that admits a request carrying a verified credential of `kind`. A refusal is sent by
 * the strategy and the chain stops; a verifier that throws reaches the error handler as the same throw
 * from the handler did.
 */
export function acceptCredential<K extends CredentialKind>(kind: K, options: StrategyOptions[K]) {
    const verify = (STRATEGIES[kind] as Strategy<K>)(options);
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const principal = await verify(req, res);
        if (principal === null) return;
        if (principal === 'next-route') { next('route'); return; }
        req.credential = { kind, principal } as AcceptedCredential;
        next();
    };
}

/**
 * The principal acceptCredential(kind) put on this request. Throws when the route declared no such
 * strategy: that is a wiring mistake in the route file, and a 500 is the right answer to it.
 */
export function credentialOf<K extends CredentialKind>(req: Request, kind: K): CredentialPrincipals[K] {
    const c = req.credential;
    if (!c || c.kind !== kind) throw new Error(`credentialOf: this route declares no acceptCredential('${kind}')`);
    return c.principal as CredentialPrincipals[K];
}
