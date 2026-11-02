/**
 * @file src/services/parties/invite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time share link (plan doc-mvwxcas3dom3, D3.4; canvas boards Jako "Jaa ja lähetä
 *   linkki" and Vastaanottaja): the owner sends a share to the party's e-mail, the recipient opens the
 *   link with no account, accepts the terms, takes a key that is made at that moment, and downloads the
 *   connection file.
 *
 *   THE CODE. `<owner>.<32 random bytes, base64url>`: the owner part says whose `parties` record holds
 *   the link (base64url has no dot, so the last dot splits it), and only the SHA-256 of the whole code
 *   is stored, on the party (PartyInvite in ./contract.ts). It expires with the share or 14 days after it
 *   was made, whichever is first. A new link for the same share replaces an unused earlier one.
 *
 *   THE CODE IS NEVER A READ CREDENTIAL. It is not a key (no key hash matches it, so `?key=` and Basic
 *   refuse it), not a party token (no `aimeat_party_` prefix) and not a session (no signature). It opens
 *   two endpoints only: the preview (who shared what, until when) and the redemption.
 *
 *   REDEEMING ROTATES. The redemption makes a NEW key, so the owner never held the key the recipient
 *   uses: the keys of the party that were never used and are older than the link (the key the owner saw
 *   when sharing) are retired, and so is the key an earlier link of the same share made. One CAS write
 *   on the `parties` record marks the link used and changes the keys, so a second redemption, even a
 *   concurrent one, is refused (410 INVITE_USED). The answer is the party's view, the key (shown once),
 *   the connection file and a party token of PARTY_TOKEN_TTL_SECONDS for the page's next calls.
 *
 *   THE MAIL. Plain text through the node's mail service, in the language the owner's page asks for
 *   (en, fi, es): who shared what, until when, for what, and the link. When the node sends no mail the
 *   answer says `sent: false` and carries the link, so the owner can pass it on another way. The owner
 *   always gets the link back: they could make a key for the party themselves anyway.
 * @structure INVITE_TTL_DAYS · inviteLinkOf · sendShareLink · shareAndSend · previewInvite · redeemInvite
 * @usage const out = await sendShareLink(ctx, 'matti', { share, email, locale });
 * @version-history
 *   v1.1.0 — 2026-11-01 — The page's package carries the licence's deed (`licence_url`), the
 *     attribution and the words per language (`i18n`) (WP10e A2, A3).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { getActiveEmailService } from '../email.js';
import { logger } from '../../utils/logger.js';
import { EMAIL_RE } from '../datapackage/share-notices.js';
import { packageFreshness } from '../datapackage/freshness-read.js';
import { licenceUrlOf } from '../datapackage/licences.js';
import type { PackageI18n } from '../datapackage/contract.js';
import { MAX_KEYS_PER_PARTY, PARTY_MANAGE_SCOPE, PARTY_TOKEN_TTL_SECONDS, partyRefOf, type PartyInvite, type PartyRecord } from './contract.js';
import { newPartyKey, newPartyKeyId } from './keys.js';
import { changeParty, findParty, readParties } from './store.js';
import { mintPartyToken } from './token.js';
import { connectionFileOf, descriptorFor, isLiveShare, packageOfPattern, partySharesOf, setShareMeta, shareMetaOf, shareView } from './shares.js';
import { shareWithParty, type PartyAnswer, type PartyServiceCtx } from './service.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Refusal = Extract<PartyAnswer<never>, { ok: false }>;
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

/** How long a link works at most; a share that ends sooner ends it sooner. */
export const INVITE_TTL_DAYS = 14;
/** How many links one party keeps; the oldest go first. */
const MAX_INVITES_PER_PARTY = 20;
const OWNER_PART_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,64}$/;

const hashOf = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex');
const sameHash = (a: string, b: string): boolean => {
    const x = Buffer.from(a, 'hex');
    const y = Buffer.from(b, 'hex');
    return x.length === 32 && y.length === 32 && timingSafeEqual(x, y);
};

/** The recipient page's address for a code. */
export function inviteLinkOf(config: AimeatConfig, code: string): string {
    return `${config.baseUrl.replace(/\/+$/, '')}/v1/shared-data?invite=${encodeURIComponent(code)}`;
}

