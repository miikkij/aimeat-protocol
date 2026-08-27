/**
 * @file src/services/outbound/email-theme.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a campaign email LOOKS like: a small set of colour tokens, four built-in themes,
 *   and the validator that lets an owner add their own without handing anybody a way to write raw
 *   CSS into somebody else's inbox.
 *
 *   A THEME IS DATA, NOT MARKUP, and that separation is the whole safety property. Every token here
 *   is checked against a pattern before it reaches a style attribute: a colour is six hex digits or
 *   it is not a colour, a font is one of four names or it is not a font. Nothing is escaped and
 *   hoped for, because an escaped string is still a string somebody chose, and `style="..."` is a
 *   place where a chosen string becomes behaviour. A token that fails falls back to the default one
 *   rather than failing the send: the message matters more than the shade of its border.
 *
 *   WHY THE SET IS SMALL. Eleven tokens describe every layout this renderer can produce, so a theme
 *   is a thing a person can hold in their head and a thing the renderer can guarantee. A larger
 *   vocabulary would be a stylesheet with extra steps, and a stylesheet is exactly what an email
 *   client will not honour.
 * @structure ThemeTokens · BUILT_IN_THEMES · isColor/isFont · validateTheme · resolveTheme · fontStack
 * @usage const theme = resolveTheme(input.theme, custom); render(theme)
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial. Campaigns had one hardcoded look, shared with verification codes
 *     and magic links, so making a campaign prettier meant changing the email that carries a
 *     sign-in link.
 */

/** The whole vocabulary. Everything the renderer can vary, and nothing it cannot. */
export interface ThemeTokens {
  /** Outer background, behind the card. */
  page: string;
  /** Second stop of the outer gradient. Clients that ignore gradients get `page`, flat. */
  pageTo: string;
  /** The card the message sits on. */
  card: string;
  /** The card's hairline. */
  border: string;
  /** The subject line. */
  heading: string;
  /** Body copy. */
  text: string;
  /** The brand line above the card, and the unsubscribe line below the rule. */
  muted: string;
  /** Button background. */
  accent: string;
  /** Button label. */
  accentText: string;
  /** One of the four named stacks. Never a free string: see fontStack(). */
  font: FontName;
  /** Corner radius in px, 0 to 24. Outlook squares it off whatever this says. */
  radius: number;
}

export type FontName = 'system' | 'serif' | 'mono' | 'rounded';

/**
 * The four stacks, written out here rather than taken from a caller.
 *
 * NO WEB FONTS. Outlook drops a linked font and Gmail strips the @font-face, so a message that
 * depends on one arrives in whatever the client felt like. These are stacks that resolve to
 * something reasonable on every machine that will open the mail.
 */
const FONT_STACKS: Record<FontName, string> = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,Cambria,'Times New Roman',Times,serif",
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace",
  rounded: "'Segoe UI',ui-rounded,'Hiragino Maru Gothic ProN',Avenir,Helvetica,Arial,sans-serif",
};

export const FONT_NAMES = Object.keys(FONT_STACKS) as FontName[];

export function fontStack(name: FontName): string {
  return FONT_STACKS[name] ?? FONT_STACKS.system;
}

/**
 * The built-ins.
 *
 * `clean` REPRODUCES WHAT WENT OUT BEFORE THEMES EXISTED, and it is the default on purpose: nobody
 * who never asked for a theme should discover one in their customer's inbox. The other three exist
 * because "can it look like something else" was the question, and one alternative would have been
 * an answer to a narrower question than the one asked.
 */
export const BUILT_IN_THEMES: Record<string, ThemeTokens> = {
  clean: {
    page: '#f4f4f7', pageTo: '#f4f4f7', card: '#ffffff', border: '#e5e7eb',
    heading: '#333333', text: '#555555', muted: '#999999',
    accent: '#4f46e5', accentText: '#ffffff', font: 'system', radius: 8,
  },
  space: {
    page: '#0b1020', pageTo: '#141b33', card: '#161d33', border: '#2a3358',
    heading: '#ffffff', text: '#dfe4f2', muted: '#8b93ad',
    accent: '#7c5cff', accentText: '#ffffff', font: 'system', radius: 14,
  },
  warm: {
    page: '#fdf6ec', pageTo: '#f7e9d5', card: '#fffdf9', border: '#e8dcc8',
    heading: '#3f2d1c', text: '#5b4636', muted: '#9c8b76',
    accent: '#c2622d', accentText: '#ffffff', font: 'serif', radius: 10,
  },
  paper: {
    page: '#ffffff', pageTo: '#ffffff', card: '#ffffff', border: '#d8d8d8',
    heading: '#111111', text: '#333333', muted: '#8a8a8a',
    accent: '#111111', accentText: '#ffffff', font: 'serif', radius: 0,
  },
};

export const BUILT_IN_THEME_IDS = Object.keys(BUILT_IN_THEMES);
export const DEFAULT_THEME_ID = 'clean';

/** Six or three hex digits. Not `red`, not `rgb()`, not `var()`, not anything with a bracket. */
export function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

export function isFont(v: unknown): v is FontName {
  return typeof v === 'string' && (FONT_NAMES as string[]).includes(v);
}

const COLOR_KEYS = [
  'page', 'pageTo', 'card', 'border', 'heading', 'text', 'muted', 'accent', 'accentText',
] as const;

export interface ThemeProblem { field: string; why: string }

/**
 * Read somebody's stored theme into tokens, saying what it could not use.
 *
 * NEVER THROWS AND NEVER REFUSES A SEND. A theme is decoration on a message somebody is trying to
 * deliver; a bad shade of grey is not a reason for their customer to hear nothing. Each unusable
 * field falls back to the default theme's value and is REPORTED, so the surface that lists themes
 * can show the problem before anybody sends rather than after.
 */
export function validateTheme(raw: unknown): { tokens: ThemeTokens; problems: ThemeProblem[] } {
  const base = BUILT_IN_THEMES[DEFAULT_THEME_ID] as ThemeTokens;
  const problems: ThemeProblem[] = [];
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const out = { ...base };

  for (const key of COLOR_KEYS) {
    if (src[key] === undefined) continue;
    if (isColor(src[key])) out[key] = src[key] as string;
    else problems.push({ field: key, why: 'not a hex colour like #1a2b3c' });
  }
  if (src.font !== undefined) {
    if (isFont(src.font)) out.font = src.font;
    else problems.push({ field: 'font', why: `not one of ${FONT_NAMES.join(', ')}` });
  }
  if (src.radius !== undefined) {
    const r = src.radius;
    if (typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 24) out.radius = Math.round(r);
    else problems.push({ field: 'radius', why: 'not a whole number between 0 and 24' });
  }
  return { tokens: out, problems };
}

/**
 * Which tokens this send should use.
 *
 * An unknown id is the DEFAULT rather than an error, for the same reason a bad colour is: the
 * message is the point. A caller that wants to know whether its id exists asks the themes route,
 * which answers before anything is sent.
 */
export function resolveTheme(id: string | undefined, custom?: unknown): ThemeTokens {
  if (custom !== undefined) return validateTheme(custom).tokens;
  if (id && BUILT_IN_THEMES[id]) return BUILT_IN_THEMES[id] as ThemeTokens;
  return BUILT_IN_THEMES[DEFAULT_THEME_ID] as ThemeTokens;
}

/** The memory key an owner's own theme lives under. One key per theme, as templates already are. */
export function themeKey(id: string): string {
  return `outbound.theme.${id}`;
}

/** A theme id an owner may choose: short, and safe in a memory key. */
export function isThemeId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
}
