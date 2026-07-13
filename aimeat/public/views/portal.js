/**
 * @file portal.js
 * @description Portal (Genesis 001) view module — main landing page with 3D
 *   canvas, live feed, mega-prompts, and expandable world.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Component unification (#11): live-feed header dot uses
 *     canonical <StatusDot status="live" /> instead of bespoke .live-dot.
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.2.0 — 2026-07-13 — Extracted mega-prompt builders → portal.prompts.js, auth/time
 *     helpers → portal.helpers.js, and feed/prompt/world sub-components →
 *     portal.components.js (max-file-lines); behavior unchanged.
 */
import { h } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import htm from "htm";
import { t } from "/js/i18n.js";
import { useViewCSS } from "/components/useViewCSS.js";
import { hasAuth, getCurrentSession, sessionDisplayName } from "./portal.helpers.js";
import { OnelinersFeed, PromptSection, TheWorld } from "./portal.components.js";

const html = htm.bind(h);

/* ══════════════════════════════════════════════
   GENESIS BADGE COMPONENT
   ══════════════════════════════════════════════ */
function GenesisCanvas() {
  return html`
    <section class="gn-hero-3d" style="display:flex;align-items:center;justify-content:center;min-height:200px">
      <img src="/img/genesis-001-badge.png" alt="Genesis Badge" style="height:auto;filter:drop-shadow(0 4px 16px rgba(0,0,0,.12))" />
      <div class="genesis-corner genesis-corner--tl"></div>
      <div class="genesis-corner genesis-corner--tr"></div>
      <div class="genesis-corner genesis-corner--bl"></div>
      <div class="genesis-corner genesis-corner--br"></div>
    </section>
  `;
}

