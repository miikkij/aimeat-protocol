/**
 * @file src/services/content/risk-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules half of the `risk` stage: finds possible risks in a text with no model and no
 *   cost, and answers marks with where they are. It reads; it never changes the text it is given.
 *
 *   Six kinds (risk-types.ts RISK_KINDS), in English, Finnish and Spanish where the kind is words:
 *   - ai-instruction: text addressed to an AI that tries to steer it ("ignore previous instructions",
 *     "ohita aiemmat ohjeet", "do not tell the user").
 *   - hidden-text: characters a person does not see (zero-width, bidirectional overrides, Unicode tag
 *     characters) and markup that hides words (an inline style that hides text, an HTML comment with
 *     words in it, a Markdown comment line).
 *   - false-role: text that claims to be the system, an administrator or a chat template's role.
 *   - exfil-link: a link with a placeholder for data, an image link whose address carries a long
 *     value, or a sentence asking to put data into a link or send it to an address.
 *   - other-person-data: a request to read or send another person's or every member's data.
 *   - encoded-block: a long base64 or hex run, or a block of base64 lines, outside an image data URL.
 *
 *   A MARK IS A SIGNAL. Adaptive attacks pass any detector (docs/internal/situated-ai/07, section 3),
 *   so the marks tell a reader to treat the text as data; the structure around the reader is what
 *   stops an act. A false mark costs a warning line; it never changes or hides the content.
 *
 *   SAFE PATTERNS. Every pattern is linear: no repeat inside a repeat, no overlapping repeats side by
 *   side (test/unit/content-risk-rules.test.ts runs classification/regex-safety.ts unsafeRegexReason on
 *   each). Shapes a single pattern cannot say safely are found in two steps (a link first, then its
 *   value; lines first, then their run). The text is read up to MAX_SCAN_CHARS.
 * @structure MAX_SCAN_CHARS · RULE_PATTERNS · markFp() · detectRiskRules() · excerptOf()
 * @usage const { marks, truncatedAt } = detectRiskRules(text, ['ai-instruction', 'hidden-text']);
 * @version-history
 *   v1.1.0 — 2026-11-21 — Every mark carries `fp` (markFp), which an acceptance names
 *     (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import { createHash } from 'node:crypto';
import type { RiskKind, RiskMark } from './risk-types.js';

/** The most of a text the rules read. A memory value holds at most 1024 kB. */
export const MAX_SCAN_CHARS = 1_000_000;
/** At most this many marks of one kind, and in all. */
const MAX_PER_KIND = 20;
const MAX_MARKS = 60;
const EXCERPT = 160;

/** A boundary that also works before and after a letter outside ASCII (ä, ö, ñ): `\b` does not. */
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';

interface Rule { kind: RiskKind; id: string; source: string; flags?: string; keep?: (m: RegExpExecArray, text: string) => boolean }

const DATA_WORD = /(?:data|information|details|conversation|history|context|message|e-?mail|password|token|secret|summary|content|answer|key|tiedot|tiedon|viesti|keskustelu|salasana|sisältö|vastaus|datos|mensaje|contraseña|conversación)/iu;

/**
 * The word patterns. Exported for the safety test, which checks each with unsafeRegexReason.
 * `flags` defaults to 'giu'; `m` is added where a pattern reads from a line's start.
 */
