/**
 * @file src/services/content/kind.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which of the content class pipeline's kinds a file is, from its MIME type and its
 *   file name. The kind decides which technical readers run (types.ts ContentKind).
 *
 *   The MIME type is checked first and the extension second, because a browser often sends
 *   `application/octet-stream` for a file it does not know, and the extension is then the only
 *   signal left.
 *
 *   AUDIO COUNTS AS VIDEO. An `audio/*` file is kind 'video': ffprobe reads audio-only files the same
 *   way as video files, and the video reader (extract-video.ts) reports an audio stream with no video
 *   stream. Whether a picture track is present is in VideoFacts.video, not in the kind.
 * @structure contentKindOf
 * @usage const kind = contentKindOf('image/png', 'cover.png'); // 'image'
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { ContentKind } from './types.js';

/** Non-text/* MIME types whose content is text a reader can measure. */
const TEXT_MIMES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/xhtml+xml',
  'application/x-ndjson', 'application/csv', 'application/markdown', 'application/x-markdown',
]);

const EXT_KIND: Record<string, ContentKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image',
  avif: 'image', tif: 'image', tiff: 'image', bmp: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'video', m4a: 'video', wav: 'video', ogg: 'video', oga: 'video', flac: 'video', aac: 'video', opus: 'video',
  txt: 'text', md: 'text', markdown: 'text', csv: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text',
};

/** The pipeline kind of a file: pdf, image, video (audio included), text or other. */
export function contentKindOf(mimeType: string, filename: string): ContentKind {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'video';
  if (mime.startsWith('text/') || TEXT_MIMES.has(mime) || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text';
  const dot = (filename || '').lastIndexOf('.');
  if (dot >= 0) {
    const ext = filename.slice(dot + 1).toLowerCase();
    if (Object.hasOwn(EXT_KIND, ext)) return EXT_KIND[ext];
  }
  return 'other';
}
