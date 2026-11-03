/**
 * @file src/services/content/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of the content class pipeline (wish wish-sis-ll-n-purku-luokittelu-ja-owl,
 *   brief brief-sisallon-purku-luokittelu-owl, 2026-10-20). Content arrives (a stored file, a memory
 *   record, a published workspace document); the pipeline reads what can be read from it without a
 *   model (the technical facts), then, only when the owner has turned them on, a description by a
 *   model (System 2), the content classes it belongs to (System 1, one yes-or-no question per class,
 *   so one item can belong to several), and the class's fields extracted into a JSON-LD entity typed
 *   by the class's OWL class (System 2).
 *
 *   TERMS. A "content class" is the kind of thing an item is (an invoice, a contract, a photo). It
 *   is NOT `classification`, which on this node means a sensitivity label, and NOT `content type`,
 *   which is the MIME type. Every content class is an OWL class in the owner's ontology.
 *
 *   SHAPE IN MEMORY. Every key sits under the owner's `contentclass.` prefix, which the node reads
 *   for behaviour (the settings decide what spends the owner's AI key), so it is reserved: a granted
 *   app does not write it (utils/reserved-keys.ts). The facts of every source live folded into
 *   FACT_SHARDS records (`contentclass.facts.<00..31>`), one entry per source, because one key per
 *   source would spend the 1000-key default ceiling on a few hundred files (production 2026-10-20:
 *   2535 files on the node, 1883 under its largest owner). The settings are
 *   `contentclass.settings`, the owner's classes and the proposals `contentclass.ontology`. The
 *   extracted text is a stored file of its own (`contentclass-text/<sourceHash>.txt`), never part of
 *   a memory value.
 * @structure ContentSource · TechnicalFacts (Pdf, Image, Video, Text) · AiMarks · ContentFacts ·
 *   ContentSettings · ContentClass · ClassProposal · StageName · STAGE_NAMES · ContentProfile ·
 *   ProfileTopic · ProfileSection
 * @usage import type { ContentFacts, ContentSource } from './types.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 *   v1.1.0 — 2026-10-21 — ClassProperty.label: the property's name for a person in fi, en and es.
 *   v1.2.0 — 2026-10-29 — PdfFacts.textNotRead: the text read reached the node's PDF read limit
 *     (secaudit2026oct26 round 8c, memory-b-09).
 *   v1.3.0 — 2026-11-02 — The `profile` stage and ContentFacts.profile: the fingerprint (wish
 *     wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse). STAGE_NAMES is the one
 *     list of stages the settings, the service and the tool catalog read.
 *   v1.4.0 — 2026-11-03 — ContentProfile.corrected: a person's correction of sections, and who made it.
 */

/** Where an item lives. The source id (sourceIdOf) is stable for the same item. */
export type ContentSource =
  | { kind: 'file'; owner: string; key: string }
  | { kind: 'memory'; owner: string; key: string };

/** The four kinds the pipeline tells apart, from the MIME type and the file name. */
export type ContentKind = 'pdf' | 'image' | 'video' | 'text' | 'other';

/** The stages, in the order they run. `technical` needs no model; the other five do. */
export type StageName = 'technical' | 'describe' | 'classify' | 'extract' | 'propose' | 'profile';
export const STAGE_NAMES: readonly StageName[] = ['technical', 'describe', 'classify', 'extract', 'propose', 'profile'];
export const AI_STAGES: readonly StageName[] = ['describe', 'classify', 'extract', 'propose', 'profile'];

/**
 * The kind of text a section is (profile.ts): F fact, A analysis, M opinion, O instruction,
 * P decision or plan, K narrative.
 */
export type ProfileGenre = 'F' | 'A' | 'M' | 'O' | 'P' | 'K';
/**
 * What a section rests on: + a source the reader can check, ~ an identified person or meeting,
 * ? nothing, x contradicted or replaced.
 */
export type ProfileMark = '+' | '~' | '?' | 'x';
/** The six directions a section or a topic leans, each -1 to 1. */
export type ProfileAxis = 'fakta' | 'konkr' | 'aika' | 'toim' | 'yks' | 'varm';

