/**
 * @file src/services/design-book/kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The KIT kind of the Design Book: a style kit (tyylipohja), the whole look of an app
 *   in one part, so a person's next app, or every new app of a company's members, starts in their
 *   own style (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 *
 *   THE BODY IS DATA: { reach, organism?, look, tokens?, genre?, ornament?, logo?, from_app? }. A
 *   look this node ships, the signature tokens on top of it (colours, faces, corners, motion; the
 *   same bench a look part runs, contrast-matrix pair proof included), the genre a new app forks
 *   from, the ornament set it wears, and its logo. Nothing in it is markup or script.
 *
 *   A KIT HAS A REACH, and it is the one part kind that does. `own`: only its proposer reads and
 *   takes it. `organism`: its proposer and the active members of one organism. `node`: everyone,
 *   once it is published, through the same earned path as a component. A kit inside a reach is
 *   published at once for that reach, because nobody else sees it; a kit for the whole node starts
 *   as proposed, unless it comes from an app its owner said turned out well. The record stays under
 *   the node's own system identity like every part (service.ts), stored `private` while its reach
 *   is narrower than the node, and the generic memory doors never serve a part (own-door-keys.ts),
 *   so the Design Book's reads are the one way in, and they ask kitReadable() here.
 *
 *   TAKEN LIKE A COMPONENT. A kit lives in the app's own code, so taking one writes nothing and
 *   answers what to build with: the genre to fork, the head stylesheet with the tokens, the app()
 *   line with the look and the logo, and the ornamentSet() line.
 * @structure KIT_PROMPT_PARAGRAPH · KIT_REACHES · KitBody · isKitPart · kitReach · validateKitBody · kitReadable · kitVisibility · kitStatusOnPropose · kitSnippet
 * @usage
 *   const body = validateKitBody({ reach: 'own', look: 'editorial', tokens: { '--ak-accent': '#1d4ed8/#93c5fd' } });
 *   if (!(await kitReadable(storage, nodeId, part, readerOwnerGhii))) throw notFound;
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import type { Storage } from '../../storage/interface.js';
import { LOOKS } from '../../data/atelier-looks.js';
import { ORNAMENT_SET_IDS } from '../../data/atelier-ornament-sets.js';
import { getAppTemplateIndex } from '../../data/app-templates.js';
import { validateSignatureTokens, AppUiError } from '../app-ui/validate.js';
import { localAccountName } from '../../utils/gaii.js';
import { systemGhiiFor } from '../compliance-register.js';
import { DesignBookError } from './errors.js';

/** Who reads a kit: its proposer alone, one organism's members, or everyone once it is published. */
export const KIT_REACHES = ['own', 'organism', 'node'] as const;
export type KitReach = (typeof KIT_REACHES)[number];

export interface KitBody {
  reach: KitReach;
  /** The organism whose members read it; only with reach "organism". */
  organism?: string;
  /** A look this node ships: the base every token below changes. */
  look: string;
  /** Signature token overrides on top of the look, benched as a look part's are. */
  tokens?: Record<string, string>;
  /** The genre a new app forks from. */
  genre?: string;
  /** The ornament set the app wears, in the set's own colours or the look's. */
  ornament?: { set: string; palette?: 'set' | 'look' };
  /** The app's square mark: an https or storage address, or a data:image of at most 8192 characters. */
  logo?: string;
  /** The app this kit was taken from, which is what a kit for the whole node earns publishing from. */
  from_app?: string;
}

/** The build specification's paragraph (build-atelier-prompt.ts, part `book`): the kit comes before the genre. */
export const KIT_PROMPT_PARAGRAPH = 'THE STYLE KIT COMES BEFORE THE GENRE. A new app asks `aimeat_designbook_kit` first '
  + '(GET /v1/designbook/kits/in-force), naming the `organism` when the app is built for one: the '
  + 'kit the person or their organism chose answers with what to fork, the head stylesheet, the '
  + 'app() line and the ornament line. Build in it unless the person asks otherwise; with no kit, '
  + 'pick a genre as below.\n\n';

/** The fields of a stored part the reach rules read. */
interface KitPart { kind: string; body: unknown; proposed_by_owner: string; status: string }

const SHAPE = 'A kit part\'s body is { reach: "own" | "organism" | "node", organism?, look, tokens?, genre?, ornament?: { set, palette?: "set" | "look" }, logo?, from_app? }';
const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/;
const GENRE_RE = /^genre-[a-z0-9][a-z0-9-]{1,60}$/;
const FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,120}\.html$/i;
const LOGO_DATA_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const LOGO_DATA_MAX = 8192;

export function isKitPart(part: Pick<KitPart, 'kind'>): boolean {
  return part.kind === 'kit';
}

