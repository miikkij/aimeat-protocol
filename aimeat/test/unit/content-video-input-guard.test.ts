/**
 * @file test/unit/content-video-input-guard.test.ts
 * @description ffprobe and ffmpeg read an upload only as the one temp file, with a demuxer for a
 *   media container: the temp file's extension comes from a fixed list (a playlist extension such as
 *   m3u8 becomes "bin"), and every run carries `-protocol_whitelist file` and a format_whitelist of
 *   media containers before the input. With FFmpeg installed, an HLS playlist naming another local
 *   MP4 yields none of that MP4's facts, while the MP4 itself is still read.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, ffprobe playlist demuxer).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as video from '../../src/services/content/extract-video.js';

const has = (bin: string): boolean => {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
};
const READY = has('ffprobe') && has('ffmpeg');

describe('the temp file and the input options', () => {
  it('a playlist or unknown extension names the temp file "bin"', () => {
    expect(video.mediaExt('m3u8')).toBe('bin');
    expect(video.mediaExt('m3u')).toBe('bin');
    expect(video.mediaExt('concat')).toBe('bin');
    expect(video.mediaExt('ffconcat')).toBe('bin');
    expect(video.mediaExt('sdp')).toBe('bin');
  });

  it('the media containers keep their own extension', () => {
    for (const e of ['mp4', 'MOV', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'ogg', 'flac']) expect(video.mediaExt(e)).toBe(e.toLowerCase());
  });

  it('ffprobe reads the input with a protocol and a format whitelist, before the input path', () => {
    const args = video.probeArgs('/tmp/x/input.bin');
    const at = (name: string) => args.indexOf(name);
    expect(args[at('-protocol_whitelist') + 1]).toBe('file');
    expect(args[at('-format_whitelist') + 1]).not.toMatch(/\b(hls|concat|applehttp)\b/);
    expect(at('-format_whitelist')).toBeLessThan(args.indexOf('/tmp/x/input.bin'));
  });
});

describe.skipIf(!READY)('with FFmpeg installed', () => {
  it('a playlist naming a local MP4 yields no facts of that MP4, and the MP4 itself is read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-guard-'));
    try {
      const mp4 = join(dir, 'other.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x48:rate=10', '-pix_fmt', 'yuv420p', mp4], { windowsHide: true });
      const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nfile:${mp4.replace(/\\/g, '/')}\n#EXT-X-ENDLIST\n`;
      const viaPlaylist = await video.probeVideo({ ffprobePath: 'ffprobe' }, Buffer.from(playlist), 'm3u8');
      expect(viaPlaylist.video).toBeUndefined();
      const direct = await video.probeVideo({ ffprobePath: 'ffprobe' }, readFileSync(mp4), 'mp4');
      expect(direct.video?.width).toBe(64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
