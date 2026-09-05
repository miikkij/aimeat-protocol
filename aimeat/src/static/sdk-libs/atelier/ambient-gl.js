/**
 * @file atelier/ambient-gl.js
 * @description The WebGL tier of the wave — the one preset that earns a shader, because the
 *   ribbon's glow is a per-pixel distance field and a fragment shader draws it for the price of
 *   a full-screen triangle. It is an ENHANCEMENT, never the floor: ambient.js paints the Canvas
 *   2D wave first (the synchronous first frame the Design Book's bench reads), asks here for a
 *   context, and goes back to 2D the moment the context is refused or lost. `null` from
 *   glWaves() means "not on this machine"; nothing else needs to know why.
 *
 *   The context asks for low power and refuses a software renderer
 *   (failIfMajorPerformanceCaveat): a wave that costs a laptop its battery is worse than the
 *   2D one. The output is premultiplied, so the browser composites it over the page the same
 *   way the 2D tier's blit lands. No colour lives here: the three ribbon colours arrive as
 *   bytes from the palette and become uniforms.
 * @structure glWaves(canvas, palette, peak) → { frame, setPalette, destroy } | null
 * @usage
 *   const gl = glWaves(canvas, palette, 0.35);
 *   if (gl) gl.frame(seconds); else drawWith2d();
 * @version-history
 *   v0.47.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 3).
 */

const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

// Three ribbons, each a sine over the width with a second, faster sine riding on it; the core
// is a smoothstep band and the glow an exponential fall-off from the centre line. The sum is the
// coverage; the colour is the coverage-weighted mix, kept premultiplied.
const FRAG = [
  'precision mediump float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform vec3 u_c0;',
  'uniform vec3 u_c1;',
  'uniform vec3 u_c2;',
  'uniform float u_peak;',
  'float ribbon(vec2 uv, float base, float a1, float k1, float w1, float a2, float k2, float w2, float thick) {',
  '  float y = base + a1 * sin(k1 * uv.x + w1 * u_time) + a2 * sin(k2 * uv.x - w2 * u_time);',
  '  float d = abs(uv.y - y);',
  '  float core = 1.0 - smoothstep(0.0, thick, d);',
  '  float glow = exp(-d * 14.0) * 0.45;',
  '  return core * 0.85 + glow;',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float r0 = ribbon(uv, 0.60, 0.06, 7.0, 0.30, 0.025, 19.0, 0.50, 0.060);',
  '  float r1 = ribbon(uv, 0.48, 0.08, 5.5, 0.22, 0.030, 15.0, 0.40, 0.070);',
  '  float r2 = ribbon(uv, 0.37, 0.05, 8.5, 0.36, 0.020, 23.0, 0.60, 0.050);',
  '  float sum = r0 + r1 + r2;',
  '  vec3 col = (u_c0 * r0 + u_c1 * r1 + u_c2 * r2) / max(1.0, sum);',
  '  float a = clamp(sum, 0.0, 1.0);',
  '  gl_FragColor = vec4(col * a * u_peak, a * u_peak);',
  '}',
].join('\n');

/**
 * @param {WebGLRenderingContext} gl
 * @param {number} kind
 * @param {string} src
 * @returns {WebGLShader|null}
 */
function compile(gl, kind, src) {
  const sh = gl.createShader(kind);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * The shader wave on `canvas`, or null when this machine will not give a fast context.
 * @param {HTMLCanvasElement} canvas
 * @param {{ accent: number[], spectrum2: number[], spectrum3: number[] }} palette
 * @param {number} peak  the strongest coverage the ribbons may reach (the registry's peak)
 * @returns {{ frame: (t: number) => void, setPalette: (p: any) => void, destroy: () => void }|null}
 */
export function glWaves(canvas, palette, peak) {
  let gl = null;
  try {
    gl = /** @type {WebGLRenderingContext|null} */ (canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    }));
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  // One triangle that covers the clip space; the fragment shader does the rest.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {
    res: gl.getUniformLocation(program, 'u_res'),
    time: gl.getUniformLocation(program, 'u_time'),
    c0: gl.getUniformLocation(program, 'u_c0'),
    c1: gl.getUniformLocation(program, 'u_c1'),
    c2: gl.getUniformLocation(program, 'u_c2'),
    peak: gl.getUniformLocation(program, 'u_peak'),
  };
  gl.uniform1f(u.peak, peak);
  gl.clearColor(0, 0, 0, 0);

  /** @param {WebGLUniformLocation|null} where @param {number[]} c */
  function colour(where, c) {
    gl.uniform3f(where, c[0] / 255, c[1] / 255, c[2] / 255);
  }
  function setPalette(p) {
    colour(u.c0, p.accent);
    colour(u.c1, p.spectrum2);
    colour(u.c2, p.spectrum3);
  }
  setPalette(palette);

  return {
    /** @param {number} t seconds on the layer's clock */
    frame(t) {
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, t);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    setPalette,
    destroy() {
      try {
        gl.deleteBuffer(buf);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch {
        // A context already gone has nothing left to release.
      }
    },
  };
}
