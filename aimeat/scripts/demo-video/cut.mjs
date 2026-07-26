/**
 * @file scripts/demo-video/cut.mjs
 * @description Cuts a recording at two speeds: what a person DOES plays at normal speed, what a
 *   person WAITS FOR is squeezed to a beat. One uniform speed cannot do both. At 6x the typing is
 *   a blur nobody can read, and a three-minute model call is still half a minute of a spinner.
 *
 *   It reads the marks record.mjs writes (one entry per step, with start and end in ms) and builds
 *   an ffmpeg filter that trims the source into segments and gives each its own setpts.
 * @usage node scripts/demo-video/cut.mjs scripts/demo-video/scenes.origami-live.json
 *        -> genimages/videos/<name>/<name>.mp4
 * @structure marks -> segments -> per-segment speed -> trim/setpts/concat -> h264
 * @version-history
 *   v1.0.0 - 2026-07-26 - written after the first complete take came out uniformly 6x and unreadable
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const spec = JSON.parse(readFileSync(resolve(process.cwd(), process.argv[2]), 'utf8'));
const name = spec.name || 'demo';
const dir = join(repo, 'genimages', 'videos', name);
const src = join(dir, `${name}.webm`);
const marksFile = join(dir, `${name}.marks.json`);
for (const f of [src, marksFile]) {
    if (!existsSync(f)) { console.error('missing ' + f + ' (run record.mjs first)'); process.exit(2); }
}

const W = (spec.output && spec.output.width) || 1440;
const H = (spec.output && spec.output.height) || 900;
const out = join(dir, `${name}.mp4`);

/* Steps where something visibly happens. Everything else is waiting, however it is spelled. */
const DOING = new Set(['type', 'click', 'press', 'centerOn', 'scroll', 'hover', 'caption', 'captionHide', 'zoom', 'dragBy', 'arrange']);
/* A pause between two actions still needs to read as a pause, so nothing plays faster than this
   in a doing segment, and no waiting segment is squeezed below a beat the eye can catch. */
const HOLD_AFTER_DOING_MS = 900;   // let a click land before the cut speeds up again
const WAIT_TARGET_MS = 1400;       // how long a wait should last in the finished cut
const WAIT_MIN_SPEED = 3;
const WAIT_MAX_SPEED = 60;

const { total, marks } = JSON.parse(readFileSync(marksFile, 'utf8'));
/* The first thing the camera sees is the board as it was left last time, because the take clears it
   and reloads. That is honest but it is not the story: the story starts on an empty surface. Drop
   everything before the last reload of the opening scene. */
const reloads = marks.map((m, i) => (m.type === 'goto' ? i : -1)).filter((i) => i >= 0);
const start = reloads.length > 1 ? reloads[reloads.length - 1] : 0;
if (start > 0) {
    /* Drop the reload itself too, not just what came before it: a page keeps showing the old
       document until the new one paints, so starting at the navigation still opens on the board
       as it was left last time. */
    const from = Math.round(marks[start].to / 1000);
    console.log(`[cut] opening on the empty surface: dropped ${start + 1} mark(s), the first ${from}s`);
    marks.splice(0, start + 1);
}
if (!marks.length) { console.error('no marks'); process.exit(2); }

/* Merge neighbouring steps of the same kind so the filter stays short: ffmpeg is happy with a
   hundred segments and unhappy with a thousand. */
const spans = [];
for (const m of marks) {
    const doing = DOING.has(m.type);
    const last = spans[spans.length - 1];
    if (last && last.doing === doing) { last.to = m.to; last.what.push(m.type); continue; }
    spans.push({ doing, from: m.from, to: m.to, what: [m.type] });
}
/* A doing span keeps a moment of the wait that follows it, so an action is never cut off mid-gesture. */
for (let i = 0; i < spans.length - 1; i++) {
    if (spans[i].doing && !spans[i + 1].doing) {
        const grab = Math.min(HOLD_AFTER_DOING_MS, Math.max(0, spans[i + 1].to - spans[i + 1].from - 200));
        spans[i].to += grab;
        spans[i + 1].from += grab;
    }
}

const segs = spans
    .map((s) => {
        const dur = Math.max(0, s.to - s.from);
        if (!dur) return null;
        const speed = s.doing
            ? 1
            : Math.min(WAIT_MAX_SPEED, Math.max(WAIT_MIN_SPEED, dur / WAIT_TARGET_MS));
        return { ...s, dur, speed };
    })
    .filter(Boolean);

const filter = segs.map((s, i) =>
    `[0:v]trim=start=${(s.from / 1000).toFixed(3)}:end=${(s.to / 1000).toFixed(3)},` +
  `setpts=(PTS-STARTPTS)/${s.speed.toFixed(3)}[v${i}]`).join(';');
const concat = segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0[cv]`;
const scale = `[cv]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
  `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0B0D11,fps=30,format=yuv420p[v]`;

const cutLen = segs.reduce((n, s) => n + s.dur / s.speed, 0);
console.log(`[cut] ${segs.length} segments · source ${Math.round(total / 1000)}s -> cut ${Math.round(cutLen / 1000)}s`);
for (const s of segs.slice(0, 40)) {
    console.log(`   ${s.doing ? 'play ' : 'skim '} ${(s.dur / 1000).toFixed(1)}s @${s.speed.toFixed(1)}x  ${[...new Set(s.what)].join(',')}`);
}

execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-filter_complex', `${filter};${concat};${scale}`, '-map', '[v]',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', out],
{ stdio: 'inherit' });
console.log('[cut] wrote', out);