/** A part's reach: a kit's own, and "node" for every other kind, which the whole node reads. */
export function kitReach(part: Pick<KitPart, 'kind' | 'body'>): KitReach {
  if (!isKitPart(part)) return 'node';
  const r = (part.body as { reach?: unknown } | null)?.reach;
  return (KIT_REACHES as readonly unknown[]).includes(r) ? r as KitReach : 'own';
}

/** The propose-time bench for a kit. Whether the proposer is a member of the organism and whether a grown genre stands need the store, so the service asks those. */
export function validateKitBody(o: Record<string, unknown>): KitBody {
  const reach = o.reach;
  if (!(KIT_REACHES as readonly unknown[]).includes(reach)) {
    throw new DesignBookError('BODY_INVALID', `${SHAPE}. "reach" says who reads it: "own" (you alone), "organism" (the members of one organism, named in "organism"), or "node" (everyone, once it is published).`, 422);
  }
  const out: KitBody = { reach: reach as KitReach, look: '' };
  if (reach === 'organism') {
    if (typeof o.organism !== 'string' || !ORG_RE.test(o.organism)) {
      throw new DesignBookError('BODY_INVALID', 'A kit for an organism names it: "organism": "<the organism id>". You must be an active member of it.', 422);
    }
    out.organism = o.organism;
  } else if (o.organism !== undefined) {
    throw new DesignBookError('BODY_INVALID', `"organism" goes with reach "organism" only. This kit's reach is "${String(reach)}".`, 422);
  }
  if (typeof o.look !== 'string' || !LOOKS.some((l) => l.id === o.look)) {
    throw new DesignBookError('BODY_INVALID', `A kit starts from a look this node ships ("look"). The looks it has: ${LOOKS.map((l) => l.id).join(', ')}.`, 422);
  }
  out.look = o.look;
  if (o.tokens !== undefined) {
    try {
      const tokens = validateSignatureTokens(o.tokens, o.look);
      if (Object.keys(tokens).length) out.tokens = tokens;
    } catch (err) {
      if (err instanceof AppUiError) throw new DesignBookError('BODY_INVALID', `The kit's tokens did not pass the bench — ${err.message}`, 422);
      throw err;
    }
  }
  if (o.genre !== undefined) {
    if (typeof o.genre !== 'string' || !GENRE_RE.test(o.genre)) {
      throw new DesignBookError('BODY_INVALID', `"genre" names the genre a new app forks from, e.g. "${getAppTemplateIndex().find(t => t.kind === 'genre')?.id ?? 'genre-…'}". The Design Book lists them under kind genre.`, 422);
    }
    out.genre = o.genre;
  }
  if (o.ornament !== undefined) {
    const orn = o.ornament as { set?: unknown; palette?: unknown } | null;
    if (!orn || typeof orn !== 'object' || typeof orn.set !== 'string' || !ORNAMENT_SET_IDS.includes(orn.set)) {
      throw new DesignBookError('BODY_INVALID', `"ornament" is { set, palette? } with set one of ${ORNAMENT_SET_IDS.join(', ')}.`, 422);
    }
    if (orn.palette !== undefined && orn.palette !== 'set' && orn.palette !== 'look') {
      throw new DesignBookError('BODY_INVALID', '"ornament.palette" is "set" (the set\'s own colours, the default) or "look" (the kit\'s accent and spectrum).', 422);
    }
    out.ornament = { set: orn.set, ...(orn.palette ? { palette: orn.palette as 'set' | 'look' } : {}) };
  }
  if (o.logo !== undefined) {
    const logo = typeof o.logo === 'string' ? o.logo.trim() : '';
    const ok = (/^https:\/\/[^\s"'<>]{4,2000}$/.test(logo)) || (/^\/v1\/(pub|storage)\/[^\s"'<>]{1,1000}$/.test(logo))
      || (logo.length <= LOGO_DATA_MAX && LOGO_DATA_RE.test(logo));
    if (!ok) {
      throw new DesignBookError('BODY_INVALID', `"logo" is the app's square mark: an https address, a stored file (/v1/pub/…), or a data:image (png, jpeg, webp or svg+xml, base64) of at most ${LOGO_DATA_MAX} characters.`, 422);
    }
    out.logo = logo;
  }
  if (o.from_app !== undefined) {
    if (typeof o.from_app !== 'string' || !FILENAME_RE.test(o.from_app)) {
      throw new DesignBookError('BODY_INVALID', '"from_app" names your own published app the kit was taken from, e.g. "habits.html".', 422);
    }
    out.from_app = o.from_app;
  }
  return out;
}

/**
 * Whether this reader may see this part at all. Every kind but a kit, and a kit for the whole node,
 * answers true here (its status rules apply on top). A narrower kit: its proposer, or for an
 * organism kit an active member of that organism; the node's own identity reads every part, for
 * the aging round. A reader with no session is null and reads no narrower kit.
 */
export async function kitReadable(storage: Storage, nodeId: string, part: KitPart, readerOwnerGhii: string | null): Promise<boolean> {
  const reach = kitReach(part);
  if (reach === 'node') return true;
  if (!readerOwnerGhii) return false;
  if (readerOwnerGhii === systemGhiiFor(nodeId) || readerOwnerGhii === part.proposed_by_owner) return true;
  if (reach !== 'organism') return false;
  const org = (part.body as KitBody).organism;
  return !!org && await isActiveMember(storage, org, readerOwnerGhii);
}

/** Whether this owner is an active member of this organism. */
export async function isActiveMember(storage: Storage, organismId: string, ownerGhii: string): Promise<boolean> {
  const m = await storage.getMembership(organismId, localAccountName(ownerGhii));
  return !!m && m.status === 'active';
}

/** How the record is stored: a kit narrower than the node stays private; every other part is public once published. */
export function kitVisibility(part: KitPart): 'public' | 'members' | 'private' {
  if (kitReach(part) !== 'node') return 'private';
  return part.status === 'published' ? 'public' : 'members';
}

/**
 * The status a kit lands in. Inside its reach it is published at once: nobody else sees it, so
 * there is nobody to ask. For the whole node it keeps a status it already earned there, and is
 * otherwise published only when it earned it (from an app its owner kept), else proposed. A kit
 * that widens its reach from narrower to the node does not carry its narrower "published" along.
 */
export function kitStatusOnPropose(
  body: KitBody, prev: { status: string; body: unknown; kind: string } | null, earned: boolean,
): 'proposed' | 'published' | 'aging' {
  if (body.reach !== 'node') return 'published';
  const wasNode = prev && prev.kind === 'kit' && kitReach(prev) === 'node';
  if (wasNode && (prev.status === 'published' || prev.status === 'aging')) return prev.status as 'published' | 'aging';
  return earned ? 'published' : 'proposed';
}

/** The head stylesheet that puts a kit's tokens on a page: the accent pair per mode, every other token at :root. */
function kitCss(tokens: Record<string, string>): string {
  const plain: string[] = [];
  let pair = '';
  for (const [name, value] of Object.entries(tokens)) {
    if (name === '--ak-accent' && value.includes('/')) {
      const [light, dark] = value.split('/').map(s => s.trim());
      pair = `:root[data-theme="dark"] { --ak-accent: ${dark || light}; }`;
      plain.push(`--ak-accent: ${light};`);
    } else {
      plain.push(`${name}: ${value};`);
    }
  }
  return [`:root { ${plain.join(' ')} }`, pair].filter(Boolean).join('\n');
}

/** What taking a kit answers: what to fork, what to put in the head, and the two lines to call. */
export function kitSnippet(body: KitBody, title: string): {
  look: string; genre?: string; fork?: string; css?: string; app: string; ornament?: string; use: string;
} {
  const appOpts = [`title: '<your app\\'s name>'`, `look: '${body.look}'`, ...(body.logo ? [`logo: ${JSON.stringify(body.logo)}`] : [])];
  const orn = body.ornament
    ? `AIMEAT.atelier.ornamentSet('${body.ornament.set}', { frame: card, rule: hr, bar: meter, bullets: list, strip: foot }${body.ornament.palette === 'look' ? ", { palette: 'look' }" : ''});`
    : undefined;
  const css = body.tokens && Object.keys(body.tokens).length ? kitCss(body.tokens) : undefined;
  const steps = [
    `This is the style kit "${title}". Build the new app in it unless the person asks for something else.`,
    body.genre ? `Start from the genre ${body.genre}: fork it (aimeat_app_template_get, or GET /v1/app-templates/${body.genre}) and put the app's own words and sources in.` : 'Start from the Atelier shell or the genre that fits the app best.',
    css ? 'Put `css` in a <style> in the head, after the kit stylesheet: it sets the kit\'s colours, faces, corners and motion on the whole page. In a genre, its bridge rule reads the same tokens.' : '',
    `Open the app with \`app\` (the kit's look${body.logo ? ' and its logo' : ''}).`,
    orn ? 'Call `ornament` with your page\'s elements; leave out a role you do not want.' : '',
    'Name the kit in your page\'s build notes (`took`), and take it with aimeat_designbook_adopt once the app has a file name: that counts the use, which keeps the kit from aging.',
  ].filter(Boolean);
  return {
    look: body.look,
    ...(body.genre ? { genre: body.genre, fork: `/v1/app-templates/${body.genre}` } : {}),
    ...(css ? { css } : {}),
    app: `AIMEAT.atelier.app({ ${appOpts.join(', ')} });`,
    ...(orn ? { ornament: orn } : {}),
    use: steps.join(' '),
  };
}