/** One topic of a profile: its share of the words, its main genre and mark, and its leaning. */
export interface ProfileTopic {
  name: string;
  /** Share of the item's words, 0 to 1. */
  share: number;
  genre: ProfileGenre;
  mark: ProfileMark;
  axes: Record<ProfileAxis, number>;
}

/**
 * The fingerprint of an item (the `profile` stage, profile.ts): the compact part kept in the facts.
 * The sections' headings, claims and per-section axes are a stored file of their own (detailKey),
 * so the facts shards stay small.
 */
export interface ContentProfile {
  /** The shape version, and the instruction version that produced it. */
  v: 1;
  prompt: string;
  /** The text model: all of the profile, or with `labels: 'decide'` the headings, claims and topics. */
  model: string;
  /**
   * Who labelled the sections: 'model' (the text model, everything in one answer) or 'decide' (the
   * decision model, profile-labels.ts). Seals made the two ways sit on different scales and are not
   * compared. Absent on a profile made before 2026-11-02 evening: 'model'.
   */
  labels?: 'model' | 'decide';
  /** With labels 'decide': the decision model, and its decision records. */
  labelModel?: string;
  decisionIds?: string[];
  provenanceId?: string;
  at: string;
  /** What the item is, in two or three words in its own language. */
  kind: string;
  topics: ProfileTopic[];
  /** Per section in reading order: [genre, words, certainty 0..1, mark, topic index]. */
  sections: Array<[ProfileGenre, number, number, ProfileMark, number]>;
  /** The item's leaning, the word-weighted mean of its sections. */
  axes: Record<ProfileAxis, number>;
  /** "contentclass-profile/<sourceHash>.json": the sections with their headings and claims. */
  detailKey?: string;
  /** Set when only the first part of a long text was profiled. */
  truncatedAt?: number;
  /**
   * Set when a person corrected sections (correct.ts, shared-profile.ts): who, when, and which
   * sections by `n`. A person's correction wins over the model's, and a run of the model on the
   * same words keeps it.
   */
  corrected?: { by: string; at: string; sections: number[] };
}

/** One piece of a text as profile.ts cut it, before anything labelled it. */
export interface TextSection { n: number; heading: string; text: string; words: number }

/** One section as the stored profile detail keeps it. */
export interface ProfileSection {
  n: number;
  heading: string;
  claim: string;
  words: number;
  genre: ProfileGenre;
  mark: ProfileMark;
  certainty: number;
  topic: number;
  axes: Record<ProfileAxis, number>;
}

/** A PDF's own metadata (the Info dictionary and its XMP packet) and its signatures. */
export interface PdfFacts {
  pages?: number;
  pdfVersion?: string;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  createdAt?: string;
  modifiedAt?: string;
  encrypted?: boolean;
  /** Whether the file carries a text layer; a scan without one needs a model to read. */
  hasTextLayer: boolean;
  /**
   * The text was not read: reading it reached the node's time limit (seconds) or memory limit (MB)
   * for a PDF whose decoded size could not be checked first (file-text/pdf-bounded.ts).
   */
  textNotRead?: { reason: 'time' | 'memory'; limit: number };
  signatures: {
    /** 'unchecked' when signature validation is off on this node, or the check failed. */
    verdict: 'unsigned' | 'valid' | 'invalid' | 'indeterminate' | 'unchecked';
    count: number;
    signers: Array<{
      name?: string;
      organisation?: string;
      country?: string;
      email?: string;
      level?: string;
      signedAt?: string;
      trusted?: boolean;
      integrity?: string;
      reason?: string;
      location?: string;
    }>;
    /** Whether the trust lists and revocation were asked over the network. */
    online: boolean;
  };
}

/** What a picture says about itself: EXIF, IPTC, XMP and the ICC profile. */
export interface ImageFacts {
  format?: string;
  width?: number;
  height?: number;
  bitDepth?: number;
  colorSpace?: string;
  iccProfile?: string;
  orientation?: number;
  camera?: { make?: string; model?: string; lens?: string; serial?: string };
  exposure?: { iso?: number; fNumber?: number; exposureTime?: string; focalLength?: number; flash?: string };
  /** ISO 8601 when the value carried a zone, otherwise the camera's local time as written. */
  takenAt?: string;
  createdAt?: string;
  modifiedAt?: string;
  software?: string;
  /** Present only when the picture carries a location. Private like every fact. */
  gps?: { lat: number; lon: number; altitude?: number };
  creator?: string;
  copyright?: string;
  credit?: string;
  title?: string;
  description?: string;
  /** The alt text the picture already carries (XMP Iptc4xmpCore:AltTextAccessibility). */
  altText?: string;
}

