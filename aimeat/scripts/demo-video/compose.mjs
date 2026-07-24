/**
 * @file scripts/demo-video/compose.mjs
 * @description ffmpeg post-processing for AIMEAT demo videos. Takes the raw webm from
 *   record.mjs and produces a distribution mp4 (H.264, yuv420p, faststart) at 1080x1920.
 *   Optionally prepends a title card, appends an end card, and mixes a background music
 *   track (looped/trimmed to length with a fade-out). Pure ffmpeg, no extra deps.
 * @usage node scripts/demo-video/compose.mjs scripts/demo-video/scenes.<name>.json
 * @structure probe duration -> build optional title/end cards -> concat -> mux music -> mp4
 * @version-history v0.1.0 - 2026-07-25 - initial compose pipeline (PoC)
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const OUT_ROOT = join(REPO_ROOT, 'genimages', 'videos');

const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage: node compose.mjs <scenes.json>'); process.exit(1); }
const m = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const name = m.name || 'demo';
const dir = join(OUT_ROOT, name);
const src = join(dir, `${name}.webm`);
if (!existsSync(src)) { console.error('missing ' + src + ' (run record.mjs first)'); process.exit(2); }
const W = (m.output && m.output.width) || 1080;
const H = (m.output && m.output.height) || 1920;
const out = join(dir, `${name}.mp4`);

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");

const parts = [];

// Optional title card (solid house color + centered text) rendered to its own mp4.
function card(kind, spec) {
  const secs = spec.seconds || 2.2;
  const file = join(dir, `_${kind}.mp4`);
  const title = esc(spec.title || '');
  const subtitle = esc(spec.subtitle || '');
  const bg = spec.bg || '0x0B0D11';
  const FB = 'C\\:/Windows/Fonts/arialbd.ttf'; // bold
  const FR = 'C\\:/Windows/Fonts/arial.ttf';   // regular
  const draw = [
    `drawtext=fontfile='${FB}':text='${title}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-40`,
    subtitle ? `drawtext=fontfile='${FR}':text='${subtitle}':fontcolor=0xE8564A:fontsize=38:x=(w-text_w)/2:y=(h-text_h)/2+70` : null,
  ].filter(Boolean).join(',');
  ff(['-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:d=${secs}:r=30`,
      '-vf', draw, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', file]);
  return file;
}

if (m.intro) parts.push(card('intro', m.intro));

// Main recording -> normalized mp4 (exact size, 30fps, h264).
const body = join(dir, '_body.mp4');
ff(['-i', src, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0B0D11,fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', body]);
parts.push(body);

if (m.outro) parts.push(card('outro', m.outro));

// Concat parts (all share codec/params) via the concat demuxer.
let silent = join(dir, '_silent.mp4');
if (parts.length === 1) {
  silent = parts[0];
} else {
  const listFile = join(dir, '_concat.txt');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);
}

// Optional background music: loop/trim to video length with a 1.5s fade-out.
if (m.music) {
  const mus = resolve(dirname(resolve(manifestPath)), m.music);
  if (existsSync(mus)) {
    const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent]).toString().trim());
    const vol = m.musicVolume ?? 0.5;
    ff(['-i', silent, '-stream_loop', '-1', '-i', mus,
        '-filter_complex', `[1:a]volume=${vol},afade=t=out:st=${Math.max(0, dur - 1.5)}:d=1.5[a]`,
        '-map', '0:v', '-map', '[a]', '-t', `${dur}`,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  } else {
    console.warn('[compose] music not found: ' + mus + ' (skipping audio)');
    ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', out]);
  }
} else {
  ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', out]);
}

console.log(`[compose] wrote ${out}`);