// ── The mail, in the language the owner's page asks for ──

type Locale = 'en' | 'fi' | 'es';
interface MailFacts { who: string; owner: string; title: string; until: string; purpose: string; link: string; linkUntil: string }
const MAIL: Record<Locale, { subject: (f: MailFacts) => string; body: (f: MailFacts) => string }> = {
    en: {
        subject: f => `${f.owner} shared the data "${f.title}" with you`,
        body: f => `Hello ${f.who},\n\n${f.owner} shared the data "${f.title}" with you until ${f.until}. The purpose is: ${f.purpose}\n\n`
            + `Open this link to accept the terms and take your key. You do not need an account.\n${f.link}\n\n`
            + `The link works once, until ${f.linkUntil}. ${f.owner} sees when you read the data and can end the share at any time.\n`,
    },
    fi: {
        subject: f => `${f.owner} jakoi sinulle datan "${f.title}"`,
        body: f => `Hei ${f.who},\n\n${f.owner} jakoi sinulle datan "${f.title}" ${f.until} asti. Käyttötarkoitus: ${f.purpose}\n\n`
            + `Avaa tämä linkki, hyväksy ehdot ja ota avain talteen. Et tarvitse tiliä.\n${f.link}\n\n`
            + `Linkki toimii kerran ${f.linkUntil} asti. ${f.owner} näkee, milloin luet dataa, ja voi lopettaa jaon milloin tahansa.\n`,
    },
    es: {
        subject: f => `${f.owner} ha compartido contigo los datos "${f.title}"`,
        body: f => `Hola ${f.who}:\n\n${f.owner} ha compartido contigo los datos "${f.title}" hasta el ${f.until}. La finalidad es: ${f.purpose}\n\n`
            + `Abre este enlace para aceptar las condiciones y guardar tu clave. No necesitas una cuenta.\n${f.link}\n\n`
            + `El enlace funciona una sola vez, hasta el ${f.linkUntil}. ${f.owner} ve cuándo lees los datos y puede terminar el acceso en cualquier momento.\n`,
    },
};
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');

/** The owner's name as the recipient reads it: the profile's display name, else the account name. */
async function ownerNameOf(storage: Storage, account: string): Promise<string> {
    try {
        return (await storage.getGHIIByOwner(account))?.displayName || account;
    } catch (err) {
        logger.warn('party invite: the owner\'s display name could not be read', { error: String(err) });
        return account;
    }
}

/**
 * Send (or send again) the one-time link of one share to the party's e-mail. The caller is the owner
 * in person or holds party:manage; the share is one of this party's, live, and not to a visitor. The
 * address is `email`, else the party's contact; a person party with no contact keeps the address as
 * its contact. Every check comes before the write.
 */