/* Three.js 3D canvas + snake game removed — replaced with static badge image
   Original: ~500 lines of WebGL point cloud, bitmap font renderer, and snake game
   function buildTextMap(cols, rows, mode, score, blinkOn) {
      const TW = 960, TH = 480;
      const cv = document.createElement('canvas');
      cv.width = TW; cv.height = TH;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, TW, TH);

      const baseAlpha = (mode === 'playing') ? 0.6 : 1.0;
      const gPasses = [
        {blur:28,alpha:0.15*baseAlpha},{blur:16,alpha:0.28*baseAlpha},
        {blur:8,alpha:0.45*baseAlpha},{blur:4,alpha:0.65*baseAlpha},
        {blur:1,alpha:0.85*baseAlpha},{blur:0,alpha:1.00*baseAlpha}
      ];
      for (let p = 0; p < gPasses.length; p++) {
        cx.save(); cx.globalAlpha = gPasses[p].alpha;
        cx.globalCompositeOperation = 'lighter';
        cx.filter = gPasses[p].blur > 0 ? 'blur(' + gPasses[p].blur + 'px)' : 'none';
        cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.font = '900 108px Arial Black, Impact, sans-serif';
        cx.fillText('GENESIS', TW/2, TH*0.33 + 4);
        cx.font = '900 80px Arial Black, Impact, sans-serif';
        cx.fillText('001', TW/2, TH*0.72 - 42);
        cx.restore();
      }

      if (mode === 'playing' || mode === 'dead') {
        const glowText = (text, x, y, size, maxBlur) => {
          maxBlur = maxBlur || 20;
          const passes = [
            {blur:maxBlur,alpha:0.12},{blur:maxBlur/2,alpha:0.25},{blur:maxBlur/4,alpha:0.45},
            {blur:2,alpha:0.70},{blur:0,alpha:1.00}
          ];
          for (let pp = 0; pp < passes.length; pp++) {
            cx.save(); cx.globalAlpha = passes[pp].alpha;
            cx.globalCompositeOperation = 'lighter';
            cx.filter = passes[pp].blur > 0 ? 'blur(' + passes[pp].blur + 'px)' : 'none';
            cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.font = '900 ' + size + 'px Arial Black, Impact, sans-serif';
            cx.fillText(text, x, y);
            cx.restore();
          }
        };
        glowText(String(score).padStart(4, '0'), TW * 0.82, TH * 0.14, 52, 16);
      }

      // Bitmap font
      const BMFONT = {
        ' ':[0,0,0,0,0],
        'A':[62,9,9,9,62],'B':[127,73,73,73,54],'C':[62,65,65,65,34],
        'D':[127,65,65,65,62],'E':[127,73,73,73,65],'F':[127,9,9,9,1],
        'G':[62,65,73,73,58],'H':[127,8,8,8,127],'I':[0,65,127,65,0],
        'J':[32,64,65,63,1],'K':[127,8,20,34,65],'L':[127,64,64,64,64],
        'M':[127,2,12,2,127],'N':[127,4,8,16,127],'O':[62,65,65,65,62],
        'P':[127,9,9,9,6],'Q':[62,65,81,33,94],'R':[127,9,25,41,70],
        'S':[38,73,73,73,50],'T':[1,1,127,1,1],'U':[63,64,64,64,63],
        'V':[31,32,64,32,31],'W':[63,64,48,64,63],'X':[99,20,8,20,99],
        'Y':[3,4,120,4,3],'Z':[97,81,73,69,67],
        '0':[62,81,73,69,62],'1':[0,66,127,64,0],'2':[66,97,81,73,70],
        '3':[33,65,73,77,51],'4':[24,20,18,127,16],'5':[39,69,69,69,57],
        '6':[60,74,73,73,48],'7':[1,113,9,5,3],'8':[54,73,73,73,54],
        '9':[6,73,73,41,30],
        '[':[0,127,65,65,0],']':[0,65,65,127,0],'/':[96,16,8,4,3],
        '\\':[3,4,8,16,96],'.':[0,96,96,0,0],':':[0,54,54,0,0],
        '!':[0,0,95,0,0],'-':[8,8,8,8,8],'_':[64,64,64,64,64]
      };
      const CHAR_W = 5, CHAR_H = 7, CHAR_GAP = 1;

      function drawBitmapText(text, gridX, gridY, map, mapCols) {
        let cx2 = gridX;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i].toUpperCase();
          const glyph = BMFONT[ch] || BMFONT[' '];
          for (let col2 = 0; col2 < CHAR_W; col2++) {
            const colBits = glyph[col2];
            for (let row2 = 0; row2 < CHAR_H; row2++) {
              if (colBits & (1 << row2)) {
                const gc = cx2 + col2;
                const gr = gridY + row2;
                if (gc >= 0 && gc < mapCols && gr >= 0 && gr < rows)
                  map[gr * mapCols + gc] = 1.0;
              }
            }
          }
          cx2 += CHAR_W + CHAR_GAP;
        }
      }

      function centeredX(text2, mapCols) {
        return Math.round((mapCols - text2.length * (CHAR_W + CHAR_GAP)) / 2);
      }

      // Merge blink text into map
      if (blinkOn && (mode === 'idle' || mode === 'dead')) {
        const px2 = cx.getImageData(0, 0, TW, TH).data;
        const map2 = new Float32Array(cols * rows);
        for (let r = 0; r < rows; r++)
          for (let c2 = 0; c2 < cols; c2++) {
            const tx2 = Math.floor((c2 / cols) * TW), ty2 = Math.floor((r / rows) * TH);
            map2[r * cols + c2] = Math.min(px2[(ty2 * TW + tx2) * 4] / 255, 1.0);
          }
        if (mode === 'idle') {
          // Easter egg — hidden intentionally. Let users discover it themselves.
          // const bt1 = '[ CLICK TO PLAY ]';
          // drawBitmapText(bt1, centeredX(bt1, cols), Math.round(rows * 0.83), map2, cols);
        } else {
          const dt1 = '// SNAKE DESTROYED //';
          drawBitmapText(dt1, centeredX(dt1, cols), Math.round(rows * 0.78), map2, cols);
          // const dt2 = '[ CLICK TO RESTART ]';
          // drawBitmapText(dt2, centeredX(dt2, cols), Math.round(rows * 0.90), map2, cols);
        }
        return map2;
      }

      const px = cx.getImageData(0, 0, TW, TH).data;
      const map = new Float32Array(cols * rows);
      for (let r3 = 0; r3 < rows; r3++)
        for (let c3 = 0; c3 < cols; c3++) {
          const tx3 = Math.floor((c3 / cols) * TW), ty3 = Math.floor((r3 / rows) * TH);
          map[r3 * cols + c3] = Math.min(px[(ty3 * TW + tx3) * 4] / 255, 1.0);
        }
      return map;
    }

    let textMap = buildTextMap(state.cols, state.rows, 'idle', 0, true);
    let lastBlinkOn = true, lastUiMode = 'idle', lastUiScore = -1;
    function refreshTextMapIfNeeded() {
      if (uiBlinkOn !== lastBlinkOn || uiMode !== lastUiMode || uiScore !== lastUiScore) {
        textMap = buildTextMap(state.cols, state.rows, uiMode, uiScore, uiBlinkOn);
        lastBlinkOn = uiBlinkOn; lastUiMode = uiMode; lastUiScore = uiScore;
      }
    }

    // TERRAIN
    const WAVE_H = 0.2;
    const SCROLL_SPEED = 0.22;
    let dirX = 0.0, dirZ = 1.0;
    let scroll = 0;
    let mouseX = 0;

    function wave(wx, wz, t2) {
      const phase = wx * dirX + wz * dirZ;
      return (
        Math.sin(phase * 0.18 + t2 * 0.13) * 1.1 +
        Math.sin(phase * 0.43 - t2 * 0.30) * 0.55 +
        Math.cos(phase * 0.10 + t2 * 0.07) * 1.3 +
        Math.sin(phase * 0.28 + t2 * 0.52) * 0.40 +
        Math.sin(phase * 0.12 + t2 * 0.09) * 0.90
      ) * WAVE_H;
    }

    // SNAKE GAME
    const SNAKE_H = 10, FOOD_H = 5, FOOD_COUNT = 18;
    const TICK_RATE_INIT = 7, TICK_RATE_MIN = 2;
    let tickRate = TICK_RATE_INIT;
    const snakeMap = new Float32Array(state.cols * state.rows);
    const foodCells = new Set();
    const bodyCells = new Map();
    let snakeActive = false, snakeDead = false;
    let snake = [], snakeDir = { dc: 1, dr: 0 }, nextDir = { dc: 1, dr: 0 };
    let snakeScore = 0, snakeTick = 0;
    const explodeParticles = [];

    function spawnFood(count) {
      const { cols, rows } = state;
      let attempts = 0;
      while (count > 0 && attempts < 500) {
        attempts++;
        const c = Math.floor(Math.random() * cols);
        const r = Math.floor(Math.random() * rows);
        const idx = r * cols + c;
        if (!foodCells.has(idx) && !bodyCells.has(idx)) { foodCells.add(idx); count--; }
      }
    }

    function initSnake() {
      const { cols, rows } = state;
      snake = [
        { c: Math.floor(cols / 2), r: Math.floor(rows / 2) },
        { c: Math.floor(cols / 2) - 1, r: Math.floor(rows / 2) },
        { c: Math.floor(cols / 2) - 2, r: Math.floor(rows / 2) }
      ];
      snakeDir = { dc: 1, dr: 0 }; nextDir = { dc: 1, dr: 0 };
      snakeScore = 0; snakeDead = false; tickRate = TICK_RATE_INIT;
      foodCells.clear(); bodyCells.clear(); explodeParticles.length = 0;
      spawnFood(FOOD_COUNT);
      snakeActive = true;
      uiMode = 'playing'; uiScore = 0;
    }

    function killSnake() {
      snakeDead = false; snakeActive = false;
      for (let i = 0; i < snake.length; i++) {
        const seg = snake[i];
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.4 + Math.random() * 1.2;
        explodeParticles.push({
          c: seg.c, r: seg.r,
          vc: Math.cos(angle) * speed, vr: Math.sin(angle) * speed,
          age: 0, maxAge: 30 + Math.floor(Math.random() * 40)
        });
      }
      snake = []; bodyCells.clear(); uiMode = 'dead';
    }

    function stepSnake() {
      if (!snakeActive || snakeDead) return;
      const { cols, rows } = state;
      snakeDir = { dc: nextDir.dc, dr: nextDir.dr };
      const head = snake[0];
      const nc = ((head.c + snakeDir.dc) % cols + cols) % cols;
      const nr = ((head.r + snakeDir.dr) % rows + rows) % rows;
      const nIdx = nr * cols + nc;
      if (bodyCells.has(nIdx)) { killSnake(); return; }
      const ateFood = foodCells.has(nIdx);
      if (ateFood) { foodCells.delete(nIdx); snakeScore++; uiScore = snakeScore; spawnFood(1); tickRate = Math.max(TICK_RATE_MIN, tickRate - 1); }
      snake.unshift({ c: nc, r: nr });
      if (!ateFood) snake.pop();
      bodyCells.clear();
      for (let i = 0; i < snake.length; i++) {
        const idx = snake[i].r * cols + snake[i].c;
        bodyCells.set(idx, 1.0 - (i / snake.length) * 0.5);
      }
    }

    let foodPulse = 0;
    function buildSnakeMap(frame) {
      const { cols, rows } = state;
      foodPulse = Math.sin(frame * 0.08) * 0.3 + 0.7;
      snakeMap.fill(0);
      foodCells.forEach(idx => { snakeMap[idx] = 0.45 * foodPulse; });
      bodyCells.forEach((intensity, idx) => { snakeMap[idx] = 0.55 + intensity * 0.45; });
      for (let i = explodeParticles.length - 1; i >= 0; i--) {
        const p = explodeParticles[i];
        p.c += p.vc; p.r += p.vr; p.vc *= 0.88; p.vr *= 0.88; p.age++;
        const ec = Math.round(p.c), er = Math.round(p.r);
        if (ec >= 0 && ec < cols && er >= 0 && er < rows) {
          const eidx = er * cols + ec;
          const et = p.age / p.maxAge;
          snakeMap[eidx] = Math.max(snakeMap[eidx], (1.0 - et) * 0.9);
        }
        if (p.age >= p.maxAge) {
          const fc = Math.round(p.c), fr = Math.round(p.r);
          if (fc >= 0 && fc < cols && fr >= 0 && fr < rows) foodCells.add(fr * cols + fc);
          explodeParticles.splice(i, 1);
        }
      }
    }

    // COLOR
    function colorize(tv, wv, sv) {
      const tw = WAVE_H > 0 ? (wv / WAVE_H) * 0.5 + 0.5 : 0.5;
      let R = 0.04 + tw * 0.05;
      let G = 0.02 + tw * 0.02;
      let B = 0.20 + tw * 0.30;
      if (tv > 0.01) {
        const t2 = Math.pow(tv, 0.75);
        const bl = Math.min(1, tv * 5);
        R += (0.55 + t2 * 0.45 - R) * bl;
        G += (0.04 + t2 * 0.36 - G) * bl;
        B += (0.02 + t2 * 0.10 - B) * bl;
      }
      if (sv > 0.01) {
        let sR, sG, sB;
        if (sv > 0.54) {
          const st = (sv - 0.55) / 0.45;
          sR = 0.10 + st * 0.90; sG = 0.90 + st * 0.10; sB = 0.20 + st * 0.80;
        } else {
          sR = 0.05; sG = 0.80 + sv * 0.4; sB = 0.70 + sv * 0.3;
        }
        const sbl = Math.min(1, sv * 4);
        R += (sR - R) * sbl; G += (sG - G) * sbl; B += (sB - B) * sbl;
      }
      return [R, G, B];
    }

    // THREE.JS
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 8.6, 0.1, 2000);

    let geo, pts;
    function buildGrid() {
      if (pts) scene.remove(pts);
      const { cols, rows, spacing } = state;
      const N = cols * rows;
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: Math.max(1.0, spacing * 0.65), vertexColors: true,
        transparent: true, opacity: 1.0, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      pts = new THREE.Points(geo, mat);
      scene.add(pts);
    }
    buildGrid();

    function updateCamera() {
      const tiltRad = THREE.MathUtils.degToRad(state.tilt);
      const dist = 100;
      camera.position.x = 0;
      camera.position.y = Math.sin(tiltRad) * dist;
      camera.position.z = Math.cos(tiltRad) * dist;
      camera.lookAt(0, -12, 0);
    }
    updateCamera();

    function onResize() {
      const w = container.clientWidth;
      const h2 = container.clientHeight;
      renderer.setSize(w, h2);
      camera.aspect = w / h2;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);
    onResize();

    // INPUT
    const onMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    };
    document.addEventListener('mousemove', onMouseMove);

    // Left half of canvas = turn left, right half = turn right (relative to heading).
    function handlePointerTurn(clientX) {
      if (!snakeActive) { initSnake(); return; }
      const rect = canvas.getBoundingClientRect();
      const turnLeft = clientX < rect.left + rect.width / 2;
      const cur = nextDir;
      // Rotate 90° CCW (left) or CW (right)
      nextDir = turnLeft
        ? { dc: cur.dr, dr: -cur.dc }
        : { dc: -cur.dr, dr: cur.dc };
    }

    const onCanvasClick = (e) => { handlePointerTurn(e.clientX); };
    canvas.addEventListener('click', onCanvasClick);

    const onCanvasTouch = (e) => {
      e.preventDefault();
      if (e.changedTouches.length > 0) handlePointerTurn(e.changedTouches[0].clientX);
    };
    canvas.addEventListener('touchstart', onCanvasTouch, { passive: false });

    const onKeyDown = (e) => {
      if (snakeActive) {
        const dirs = {
          ArrowUp: { dc: 0, dr: -1 }, ArrowDown: { dc: 0, dr: 1 },
          ArrowLeft: { dc: -1, dr: 0 }, ArrowRight: { dc: 1, dr: 0 }
        };
        if (dirs[e.key]) {
          e.preventDefault();
          const d = dirs[e.key];
          if (d.dc !== -snakeDir.dc || d.dr !== -snakeDir.dr) nextDir = d;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // RENDER LOOP — capped at 30fps
    const TARGET_FPS = 30;
    const FRAME_MS = 1000 / TARGET_FPS;
    let frame = 0;
    let running = true;
    let lastTime = 0;
    function animate(now) {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(animate);
      if (now - lastTime < FRAME_MS) return;
      lastTime = now;
      frame++;

      dirX += (mouseX * 1.2 - dirX) * 0.04;
      dirZ += (1.0 - dirZ) * 0.04;
      scroll += SCROLL_SPEED;

      // Blink
      uiBlinkFrame++;
      if (uiBlinkFrame > 40) { uiBlinkFrame = 0; uiBlinkOn = !uiBlinkOn; }
      refreshTextMapIfNeeded();

      // Snake tick
      snakeTick++;
      if (snakeTick >= tickRate) { snakeTick = 0; stepSnake(); }
      buildSnakeMap(frame);

      const { cols, rows, spacing, textH } = state;
      const pos = geo.attributes.position.array;
      const col = geo.attributes.color.array;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const wx = (c - cols / 2) * spacing;
          const wz = (r - rows / 2) * spacing;
          const wv = wave(wx, wz, scroll);
          const tv = textMap[i];
          const sv = snakeMap[i];
          pos[i * 3] = wx;
          pos[i * 3 + 1] = wv + tv * textH + sv * (sv > 0.54 ? SNAKE_H : FOOD_H);
          pos[i * 3 + 2] = wz;
          const rgb = colorize(tv, wv, sv);
          col[i * 3] = rgb[0];
          col[i * 3 + 1] = rgb[1];
          col[i * 3 + 2] = rgb[2];
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      renderer.render(scene, camera);
    }
    animate();

    threeRef.current = { renderer, scene };

    // Return cleanup function
    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('touchstart', onCanvasTouch);
      renderer.dispose();
      if (geo) geo.dispose();
    };
  }

  return html`
    <section class="gn-hero-3d" ref=${containerRef}>
      <canvas ref=${canvasRef}></canvas>
      <div class="genesis-corner genesis-corner--tl"></div>
      <div class="genesis-corner genesis-corner--tr"></div>
      <div class="genesis-corner genesis-corner--bl"></div>
      <div class="genesis-corner genesis-corner--br"></div>
    </section>
  `;
}

/* ══════════════════════════════════════════════
   ONELINERS FEED COMPONENT
   ══════════════════════════════════════════════ */