/** What ffprobe reports about a video (or an audio file). */
export interface VideoFacts {
  container?: string;
  durationSeconds?: number;
  bitRate?: number;
  video?: { codec?: string; width?: number; height?: number; fps?: number; pixelFormat?: string; bitDepth?: number; rotation?: number };
  audio?: { codec?: string; channels?: number; sampleRate?: number; language?: string };
  createdAt?: string;
  encoder?: string;
  camera?: { make?: string; model?: string };
  location?: string;
  title?: string;
  /** Why the probe gave nothing: ffprobe missing on this node, or the file did not open. */
  unavailable?: string;
}

/** A text's measure. The text itself is the stored text file, never this record. */
export interface TextFacts {
  chars: number;
  words: number;
  lines: number;
  /** Where the text came from: the file itself, a PDF's text layer, a model reading a picture. */
  from: 'file' | 'pdf-text-layer' | 'model' | 'memory';
}

/**
 * Whether the item says it was made by AI, and how it says so. Only what the item DECLARES is read:
 * the node's own provenance record, the IPTC DigitalSourceType in its XMP, a C2PA manifest. This is
 * not a detector, and `unknown` is the honest answer when the item says nothing
 * (docs/internal/EUAct/10-validators-and-ci.md: no bespoke AI detector).
 */
export interface AiMarks {
  verdict: 'ai-generated' | 'ai-assisted' | 'human' | 'unknown';
  /** Each statement found, so a reader sees which mark said what. */
  sources: Array<{
    from: 'node-record' | 'iptc' | 'c2pa' | 'exif-software';
    value: string;
    /** The verdict this one statement maps to. */
    says: AiMarks['verdict'];
  }>;
  c2pa?: {
    present: boolean;
    /** The C2PA validation outcome, as the reader library judged it. Chain of trust is not checked. */
    valid?: boolean;
    claimGenerator?: string;
    signer?: string;
    title?: string;
    actions?: string[];
    digitalSourceTypes?: string[];
    error?: string;
  };
  /** The node's own record, when the item carries one (GET /v1/provenance/{id}). */
  nodeRecordId?: string;
  /**
   * EU AI Act Art. 50 marking: whether the item carries a machine-readable mark that it is AI-made.
   * `marked` is true when an IPTC or C2PA statement says so; `required` when the verdict is
   * ai-generated and nothing marks it.
   */
  euAiAct: { marked: boolean; how: string[]; markMissing: boolean };
}

export interface TechnicalFacts {
  kind: ContentKind;
  mimeType: string;
  size: number;
  /** sha256 of the bytes (or of the stored value's text), "sha256:<hex>". A changed hash makes the facts stale. */
  contentHash: string;
  pdf?: PdfFacts;
  image?: ImageFacts;
  video?: VideoFacts;
  text?: TextFacts;
  ai: AiMarks;
  /** Readers that failed, by name, with the reason; the others still answered. */
  errors?: Record<string, string>;
}

/** One content class an item was judged to belong to. */
export interface ClassMembership {
  id: string;
  confidence: number;
  /** 'model' (System 1), 'owner' (set by hand), 'rule' (a decision rule's outcome). */
  by: 'model' | 'owner' | 'rule';
  decisionId?: string;
}

/** The facts the pipeline keeps about one source. */
export interface ContentFacts {
  source: ContentSource;
  sourceId: string;
  /** "contentclass-text/<sourceHash>.txt" when a text was kept for this source. */
  textKey?: string;
  technical: TechnicalFacts;
  /** System 2's description: alt text for a picture, a summary for a long text or a video. */
  description?: { text: string; altText?: string; model: string; provenanceId?: string; at: string };
  classes?: ClassMembership[];
  /** Per class id: the JSON-LD entity extracted with that class's properties. */
  entities?: Record<string, {
    entity: Record<string, unknown>;
    model: string;
    confidence: number;
    provenanceId?: string;
    at: string;
    /** Set when a person (or their AI) corrected values: those properties keep their value when the class is extracted again. */
    corrected?: { by: string; at: string; properties: string[] };
  }>;
  /** The fingerprint: what kind of material the item is and how far it can be trusted (profile.ts). */
  profile?: ContentProfile;
  /** Which stages ran, when; a stage left out did not run. */
  stages: Partial<Record<StageName, { at: string; ok: boolean; note?: string }>>;
  /** The hash the facts were read from. Differs from the source's current hash: stale. */
  readFrom: string;
  updatedAt: string;
}