export async function sendShareLink(
    ctx: { deps: Deps; caller: CallerContext }, name: string, body: { share?: unknown; email?: unknown; locale?: unknown },
): Promise<PartyAnswer<Record<string, unknown>>> {
    const { storage, config } = ctx.deps;
    const c = ctx.caller;
    if (c.visitor || c.kind === 'anonymous') return refuse(403, 'FORBIDDEN', 'Outside parties belong to an account of this node. Sign in to your own account.');
    if (!c.has(PARTY_MANAGE_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Sending a share link needs the "${PARTY_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page.`);
    const party = await findParty(storage, c.ownerGhii, name);
    if (!party) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    if (party.status !== 'active') return refuse(409, 'PARTY_STOPPED', `The party "${name}" is stopped. Resume it before you send it a link.`);
    if (party.kind === 'dataspace') return refuse(409, 'INVALID_INPUT', 'A data space participant connects with its own credential and takes no link.');
    const shareId = typeof body.share === 'string' ? body.share.trim() : '';
    const shares = await partySharesOf(storage, c.ownerGhii, party, config.nodeId);
    const share = shareId ? shares.find(s => s.id === shareId) : shares.filter(s => isLiveShare(s)).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))[0];
    if (!share) return refuse(404, 'NOT_FOUND', shareId ? `The party "${name}" holds no share ${shareId}.` : `The party "${name}" holds no live share.`);
    if (!isLiveShare(share)) return refuse(409, 'SHARE_ENDED', 'This share has ended. Share the data again before you send a link.');
    const email = (typeof body.email === 'string' && body.email.trim() ? body.email.trim() : party.contact?.trim()) ?? '';
    if (!email || !EMAIL_RE.test(email) || email.length > 320) {
        return refuse(400, 'EMAIL_REQUIRED', 'Give the e-mail address the link goes to (email), or set it as the party\'s contact.');
    }
    const locale: Locale = body.locale === 'fi' || body.locale === 'es' ? body.locale : 'en';

    const code = `${c.owner}.${randomBytes(32).toString('base64url')}`;
    const now = Date.now();
    const expiresAt = new Date(Math.min(now + INVITE_TTL_DAYS * 86_400_000, share.expires ? Date.parse(share.expires) : Infinity)).toISOString();
    const invite: PartyInvite = {
        id: `inv_${randomBytes(6).toString('hex')}`, hash: hashOf(code), share: share.id,
        createdAt: new Date(now).toISOString(), expiresAt, createdBy: c.principal, usedAt: null,
    };
    const after = await changeParty(storage, c.ownerGhii, name, p => {
        if (p.uid !== party.uid) return UNCHANGED;
        // An unused earlier link of the same share stops working: the newest link is the one that counts.
        const kept = (p.shareLinks ?? []).filter(i => !(i.share === share.id && !i.usedAt));
        return {
            ...p, shareLinks: [...kept, invite].slice(-MAX_INVITES_PER_PARTY),
            ...(!p.contact ? { contact: email } : {}),
        };
    });
    if (!after || after.uid !== party.uid) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    emitChange('consent', c.ownerGhii);

    const link = inviteLinkOf(config, code);
    const pkg = packageOfPattern(share.dataPattern) ?? '';
    const d = await descriptorFor(storage, c.ownerGhii, pkg, shareMetaOf(share).pinnedVersion);
    const facts: MailFacts = {
        who: party.displayName || party.name, owner: await ownerNameOf(storage, c.owner), title: d?.title || pkg,
        until: day(share.expires), purpose: share.purpose, link, linkUntil: day(expiresAt),
    };
    let sent = false;
    const mail = getActiveEmailService();
    if (mail?.enabled) {
        try {
            sent = await mail.sendNotification(email, MAIL[locale].subject(facts), MAIL[locale].body(facts));
        } catch (err) {
            logger.warn('party invite: the link could not be mailed', { owner: c.ownerGhii, party: name, error: String(err) });
        }
    }
    return {
        ok: true, data: {
            sent, to: email, link, invite_id: invite.id, share: share.id, expires_at: expiresAt,
            note: sent
                ? 'The link is on its way. It works once; the recipient takes a new key with it, and the key you saw when sharing stops working then.'
                : 'This server sends no mail now. Give the link to the recipient yourself; it works once.',
        },
    };
}

/**
 * Share a package with a party and send the share's link in one call (`email` on POST
 * /v1/parties/share and on aimeat_party "share"). The address is checked before the share is written;
 * without `email` this is shareWithParty unchanged.
 */
export async function shareAndSend(ctx: PartyServiceCtx, body: Record<string, unknown>): Promise<PartyAnswer<Record<string, unknown>>> {
    // shareWithParty reads its own fields by name, so `email` and `locale` pass through it unread.
    const email = body.email;
    const locale = body.locale;
    if (email === undefined || email === null || email === '') return shareWithParty(ctx, body);
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 320) return refuse(400, 'INVALID_INPUT', 'email is one e-mail address, the one the share link goes to.');
    if (typeof body.recipient === 'string') return refuse(400, 'INVALID_INPUT', 'A person on another AIMEAT node signs in with their own account and needs no link: leave email out, or share with a party (name).');
    if (body.kind === 'dataspace') return refuse(400, 'INVALID_INPUT', 'A data space participant connects with its own credential and takes no link.');
    const shared = await shareWithParty(ctx, body);
    if (!shared.ok) return shared;
    const party = shared.data.party as { name: string };
    const share = shared.data.share as { id: string };
    const link = await sendShareLink(ctx, party.name, { share: share.id, email: email.trim(), locale });
    return { ok: true, data: { ...shared.data, link: link.ok ? link.data : { sent: false, code: link.code, message: link.message } } };
}

