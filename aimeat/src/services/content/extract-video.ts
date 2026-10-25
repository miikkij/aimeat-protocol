/**
 * @file src/services/content/extract-video.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a video or an audio file says about itself, read with ffprobe, and the two
 *   things a model needs to describe one: a few frames as JPEG and the start of the sound track as a
 *   small mono file, both made with ffmpeg (types.ts VideoFacts).
 *
 *   BINARIES. ffprobe and ffmpeg are external programs. Their paths come in as arguments (the
 *   caller reads them from the node's settings); each is run with execFile, never through a shell,
 *   and killed when the timeout (default 60 s) runs out. A node without them still works: probeVideo
 *   answers `{ unavailable: 'ffprobe is not installed on this node' }`, videoFrames an empty array
 *   and videoAudio null. None of the three throws.
 *
 *   TEMP FILES. The bytes are written to a new directory under os.tmpdir() (mkdtemp), named
 *   "input.<ext>" where ext is a known media container's extension or "bin" (mediaExt), so no user
 *   input reaches a file name or a command line. The directory is removed in finally.
 *
 *   INPUT GUARD. Every run reads its input with `-protocol_whitelist file` and a format_whitelist
 *   of media containers (INPUT_GUARD), so a playlist or concat file cannot make FFmpeg open other
 *   files on the host.
 * @structure probeVideo · videoFrames · videoAudio · withTempInput · run · parseFps · rotationOf ·
 *   mediaExt · probeArgs · INPUT_GUARD
 * @usage
 *   const facts = await probeVideo({ ffprobePath: 'ffprobe' }, bytes, 'mp4');
 *   const frames = await videoFrames({ ffmpegPath: 'ffmpeg' }, bytes, 'mp4', 4, facts.durationSeconds);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: the temp file is named from a fixed list of media
 *     extensions, and ffprobe and ffmpeg read it with a protocol and a format whitelist.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import type { VideoFacts } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
/** Frames are scaled to fit this many pixels on the long side, and never scaled up. */
const FRAME_MAX_SIDE = 768;
/** ffprobe JSON for a long file with many streams stays well under this. */
const PROBE_MAX_BUFFER = 8 * 1024 * 1024;

type RunError = Error & { code?: string | number; killed?: boolean; signal?: string | null; stderr?: string };

/** Runs a binary without a shell; rejects with the child's error, stderr attached. */
function run(bin: string, args: string[], timeoutMs: number, maxBuffer = 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const e = err as RunError;
        e.stderr = String(stderr ?? '');
        reject(e);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * The media containers the pipeline reads. The temp file is named with one of these extensions or
 * "bin", never with the uploader's own: FFmpeg picks a demuxer from the extension and the bytes, and
 * an extension such as m3u8 selects a playlist demuxer that opens further files the playlist names.
 */
const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'm4a', '3gp', '3g2', 'mkv', 'mka', 'webm', 'avi', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts',
  'flv', 'ogg', 'ogv', 'oga', 'opus', 'mp3', 'wav', 'flac', 'aac', 'wma', 'wmv', 'asf', 'aif', 'aiff', 'amr', 'caf', 'ac3',
]);

/**
 * The demuxers ffprobe and ffmpeg may use on an upload (FFmpeg's format_whitelist), and the one
 * protocol (the local temp file). A playlist or concat demuxer, which opens other files by name, is
 * not on the list, so whatever the bytes say, only the one temp file is read.
 */
const FORMAT_WHITELIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,flv,ogg,mp3,wav,w64,flac,aac,asf,aiff,amr,caf,ac3,eac3';
/** Input options placed before the input path on every run. */
export const INPUT_GUARD = ['-protocol_whitelist', 'file', '-format_whitelist', FORMAT_WHITELIST];

