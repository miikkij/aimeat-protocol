/**
 * @file src/config/content-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's settings for the content class pipeline (services/content/): the switch
 *   that lets the pipeline run at all, and where the ffprobe and ffmpeg programs are.
 *
 *   ON BY DEFAULT, AND ON IT COSTS NOTHING. With the switch on, each owner's own settings decide
 *   what runs (contentclass.settings): the technical read, which calls no model, is on for every
 *   owner until they turn it off, and every stage that calls a model is off until they turn it on
 *   (Jouni, 2026-10-20). Off, nothing runs on arrival and every route and tool answers 404.
 *
 *   VIDEO NEEDS ffprobe AND ffmpeg ON THE MACHINE. Without them a video gets the facts every file
 *   gets (size, hash, provenance) and its facts say the probe was unavailable.
 *
 *   A PDF THE BUDGET CANNOT MEASURE is read under a time and a memory limit (pdf_text_seconds,
 *   pdf_text_memory_mb; 0 is no limit), wherever its text is read: the content facts, a chat
 *   attachment, the refinery.
 *
 *   A PICTURE'S OR VIDEO'S METADATA is read in a worker under a time and a memory limit
 *   (media_read_seconds, media_read_memory_mb; 0 is no limit; services/content/media-read-bounded.ts).
 * @structure ContentClassMode · ContentClassConfig · parseContentClassMode() · contentClassDefaults()
 * @usage
 *   import { contentClassDefaults } from './content-class.js';
 *   const config = { ...contentClassDefaults(), ... };
 * @version-history
 *   v1.4.0 — 2026-11-21 — The content risk marks' node settings (content_risk.*): the switch, the
 *     default detection and behaviour at each point, the operator's floors and the AI limit (wish
 *     wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 *   v1.3.0 — 2026-11-02 — contentClassProfileModel (content_class.profile_model): the fingerprint's
 *     model when the owner names none, DeepSeek V4 Pro by default (wish-aineiston-sormenj-lki-
 *     millaista-aineisto-on-yhdell-silm-ykse); contentClassProfileLabels (content_class.profile_labels),
 *     the decision model labelling the sections when it can.
 *   v1.2.0 — 2026-11-01 — mediaReadSeconds and mediaReadMemoryMb (secaudit2026oct31w2 round 12, the
 *     exifr and c2pa-ts readers).
 *   v1.1.0 — 2026-10-29 — pdfTextSeconds and pdfTextMemoryMb (secaudit2026oct26 round 8c, memory-b-09).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */

/** The node's content class switch. */
export type ContentClassMode = 'on' | 'off';

/**
 * Named here rather than in config-types.ts, for the reason config/decide.ts gives: AimeatConfig
 * extends this interface, and the spread in loadConfig is where the compiler checks the two agree.
 */
export interface ContentClassConfig {
  /** on (default): each owner's settings decide what runs. off: nothing runs, the routes answer 404. */
  contentClassMode: ContentClassMode;
  /** The ffprobe program, a name on PATH or a full path. */
  ffprobePath: string;
  /** The ffmpeg program, a name on PATH or a full path. */
  ffmpegPath: string;
  /**
   * The time limit, in seconds, for reading the text of a PDF whose decode cost the budget cannot
   * measure (services/file-text/pdf-bounded.ts). 0 is no limit.
   */
  pdfTextSeconds: number;
  /** The memory limit, in MB, for the same read. 0 is no limit. */
  pdfTextMemoryMb: number;
  /**
   * The time limit, in seconds, for reading a picture's or video's metadata with exifr and c2pa-ts
   * (services/content/media-read-bounded.ts). 0 is no limit.
   */
  mediaReadSeconds: number;
  /** The memory limit, in MB, for the same read. 0 is no limit. */
  mediaReadMemoryMb: number;
  /**
   * The model the fingerprint (the profile stage, services/content/profile.ts) runs on when the
   * owner named none of their own (contentclass.settings models.profile). Empty: the owner's text
   * model and defaults. The default is the model the instruction was measured on and chosen for.
   */
  contentClassProfileModel: string;
  /**
   * Who labels the fingerprint's sections: 'auto' (the decision model when the decision service is
   * on, and the text model writes only headings, claims and topics; services/content/profile-labels.ts)
   * or 'model' (the text model does all of it).
   */
  contentClassProfileLabels: 'auto' | 'model';
  /**
   * The content risk marks (services/content/risk.ts): on (default; the layers below decide what each
   * point does) or off (nothing extra runs anywhere, and no read carries marks).
   */
  contentRiskMode: 'on' | 'off';
  /** The node's default detection: rules (no model, no cost) or rules+ai. */
  contentRiskDetect: ContentRiskDetect;
  /** The operator's limit on detection: allow lets a layer choose rules+ai, deny keeps every layer at rules. */
  contentRiskAi: 'allow' | 'deny';
  /** The node's default behaviour at each point. A read has no hold. */
  contentRiskOnIntake: ContentRiskBehaviour;
  contentRiskOnSharedWrite: ContentRiskBehaviour;
  contentRiskOnRead: ContentRiskBehaviour;
  /** The operator's floor at each point: no organism, workspace or person goes below it. */
  contentRiskFloorIntake: ContentRiskBehaviour;
  contentRiskFloorSharedWrite: ContentRiskBehaviour;
  contentRiskFloorRead: ContentRiskBehaviour;
  /** The kinds of mark looked for by default, comma-separated. */
  contentRiskKinds: string;
}

