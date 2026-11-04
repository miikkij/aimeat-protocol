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
 * @structure CredentialPrincipals · StrategyOptions · acceptCredential(kind, options) · credentialOf(req, kind)
 * @usage
 *   router.get(path, acceptCredential('dsp-participant', { config, process: 'catalog' }), (req, res) => {
 *     const participant = credentialOf(req, 'dsp-participant');
 *   });
 * @version-history
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
import { logger } from '../utils/logger.js';

/** The principal each kind puts on the request. */
export interface CredentialPrincipals {
    'dsp-participant': Participant;
    party: PartyContext;
}

/** What each kind's strategy is built with at the route. */
export interface StrategyOptions {
    /** `process` picks the DSP error body: a catalog error, or a negotiation or transfer error naming the :pid. */
    'dsp-participant': { config: AimeatConfig; process: 'catalog' | 'negotiation' | 'transfer' };
    party: { storage: Storage; config: AimeatConfig };
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

/** Verifies one request: the principal, or null when the refusal has been sent. */
type Verify<K extends CredentialKind> = (req: Request, res: Response) => Promise<CredentialPrincipals[K] | null>;
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

const STRATEGIES: { [K in CredentialKind]: Strategy<K> } = {
    'dsp-participant': dspParticipant,
    party: outsideParty,
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