/* ══════════════════════════════════════════════
   MAIN PORTAL COMPONENT
   ══════════════════════════════════════════════ */
export default function Portal({ navigate, locale }) {
  const [isExpanded, setExpanded] = useState(false);
  const [session, setSession] = useState(null);
  const worldRef = useRef(null);

  useViewCSS('/css/views/portal.css');

  // Check session on mount
  useEffect(() => {
    function checkSession() {
      setSession(getCurrentSession());
    }
    checkSession();
    // Also listen for auth changes
    const onAuthChange = () => checkSession();
    window.addEventListener('aimeat-auth-change', onAuthChange);
    // Periodic check for auth lib late-loading
    const iv = setInterval(() => {
      if (hasAuth()) checkSession();
    }, 1000);
    return () => {
      window.removeEventListener('aimeat-auth-change', onAuthChange);
      clearInterval(iv);
    };
  }, []);

  const expandLabel = useCallback(() => {
    if (session) {
      const prefix = sessionDisplayName(session) + ' : ';
      return prefix + (isExpanded ? t('portal.expand.userPrefixOpen') : t('portal.expand.userPrefix'));
    }
    return isExpanded ? t('portal.expand.btnOpen') : t('portal.expand.btn');
  }, [session, isExpanded]);

  const handleExpand = useCallback(() => {
    if (!session) {
      // Trigger login via the header auth button
      const loginBtn = document.querySelector('#headerAuth #aimeat-login-btn');
      if (loginBtn) {
        /** @type {HTMLElement} */ (loginBtn).click();
        // After login, the aimeat-auth-change event will fire and we re-check
        const handler = () => {
          const s = getCurrentSession();
          if (s) {
            setSession(s);
            setExpanded(true);
            setTimeout(() => {
              worldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }
          window.removeEventListener('aimeat-auth-change', handler);
        };
        window.addEventListener('aimeat-auth-change', handler);
      }
      return;
    }
    if (isExpanded) {
      setExpanded(false);
    } else {
      setExpanded(true);
      setTimeout(() => {
        worldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [session, isExpanded]);

  return html`
    <!-- Genesis Hero 3D -->
    <${GenesisCanvas} />
    <div class="genesis-text-under">
      <p class="genesis-tagline">${(() => { const tl = t('portal.genesis.taglines'); return Array.isArray(tl) ? tl[Math.floor(Math.random() * tl.length)] : t('portal.genesis.tagline'); })()}</p>
    </div>

    <!-- Divider -->
    <div class="section-divider"></div>

    <!-- GROUP 1: Opinions feed -->
    <${OnelinersFeed} locale=${locale} />

    <!-- GROUP 2: Action prompt -->
    <${PromptSection} locale=${locale} />

    <!-- Expand trigger -->
    <section class="expand-section">
      <button class="expand-btn" type="button" onClick=${handleExpand}>${expandLabel()}</button>
    </section>

    <!-- The World -->
    ${isExpanded && html`
      <div ref=${worldRef}>
        <${TheWorld} navigate=${navigate} />
      </div>
    `}
  `;
}