/** The party, its share and the link a code names, or the refusal the page shows. */
async function inviteOf(deps: Deps, code: unknown): Promise<
    { ok: true; owner: string; ownerGhii: string; party: PartyRecord; invite: PartyInvite; share: ConsentRecord } | Refusal
> {
    const notFound = refuse(404, 'INVITE_NOT_FOUND', 'This link is not valid. Ask the person who shared the data to send it again.');
    if (typeof code !== 'string' || code.length > 200) return notFound;
    const dot = code.lastIndexOf('.');
    const owner = code.slice(0, dot);
    if (dot <= 0 || !OWNER_PART_RE.test(owner) || !SECRET_RE.test(code.slice(dot + 1))) return notFound;
    const ownerGhii = `${owner}@${deps.config.nodeId}`;
    const hash = hashOf(code);
    let party: PartyRecord | undefined;
    let invite: PartyInvite | undefined;
    // Every stored hash is compared, so the time does not say which party holds the link.
    for (const p of (await readParties(deps.storage, ownerGhii)).parties) {
        for (const i of p.shareLinks ?? []) {
            if (sameHash(hash, i.hash) && !invite) { party = p; invite = i; }
        }
    }
    if (!party || !invite) return notFound;
    if (invite.usedAt) return refuse(410, 'INVITE_USED', 'This link was used already. The key was shown to whoever opened it. Ask the person who shared the data for a new link.');
    if (Date.parse(invite.expiresAt) <= Date.now()) return refuse(410, 'INVITE_EXPIRED', 'This link has expired. Ask the person who shared the data to send it again.');
    if (party.status !== 'active') return refuse(403, 'PARTY_STOPPED', 'This share is stopped. Contact the person who shared the data.');
    const share = (await partySharesOf(deps.storage, ownerGhii, party, deps.config.nodeId)).find(s => s.id === invite!.share);
    if (!share || !isLiveShare(share)) return refuse(410, 'SHARE_ENDED', 'This share has ended, so the link no longer works.');
    return { ok: true, owner, ownerGhii, party, invite, share };
}

/** What the recipient page shows before anything is accepted: who shared what, until when, for what. */
async function inviteView(deps: Deps, found: { owner: string; ownerGhii: string; party: PartyRecord; invite: PartyInvite; share: ConsentRecord }): Promise<Record<string, unknown>> {
    const { owner, ownerGhii, party, invite, share } = found;
    const pkg = packageOfPattern(share.dataPattern) ?? '';
    const meta = shareMetaOf(share);
    const d = await descriptorFor(deps.storage, ownerGhii, pkg, meta.pinnedVersion);
    const f = await packageFreshness(deps, ownerGhii, pkg);
    const licence = d?.licenses?.[0]?.name ?? (d?.aimeat as { license?: string } | undefined)?.license ?? null;
    const a = (d?.aimeat ?? {}) as { attribution?: string; i18n?: PackageI18n };
    return {
        owner, owner_name: await ownerNameOf(deps.storage, owner),
        party: { name: party.name, display_name: party.displayName, kind: party.kind, party_ref: partyRefOf(owner, party.name, deps.config.nodeId) },
        share: shareView(share),
        package: {
            name: pkg, title: d?.title || pkg, description: d?.description ?? null, licence,
            // The licence's deed, who to credit, and the words per language the page shows.
            licence_url: d?.licenses?.[0]?.path ?? (licence ? licenceUrlOf(licence) ?? null : null),
            attribution: a.attribution ?? null,
            ...(a.i18n ? { i18n: a.i18n } : {}),
            resources: (d?.resources ?? []).map(r => ({ name: r.name, rows: r.rowCount, fields: r.schema.fields.length })),
            freshness: f ? { state: f.state, schedule: f.promise?.cron ?? null, timezone: f.promise?.timezone ?? null, on_change: f.trigger === 'change', last_success_at: f.last_success_at } : null,
        },
        link_expires_at: invite.expiresAt,
        terms: meta.termsRequired && !meta.termsAcceptedAt
            ? 'You accept the terms when you take the key: you use the data for the purpose above and keep to its licence, and the person who shared it sees when you read it.'
            : null,
    };
}