/** The extension the temp file gets: a known media container's, or "bin". */
export function mediaExt(ext: string): string {
  const e = (ext || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return MEDIA_EXTENSIONS.has(e) ? e : 'bin';
}

/** The ffprobe arguments for one temp input. */
export function probeArgs(input: string): string[] {
  return ['-v', 'error', ...INPUT_GUARD, '-print_format', 'json', '-show_format', '-show_streams', input];
}

/** Writes the bytes to a fresh temp directory, runs fn with the file path, removes the directory. */
async function withTempInput<T>(bytes: Buffer, ext: string, fn: (input: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'aimeat-media-'));
  try {
    const input = join(dir, `input.${mediaExt(ext)}`);
    await writeFile(input, bytes);
    return await fn(input, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((err: unknown) => {
      logger.warn(`[content] temp directory ${dir} was not removed: ${(err as Error)?.message || String(err)}`);
    });
  }
}

/** A short reason for a failed run: the binary missing, a timeout, or the last stderr line. */
function reasonOf(err: unknown, bin: 'ffprobe' | 'ffmpeg'): string {
  const e = err as RunError;
  if (e?.code === 'ENOENT') return `${bin} is not installed on this node`;
  if (e?.killed || e?.signal === 'SIGKILL') return `${bin} timed out`;
  const line = (e?.stderr ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
  return (line || e?.message || `${bin} failed`).slice(0, 200);
}

/** "30000/1001" gives 29.97; "0/0" and garbage give undefined. */
function parseFps(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const [n, d] = v.split('/').map(Number);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const fps = d ? n / d : n;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : undefined;
}

const numOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const strOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

type Stream = Record<string, unknown> & { tags?: Record<string, unknown>; side_data_list?: Array<Record<string, unknown>> };

/** Rotation from the display matrix side data, or the older `rotate` tag. */
function rotationOf(s: Stream): number | undefined {
  for (const sd of s.side_data_list ?? []) {
    const r = numOf(sd.rotation);
    if (r !== undefined) return r;
  }
  return numOf(s.tags?.rotate);
}

/** Drops undefined keys. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * The container, duration, streams and format tags of a video or audio file.
 * @param {{ffprobePath: string, timeoutMs?: number}} opts - The ffprobe binary and the timeout.
 * @param {Buffer} bytes - The file.
 * @param {string} ext - Its extension, used only to name the temp file.
 * @returns {Promise<VideoFacts>} The facts, or `{ unavailable }` with the reason.
 */
export async function probeVideo(opts: { ffprobePath: string; timeoutMs?: number }, bytes: Buffer, ext: string): Promise<VideoFacts> {
  try {
    return await withTempInput(bytes, ext, async (input) => {
      const { stdout } = await run(opts.ffprobePath, probeArgs(input), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, PROBE_MAX_BUFFER);
      const json = JSON.parse(stdout) as { format?: Record<string, unknown> & { tags?: Record<string, unknown> }; streams?: Stream[] };
      const format = json.format ?? {};
      const tags = format.tags ?? {};
      const streams = json.streams ?? [];
      // An embedded cover picture is a video stream with disposition attached_pic; it is not the video.
      const v = streams.find(s => s.codec_type === 'video' && !(s.disposition as Record<string, unknown> | undefined)?.attached_pic);
      const a = streams.find(s => s.codec_type === 'audio');
      const tag = (k: string): string | undefined => strOf(tags[k]) ?? strOf(tags[k.toLowerCase()]);

      const facts: VideoFacts = compact({
        container: strOf(format.format_name),
        durationSeconds: numOf(format.duration) ?? numOf(v?.duration) ?? numOf(a?.duration),
        bitRate: numOf(format.bit_rate),
        video: v ? compact({
          codec: strOf(v.codec_name),
          width: numOf(v.width),
          height: numOf(v.height),
          fps: parseFps(v.avg_frame_rate) ?? parseFps(v.r_frame_rate),
          pixelFormat: strOf(v.pix_fmt),
          bitDepth: numOf(v.bits_per_raw_sample),
          rotation: rotationOf(v),
        }) : undefined,
        audio: a ? compact({
          codec: strOf(a.codec_name),
          channels: numOf(a.channels),
          sampleRate: numOf(a.sample_rate),
          language: strOf(a.tags?.language),
        }) : undefined,
        createdAt: tag('creation_time') ?? tag('com.apple.quicktime.creationdate'),
        encoder: tag('encoder'),
        camera: (tag('com.apple.quicktime.make') || tag('com.apple.quicktime.model') || tag('make') || tag('model'))
          ? compact({ make: tag('com.apple.quicktime.make') ?? tag('make'), model: tag('com.apple.quicktime.model') ?? tag('model') })
          : undefined,
        location: tag('com.apple.quicktime.location.ISO6709') ?? tag('location'),
        title: tag('title'),
      });
      return facts;
    });
  } catch (err) {
    return { unavailable: reasonOf(err, 'ffprobe') };
  }
}

/** The ffmpeg scale filter that fits the long side to FRAME_MAX_SIDE without scaling up. */
const SCALE = `scale=w='min(${FRAME_MAX_SIDE},iw)':h='min(${FRAME_MAX_SIDE},ih)':force_original_aspect_ratio=decrease`;

/**
 * `count` JPEG frames spread evenly over the file, each fitted to 768 px on the long side.
 * @param {{ffmpegPath: string, timeoutMs?: number}} opts - The ffmpeg binary and the timeout per run.
 * @param {Buffer} bytes - The file.
 * @param {string} ext - Its extension, used only to name the temp file.
 * @param {number} count - How many frames.
 * @param {number} [durationSeconds] - The duration from probeVideo; without it, one frame per second from the start.
 * @returns {Promise<Buffer[]>} The JPEG frames; empty when ffmpeg is missing or fails.
 */
export async function videoFrames(
  opts: { ffmpegPath: string; timeoutMs?: number }, bytes: Buffer, ext: string, count: number, durationSeconds?: number,
): Promise<Buffer[]> {
  const n = Math.max(0, Math.min(64, Math.floor(count)));
  if (!n) return [];
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await withTempInput(bytes, ext, async (input, dir) => {
      const frames: Buffer[] = [];
      if (durationSeconds && durationSeconds > 0) {
        for (let i = 0; i < n; i++) {
          const at = (durationSeconds * (i + 0.5)) / n;
          const out = join(dir, `frame-${i}.jpg`);
          await run(opts.ffmpegPath,
            ['-v', 'error', '-y', '-ss', at.toFixed(3), ...INPUT_GUARD, '-i', input, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], timeout);
          frames.push(await readFile(out));
        }
        return frames;
      }
      const pattern = join(dir, 'frame-%03d.jpg');
      await run(opts.ffmpegPath,
        ['-v', 'error', '-y', ...INPUT_GUARD, '-i', input, '-vf', `fps=1,${SCALE}`, '-frames:v', String(n), '-q:v', '4', pattern], timeout);
      // A clip shorter than n seconds gives fewer frames than asked; only the files written are read.
      for (let i = 1; i <= n; i++) {
        const file = join(dir, `frame-${String(i).padStart(3, '0')}.jpg`);
        if (existsSync(file)) frames.push(await readFile(file));
      }
      return frames;
    });
  } catch (err) {
    logger.debug(`[content] video frames not made: ${reasonOf(err, 'ffmpeg')}`);
    return [];
  }
}

/**
 * The first `maxSeconds` of the sound track as mono 16 kHz MP3, or WAV when this ffmpeg has no MP3
 * encoder.
 * @param {{ffmpegPath: string, timeoutMs?: number}} opts - The ffmpeg binary and the timeout per run.
 * @param {Buffer} bytes - The file.
 * @param {string} ext - Its extension, used only to name the temp file.
 * @param {number} maxSeconds - How much of the start to keep.
 * @returns {Promise<Buffer|null>} The audio; null when there is no audio stream, ffmpeg is missing or fails.
 */
export async function videoAudio(
  opts: { ffmpegPath: string; timeoutMs?: number }, bytes: Buffer, ext: string, maxSeconds: number,
): Promise<Buffer | null> {
  const seconds = Math.max(1, Math.floor(maxSeconds));
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await withTempInput(bytes, ext, async (input, dir) => {
      const base = ['-v', 'error', '-y', ...INPUT_GUARD, '-i', input, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-t', String(seconds)];
      const mp3 = join(dir, 'audio.mp3');
      try {
        await run(opts.ffmpegPath, [...base, '-c:a', 'libmp3lame', '-b:a', '32k', mp3], timeout);
        return await readFile(mp3);
      } catch (err) {
        const e = err as RunError;
        if (e?.code === 'ENOENT' || !/encoder|libmp3lame/i.test(e?.stderr ?? '')) throw err;
      }
      const wav = join(dir, 'audio.wav');
      await run(opts.ffmpegPath, [...base, '-c:a', 'pcm_s16le', wav], timeout);
      return await readFile(wav);
    });
  } catch (err) {
    // No audio stream is the common case here: ffmpeg refuses '-map 0:a:0' when there is none.
    logger.debug(`[content] audio not extracted: ${reasonOf(err, 'ffmpeg')}`);
    return null;
  }
}