/** The owner's choices, `contentclass.settings`. Defaults (Jouni, 2026-10-20): technical on, every AI stage off. */
export interface ContentSettings {
  /** Run the pipeline when content arrives. Off: only on request. */
  onArrival: boolean;
  stages: Record<StageName, boolean>;
  sources: { files: boolean; memory: boolean; workspace: boolean };
  /** A memory record or document shorter than this gets no facts on arrival (a short note needs none). */
  minTextChars: number;
  /**
   * How a proposed class or field becomes part of the ontology: 'ask' (waits for the owner), 'auto'
   * (approved at once), or 'rule' (the owner's decision rule `approvalRule` decides; its outcome
   * `act` approves, anything else waits).
   */
  approval: 'ask' | 'auto' | 'rule';
  approvalRule?: string;
  /** Ask trust lists and revocation over the network when a PDF's signatures are checked on arrival. */
  onlineSignatureChecks: boolean;
  /**
   * Models to use; empty: the owner's defaults. `profile` is the fingerprint's model; empty: the
   * node's (content_class.profile_model), and when that is empty too, `text`.
   */
  models: { text: string; vision: string; profile: string };
  /**
   * The language descriptions and alt texts are written in, as a BCP 47 tag ('fi', 'en', 'es').
   * Empty: the content's own language, and English for a picture with no words in it.
   */
  language: string;
}

export const DEFAULT_SETTINGS: ContentSettings = Object.freeze({
  onArrival: true,
  stages: Object.freeze({ technical: true, describe: false, classify: false, extract: false, propose: false, profile: false }),
  sources: Object.freeze({ files: true, memory: true, workspace: true }),
  minTextChars: 2000,
  approval: 'ask',
  onlineSignatureChecks: false,
  models: Object.freeze({ text: '', vision: '', profile: '' }),
  language: '',
}) as ContentSettings;

/** One property of a content class: an OWL datatype property. */
export interface ClassProperty {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  required: boolean;
  describe: string;
  /** The schema.org (or other) property it maps to, as a CURIE: "schema:totalPaymentDue". */
  sameAs?: string;
  /**
   * What a person reads in place of `name`, per language (each at most 80 characters). Every
   * built-in property has one; an owner or proposed property may lack it, and then `name` is shown.
   */
  label?: { fi: string; en: string; es?: string };
}

/**
 * One content class. Built-in ones come from the refinery's class packs and the packs below them
 * (data/content-classes.ts); the owner's own live in `contentclass.ontology`.
 */
export interface ContentClass {
  id: string;
  label: { fi: string; en: string; es?: string };
  /** One English sentence the classifier weighs. */
  describe: string;
  /** false: an item is filed under the class and nothing is extracted. */
  process: boolean;
  /** The class it specialises, as a CURIE ("schema:Invoice"): its rdfs:subClassOf. */
  type: string;
  /** The kinds of content the class can apply to; empty or absent: all. */
  kinds?: ContentKind[];
  properties: ClassProperty[];
  origin: 'builtin' | 'owner' | 'proposed';
  /** Set on an owner class: when it was added or last changed, and by whom. */
  at?: string;
  by?: string;
}

/** A class or a field a model proposed, waiting for the owner (or approved by their rule). */
export interface ClassProposal {
  id: string;
  kind: 'class' | 'properties';
  /** For 'properties': the class they would join. */
  classId?: string;
  class?: ContentClass;
  properties?: ClassProperty[];
  /** The item that gave rise to it. */
  sourceId: string;
  why: string;
  status: 'pending' | 'approved' | 'rejected';
  at: string;
  decidedAt?: string;
  decidedBy?: string;
}