export const RULE_PATTERNS: readonly Rule[] = [
  // ── ai-instruction ──
  { kind: 'ai-instruction', id: 'ignore-previous',
    source: `${B}(?:ignore|disregard|forget|override|bypass)\\s+(?:(?:all|any|every|the|your|my|these)\\s+)?(?:previous|prior|above|earlier|preceding|former|existing|system|original)\\s+(?:instructions?|prompts?|messages?|rules|directions|directives|guidelines|context|commands)${E}` },
  { kind: 'ai-instruction', id: 'forget-everything',
    source: `${B}(?:forget|ignore|disregard)\\s+(?:everything|all)\\s+(?:you\\s+(?:were|have\\s+been)\\s+told|above|before\\s+this|so\\s+far)${E}` },
  { kind: 'ai-instruction', id: 'new-instructions',
    source: `${B}(?:new|updated|real|actual|secret|hidden|true)\\s+(?:instructions?|system\\s+prompt|orders)[ \\t]?:` },
  { kind: 'ai-instruction', id: 'you-are-now',
    source: `${B}you\\s+are\\s+(?:now\\s+(?:a|an)\\s+(?:different|new|unrestricted|unfiltered|jailbroken|evil)|no\\s+longer\\s+(?:an?\\s+)?(?:ai|assistant|bound|restricted|limited))${E}` },
  { kind: 'ai-instruction', id: 'address-the-ai',
    source: `${B}(?:(?:attention|note|instructions?|message|important)\\s+(?:to|for)\\s+(?:the\\s+|any\\s+)?(?:ai|assistant|llm|language\\s+model|chatbot|ai\\s+agent|model)|if\\s+you\\s+are\\s+(?:an?\\s+)?(?:ai|llm|language\\s+model|ai\\s+assistant|ai\\s+agent))${E}` },
  { kind: 'ai-instruction', id: 'hide-from-user',
    source: `${B}(?:do\\s+not|don'?t|never)\\s+(?:tell|inform|alert|notify|warn|mention\\s+this\\s+to|reveal\\s+this\\s+to)\\s+(?:the\\s+)?(?:user|owner|human|person|operator)${E}` },
  { kind: 'ai-instruction', id: 'call-tool',
    source: `${B}(?:call|invoke|execute|run)\\s+(?:the\\s+)?(?:tool|function|mcp\\s+tool)\\s+[\`"']?[a-z_][a-z0-9_]{2,60}` },
  { kind: 'ai-instruction', id: 'fi-ohita-ohjeet',
    source: `${B}(?:ohita|unohda|sivuuta|älä\\s+välitä|älä\\s+noudata)\\s+(?:(?:kaikki|kaikista)\\s+)?(?:aiemmat|aiemmista|aiempia|edelliset|edellisistä|edellisiä|aikaisemmat|yllä\\s+olevat|aiemmin\\s+annetut|alkuperäiset)\\s+(?:ohjeet|ohjeista|ohjeita|ohjeesi|käskyt|käskyistä|säännöt|säännöistä)${E}` },
  { kind: 'ai-instruction', id: 'fi-ala-kerro',
    source: `${B}älä\\s+(?:kerro|ilmoita|mainitse|näytä)\\s+(?:tästä\\s+|tätä\\s+)?(?:käyttäjälle|omistajalle|ihmiselle|ylläpidolle)${E}` },
  { kind: 'ai-instruction', id: 'fi-uudet-ohjeet',
    source: `${B}(?:(?:uudet|oikeat|salaiset|todelliset)\\s+ohjeet[ \\t]?:|(?:viesti|ohje|ohjeet|huomio)\\s+(?:tekoälylle|avustajalle|kielimallille|agentille)|olet\\s+nyt\\s+(?:uusi|eri|rajoittamaton))${E}` },
  { kind: 'ai-instruction', id: 'es-ignora-instrucciones',
    source: `${B}(?:ignora|olvida|omite|desobedece)\\s+(?:todas\\s+)?(?:las\\s+)?(?:instrucciones|indicaciones|órdenes|reglas)\\s+(?:anteriores|previas|originales)${E}` },
  { kind: 'ai-instruction', id: 'es-no-digas',
    source: `${B}no\\s+(?:le\\s+)?(?:digas|informes|cuentes|menciones)\\s+(?:nada\\s+)?(?:esto\\s+)?al\\s+(?:usuario|propietario)${E}` },

  // ── false-role ──
  { kind: 'false-role', id: 'chat-template-token',
    source: '<\\|(?:im_start|im_end|system|assistant|endoftext|start_header_id|end_header_id|eot_id)\\|>|\\[\\/?INST\\]|<<\\/?SYS>>' },
  { kind: 'false-role', id: 'role-line', flags: 'gimu',
    source: '^[ \\t]{0,8}(?:#{1,6}[ \\t]?)?(?:\\[|<|\\()?(?:system|developer|operator|administrator)(?:\\]|>|\\))?(?:[ \\t](?:message|prompt|notice|override|instruction))?[ \\t]?:' },
  { kind: 'false-role', id: 'role-tag',
    source: '<\\/?(?:system|system_prompt|system-prompt|admin_instructions)>' },
  { kind: 'false-role', id: 'message-from-system',
    source: `${B}(?:official\\s+)?(?:message|notice|instruction|directive)s?\\s+from\\s+(?:the\\s+)?(?:system|administrator|admin|operator|anthropic|openai|aimeat|support\\s+team|security\\s+team)${E}` },
  { kind: 'false-role', id: 'fi-yllapidon-viesti',
    source: `${B}(?:(?:ylläpidon|järjestelmän|ylläpitäjän|operaattorin)\\s+(?:viesti|ilmoitus|ohje|käsky)|järjestelmäviesti|järjestelmäilmoitus)${E}` },
  { kind: 'false-role', id: 'es-mensaje-del-sistema',
    source: `${B}(?:mensaje|aviso|instrucción)\\s+del\\s+(?:sistema|administrador|operador)${E}` },

  // ── exfil-link (word part; the link part is in scanLinks) ──
  { kind: 'exfil-link', id: 'put-data-in-link',
    source: `${B}(?:append|add|include|insert|attach|encode|put|embed)${E}[^\\n]{0,80}?${B}(?:to|into|in|as)\\s+(?:the\\s+|this\\s+|a\\s+)?(?:url|link|query\\s+string|query\\s+parameter|image\\s+url|address)${E}`,
    keep: (m) => DATA_WORD.test(m[0]) },
  { kind: 'exfil-link', id: 'send-to-url',
    source: `${B}(?:send|post|forward|upload|submit|transmit|leak|exfiltrate)${E}[^\\n]{0,80}?${B}(?:to|at)\\s+https?:\\/\\/` },
  { kind: 'exfil-link', id: 'fi-lisaa-linkkiin',
    source: `${B}(?:lisää|liitä|laita|upota|lähetä)${E}[^\\n]{0,80}?(?:osoitteeseen|linkkiin|url-osoitteeseen|kuvan\\s+osoitteeseen)`,
    keep: (m, text) => DATA_WORD.test(m[0]) || /https?:\/\//iu.test(text.slice(m.index + m[0].length, m.index + m[0].length + 12)) },
  { kind: 'exfil-link', id: 'es-anade-al-enlace',
    source: `${B}(?:añade|agrega|incluye|envía|inserta)${E}[^\\n]{0,80}?(?:al|en\\s+el|a\\s+la)\\s+(?:enlace|url|dirección)${E}`,
    keep: (m) => DATA_WORD.test(m[0]) },

  // ── other-person-data ──
  { kind: 'other-person-data', id: 'read-others-data',
    source: `${B}(?:read|fetch|get|list|show|open|forward|export|send|copy|collect|dump|retrieve|access)\\s+(?:me\\s+)?(?:all\\s+|the\\s+|every\\s+)?(?:other\\s+(?:users?|people|members|persons?)(?:'s|')?|(?:all|every)\\s+(?:users?|members|people)(?:'s|')?|someone\\s+else(?:'s)?|another\\s+(?:user|person|member)(?:'s)?)\\s+(?:private\\s+)?(?:data|e-?mails?|messages|mail|inbox|files|memor(?:y|ies)|records|contacts|calendars?|documents|notes|passwords|tokens|secrets|information)${E}` },
  { kind: 'other-person-data', id: 'data-of-others',
    source: `${B}(?:e-?mails?|messages|mail|inbox|files|memor(?:y|ies)|records|contacts|calendars?|documents|notes|passwords|private\\s+data)\\s+(?:of|from|belonging\\s+to)\\s+(?:other\\s+users|all\\s+users|every\\s+user|another\\s+user|other\\s+members|all\\s+members|every\\s+member|other\\s+people)${E}` },
  { kind: 'other-person-data', id: 'fi-muiden-tiedot',
    source: `${B}(?:lue|hae|listaa|näytä|lähetä|kopioi|kerää|avaa|välitä)\\s+(?:kaikkien|muiden|toisen|jonkun\\s+muun)\\s+(?:(?:käyttäjien|jäsenten|ihmisten|käyttäjän|henkilön|jäsenen)\\s+)?(?:tiedot|viestit|sähköpostit|tiedostot|muistiinpanot|salasanat|yhteystiedot|kalenterit?|dokumentit|muistit)${E}` },
  { kind: 'other-person-data', id: 'es-datos-de-otros',
    source: `${B}(?:lee|obtén|obten|envía|envia|copia|reenvía|muestra)\\s+(?:los\\s+|las\\s+)?(?:datos|correos|mensajes|archivos|contraseñas)\\s+de\\s+(?:otros\\s+usuarios|todos\\s+los\\s+usuarios|otra\\s+persona|otro\\s+usuario)${E}` },
];

const COMPILED = RULE_PATTERNS.map((r) => ({ ...r, re: new RegExp(r.source, r.flags ?? 'giu') }));

/**
 * A mark's fingerprint: the first 32 hex characters of sha256 over its kind, rule and matched words,
 * the words lower-cased with their whitespace runs made one space. The same phrase gives the same
 * fingerprint wherever it moves in the text, so an acceptance survives an edit around it; another
 * phrase gives another one. A model's mark uses the rule `model`.
 */
export function markFp(kind: RiskKind, rule: string, words: string): string {
  const norm = words.toLowerCase().replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(`${kind}\u0000${rule}\u0000${norm}`, 'utf8').digest('hex').slice(0, 32);
}

/** The text near [start, end), at most EXCERPT characters, with invisible characters spelled out. */
export function excerptOf(text: string, start: number, end: number): string {
  const len = end - start;
  const pad = Math.max(0, Math.floor((EXCERPT - Math.min(len, EXCERPT)) / 2));
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, Math.max(end, from + EXCERPT));
  const raw = text.slice(from, Math.min(to, from + EXCERPT));
  // eslint-disable-next-line no-control-regex -- control characters are what is spelled out here
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu,
    (c) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase()}}`).replace(/\s+/gu, ' ');
}

/** Characters a person does not see. Tag characters (U+E0000..U+E007F) carry hidden ASCII. */
const INVISIBLE_ALWAYS = /[\u200B\u2060-\u2064\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]/u;
/** Joiners and direction marks that real scripts and emoji use: a mark only in a run of three. */
const INVISIBLE_IN_RUN = /[\u200C-\u200F\uFEFF\u00AD]/u;

function scanInvisible(text: string, add: (m: Omit<RiskMark, 'excerpt'>) => void): void {
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const always = INVISIBLE_ALWAYS.test(ch);
    const inRun = !always && INVISIBLE_IN_RUN.test(ch) && !(cp === 0xFEFF && i === 0);
    if (!always && !inRun) { i += ch.length; continue; }
    const start = i;
    let strong = always;
    let count = 0;
    while (i < text.length) {
      const c = String.fromCodePoint(text.codePointAt(i)!);
      if (INVISIBLE_ALWAYS.test(c)) strong = true;
      else if (!INVISIBLE_IN_RUN.test(c)) break;
      count += 1;
      i += c.length;
    }
    if (strong || count >= 3) add({ kind: 'hidden-text', rule: strong ? 'invisible-characters' : 'invisible-run', by: 'rules', start, end: i });
  }
}

const HIDING_STYLE = /(?:display\s?:\s?none|visibility\s?:\s?hidden|font-size\s?:\s?0(?:px|pt|em|rem)?(?![.\d])|opacity\s?:\s?0(?![.\d])|color\s?:\s?(?:#fff(?:fff)?|white|transparent)(?![0-9a-z]))/iu;
const STYLE_ATTR = /style\s?=\s?(?:"([^"<>]{1,500})"|'([^'<>]{1,500})')/giu;
const HTML_COMMENT = /<!--([^]{0,4000}?)-->/gu;
const MD_COMMENT = /^[ \t]{0,3}\[(?:\/\/|comment|hidden)\]:[ \t]?(?:#|<>)[ \t]?\(/gimu;

function scanHidingMarkup(text: string, add: (m: Omit<RiskMark, 'excerpt'>) => void): void {
  for (const m of text.matchAll(STYLE_ATTR)) {
    if (HIDING_STYLE.test(m[1] ?? m[2] ?? '')) add({ kind: 'hidden-text', rule: 'hiding-style', by: 'rules', start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(HTML_COMMENT)) {
    // A comment a renderer hides but a model reads; a short one (a build marker) is not a mark.
    if ((m[1] ?? '').replace(/\s/gu, '').length >= 40) add({ kind: 'hidden-text', rule: 'html-comment', by: 'rules', start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(MD_COMMENT)) add({ kind: 'hidden-text', rule: 'markdown-comment', by: 'rules', start: m.index!, end: m.index! + m[0].length });
}

const URL = /https?:\/\/[^\s<>"'`)\]]{1,2000}/giu;
const PLACEHOLDER = /(?:\{\{|\$\{|%7B%7B|%24%7B|<[A-Z_]{2,30}>|%3C[A-Z_]{2,30}%3E|\[(?:DATA|SECRET|TOKEN|EMAIL|CONTEXT|INFO|INPUT|HISTORY|SUMMARY|PASSWORD)\]|=(?:DATA|SECRET|TOKEN|EMAIL|PASSWORD|HISTORY|SUMMARY)(?![a-z]))/u;
const LONG_VALUE = /[?&][a-z0-9_]{1,40}=[^&#\s]{120,}/iu;

function scanLinks(text: string, add: (m: Omit<RiskMark, 'excerpt'>) => void): void {
  for (const m of text.matchAll(URL)) {
    const url = m[0];
    const start = m.index!;
    if (PLACEHOLDER.test(url)) { add({ kind: 'exfil-link', rule: 'link-placeholder', by: 'rules', start, end: start + url.length }); continue; }
    // An image a reader fetches by itself: a long value in its address is how data leaves without a click.
    const before = text.slice(Math.max(0, start - 2), start);
    if (before.endsWith('](') && text.lastIndexOf('![', start) > text.lastIndexOf('\n', start) && LONG_VALUE.test(url)) {
      add({ kind: 'exfil-link', rule: 'image-link-value', by: 'rules', start, end: start + url.length });
    }
  }
}

const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}|[0-9a-fA-F]{200,}/gu;
const BASE64_LINE = /^[A-Za-z0-9+/=]{60,}$/u;

function scanEncoded(text: string, add: (m: Omit<RiskMark, 'excerpt'>) => void): void {
  for (const m of text.matchAll(BASE64_RUN)) {
    const start = m.index!;
    // An image or a font written into the text as a data URL is not a hidden message.
    if (/data:(?:image|font)\/[a-z0-9.+-]{1,40};base64,$/iu.test(text.slice(Math.max(0, start - 60), start))) continue;
    add({ kind: 'encoded-block', rule: 'base64-run', by: 'rules', start, end: start + m[0].length });
  }
  // Base64 wrapped into lines (a MIME part, a PEM block): three or more such lines in a row.
  let pos = 0; let runStart = -1; let runEnd = 0; let lines = 0;
  for (const line of text.split('\n')) {
    const bare = line.replace(/\r$/u, '');
    if (BASE64_LINE.test(bare) && bare.length < 200) {
      if (runStart < 0) { runStart = pos; lines = 0; }
      lines += 1; runEnd = pos + bare.length;
    } else {
      if (runStart >= 0 && lines >= 3) add({ kind: 'encoded-block', rule: 'base64-lines', by: 'rules', start: runStart, end: runEnd });
      runStart = -1;
    }
    pos += line.length + 1;
  }
  if (runStart >= 0 && lines >= 3) add({ kind: 'encoded-block', rule: 'base64-lines', by: 'rules', start: runStart, end: runEnd });
}

/**
 * Find the marks of the asked kinds in a text. Answers the marks in reading order, and `truncatedAt`
 * when only the first MAX_SCAN_CHARS characters were read.
 */
export function detectRiskRules(input: string, kinds: readonly RiskKind[]): { marks: RiskMark[]; truncatedAt?: number } {
  const text = input.length > MAX_SCAN_CHARS ? input.slice(0, MAX_SCAN_CHARS) : input;
  const want = new Set(kinds);
  const perKind = new Map<RiskKind, number>();
  const seen = new Set<string>();
  const found: RiskMark[] = [];
  const add = (m: Omit<RiskMark, 'excerpt'>): void => {
    if (!want.has(m.kind) || found.length >= MAX_MARKS) return;
    const n = perKind.get(m.kind) ?? 0;
    const id = `${m.kind}:${m.start}:${m.end}`;
    if (n >= MAX_PER_KIND || seen.has(id)) return;
    seen.add(id);
    perKind.set(m.kind, n + 1);
    found.push({ ...m, excerpt: excerptOf(text, m.start, m.end) });
  };
  for (const r of COMPILED) {
    if (!want.has(r.kind)) continue;
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      if (r.keep && !r.keep(m, text)) continue;
      add({ kind: r.kind, rule: `${r.kind}.${r.id}`, by: 'rules', start: m.index, end: m.index + m[0].length });
    }
  }
  if (want.has('hidden-text')) { scanInvisible(text, add); scanHidingMarkup(text, add); }
  if (want.has('exfil-link')) scanLinks(text, add);
  if (want.has('encoded-block')) scanEncoded(text, add);
  for (const m of found) {
    if (!m.rule.includes('.')) m.rule = `${m.kind}.${m.rule}`;
    m.fp = markFp(m.kind, m.rule, text.slice(m.start, m.end));
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  return { marks: found, ...(input.length > MAX_SCAN_CHARS ? { truncatedAt: MAX_SCAN_CHARS } : {}) };
}