/** A content risk point's behaviour (services/content/risk-types.ts RiskBehaviour). */
export type ContentRiskBehaviour = 'off' | 'mark' | 'mark+warn' | 'hold';
export type ContentRiskDetect = 'rules' | 'rules+ai';
/** The six kinds (risk-types.ts RISK_KINDS), named here because config sits below services. */
export const CONTENT_RISK_KIND_NAMES = ['ai-instruction', 'hidden-text', 'false-role', 'exfil-link', 'other-person-data', 'encoded-block'] as const;

function behaviourOr(v: unknown, fallback: ContentRiskBehaviour, read = false): ContentRiskBehaviour {
  const ok = read ? ['off', 'mark', 'mark+warn'] : ['off', 'mark', 'mark+warn', 'hold'];
  return typeof v === 'string' && ok.includes(v.trim()) ? (v.trim() as ContentRiskBehaviour) : fallback;
}

/** A comma list of kinds as configured, unknown names dropped; empty or absent: every kind. */
export function riskKindsOr(v: unknown): string {
  if (typeof v !== 'string') return CONTENT_RISK_KIND_NAMES.join(',');
  const names = v.split(',').map((s) => s.trim()).filter((s) => (CONTENT_RISK_KIND_NAMES as readonly string[]).includes(s));
  return v.trim() === '' ? CONTENT_RISK_KIND_NAMES.join(',') : [...new Set(names)].join(',');
}

/** A whole number 0 or above from the environment, else `fallback`. */
function wholeOrDefault(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) ? n : fallback;
}

/** An unknown value is `on`: the default, under which nothing that costs money runs unasked. */
export function parseContentClassMode(v: unknown): ContentClassMode {
  return v === 'off' ? 'off' : 'on';
}

/** A program path as configured, or the bare name when the value is empty or not a plain path. */
function programPath(v: unknown, name: string): string {
  return typeof v === 'string' && v.trim() && v.length <= 1024 && !/[\r\n\0]/.test(v) ? v.trim() : name;
}

/** The fingerprint's model unless the operator names another (measured 2026-11-02, Jouni's choice). */
export const DEFAULT_PROFILE_MODEL = '~deepseek/deepseek-pro-latest';

/** A model id as configured (an empty value is kept: it means the owner's own models), else the default. */
function modelId(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return s.length <= 200 && !/[\s\0]/.test(s) ? s : fallback;
}

/** The content class settings, from the environment. */
export function contentClassDefaults(): ContentClassConfig {
  return {
    contentClassMode: parseContentClassMode(process.env.AIMEAT_CONTENT_CLASS),
    ffprobePath: programPath(process.env.AIMEAT_FFPROBE_PATH, 'ffprobe'),
    ffmpegPath: programPath(process.env.AIMEAT_FFMPEG_PATH, 'ffmpeg'),
    // Above any real document (services/file-text/pdf-bounded.ts DEFAULT_PDF_TEXT_*).
    pdfTextSeconds: wholeOrDefault(process.env.AIMEAT_PDF_TEXT_SECONDS, 120),
    pdfTextMemoryMb: wholeOrDefault(process.env.AIMEAT_PDF_TEXT_MEMORY_MB, 1024),
    // Far above what a real picture's or video's metadata takes (media-read-bounded.ts DEFAULT_MEDIA_READ_*).
    mediaReadSeconds: wholeOrDefault(process.env.AIMEAT_MEDIA_READ_SECONDS, 30),
    mediaReadMemoryMb: wholeOrDefault(process.env.AIMEAT_MEDIA_READ_MEMORY_MB, 512),
    contentClassProfileModel: modelId(process.env.AIMEAT_CONTENT_PROFILE_MODEL, DEFAULT_PROFILE_MODEL),
    contentClassProfileLabels: process.env.AIMEAT_CONTENT_PROFILE_LABELS === 'model' ? 'model' : 'auto',
    // Content risk marks: on, rules only, a mark at intake and at a shared write, and a mark with a
    // warning line on read (docs/internal/content-risk-plan.md, the defaults).
    contentRiskMode: process.env.AIMEAT_CONTENT_RISK === 'off' ? 'off' : 'on',
    contentRiskDetect: process.env.AIMEAT_CONTENT_RISK_DETECT === 'rules+ai' ? 'rules+ai' : 'rules',
    contentRiskAi: process.env.AIMEAT_CONTENT_RISK_AI === 'deny' ? 'deny' : 'allow',
    contentRiskOnIntake: behaviourOr(process.env.AIMEAT_CONTENT_RISK_ON_INTAKE, 'mark'),
    contentRiskOnSharedWrite: behaviourOr(process.env.AIMEAT_CONTENT_RISK_ON_SHARED_WRITE, 'mark'),
    contentRiskOnRead: behaviourOr(process.env.AIMEAT_CONTENT_RISK_ON_READ, 'mark+warn', true),
    contentRiskFloorIntake: behaviourOr(process.env.AIMEAT_CONTENT_RISK_FLOOR_INTAKE, 'off'),
    contentRiskFloorSharedWrite: behaviourOr(process.env.AIMEAT_CONTENT_RISK_FLOOR_SHARED_WRITE, 'off'),
    contentRiskFloorRead: behaviourOr(process.env.AIMEAT_CONTENT_RISK_FLOOR_READ, 'off', true),
    contentRiskKinds: riskKindsOr(process.env.AIMEAT_CONTENT_RISK_KINDS),
  };
}