/** The recipient opens the link: the facts of the share, and nothing is changed. */
export async function previewInvite(deps: Deps, code: unknown): Promise<PartyAnswer<Record<string, unknown>>> {
    const found = await inviteOf(deps, code);
    if (!found.ok) return found;
    return { ok: true, data: await inviteView(deps, found) };
}

/**
 * The recipient redeems the link: once. Terms the share requires are accepted here (`accept_terms`
 * true), and refused before any write when they are not. The answer carries the new key, the
 * connection file and a party token; the key is in no other answer.
 */
export async function redeemInvite(deps: Deps, code: unknown, body: { accept_terms?: unknown }): Promise<PartyAnswer<Record<string, unknown>>> {
    const found = await inviteOf(deps, code);
    if (!found.ok) return found;
    const { owner, ownerGhii, party, invite, share } = found;
    const meta = shareMetaOf(share);
    const mustAccept = meta.termsRequired && !meta.termsAcceptedAt;
    if (mustAccept && body.accept_terms !== true) {
        return refuse(400, 'TERMS_NOT_ACCEPTED', 'Accept the terms first (accept_terms: true). The key is made when you accept them.');
    }
    const fresh = newPartyKey();
    const keyId = newPartyKeyId();
    // Set inside the CAS callback, which may run more than once; read after it.
    let outcome = 'gone' as 'ok' | 'used' | 'full' | 'gone';
    let retired: string[] = [];
    const at = new Date().toISOString();
    const after = await changeParty(deps.storage, ownerGhii, party.name, p => {
        outcome = 'gone'; retired = [];
        if (p.uid !== party.uid) return UNCHANGED;
        const mine = (p.shareLinks ?? []).find(i => i.id === invite.id);
        if (!mine) return UNCHANGED;
        if (mine.usedAt) { outcome = 'used'; return UNCHANGED; }
        // The key the owner saw when sharing (never used, made before this link) and the key an earlier
        // link of this share made stop working: the recipient's key is one nobody else has held.
        const earlier = new Set((p.shareLinks ?? []).filter(i => i.share === invite.share && i.usedAt && i.keyId).map(i => i.keyId!));
        const keep = p.keys.filter(k => {
            const shown = !k.lastUsedAt && !k.share && Date.parse(k.createdAt) <= Date.parse(mine.createdAt);
            if (shown || earlier.has(k.id)) { retired.push(k.id); return false; }
            return true;
        });
        if (keep.length >= MAX_KEYS_PER_PARTY) { outcome = 'full'; retired = []; return UNCHANGED; }
        outcome = 'ok';
        return {
            ...p,
            keys: [...keep, { id: keyId, hash: fresh.hash, createdAt: at, lastUsedAt: null }],
            shareLinks: (p.shareLinks ?? []).map(i => (i.id === invite.id ? { ...i, usedAt: at, keyId } : i)),
        };
    });
    if (outcome === 'used') return refuse(410, 'INVITE_USED', 'This link was used already. Ask the person who shared the data for a new link.');
    if (outcome === 'full') return refuse(409, 'TOO_MANY_KEYS', `This party holds ${MAX_KEYS_PER_PARTY} keys already. Ask the person who shared the data to delete one.`);
    if (outcome !== 'ok' || !after) return refuse(404, 'INVITE_NOT_FOUND', 'This link is not valid. Ask the person who shared the data to send it again.');

    let current = share;
    if (mustAccept) current = (await setShareMeta(deps.storage, share, { termsAcceptedAt: at })) ?? share;
    emitChange('consent', ownerGhii);
    const view = await inviteView(deps, { owner, ownerGhii, party: after, invite, share: current });
    const token = await mintPartyToken({ owner, uid: after.uid, kid: keyId });
    return {
        ok: true, data: {
            ...view, terms: null, terms_accepted: mustAccept ? at : (meta.termsAcceptedAt ?? null),
            key: fresh.key, key_id: keyId, retired_key_ids: retired,
            basic_user: `${owner}/${after.name}`,
            connection: await connectionFileOf(deps, ownerGhii, after, current, fresh.key),
            access_token: token, token_type: 'Bearer', expires_in: PARTY_TOKEN_TTL_SECONDS,
            key_note: 'This key is shown once and is also in the connection file. Keep it safe; this server keeps only its hash.',
        },
    };
}
