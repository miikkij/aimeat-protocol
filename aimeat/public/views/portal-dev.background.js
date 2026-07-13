/**
 * @file public/views/portal-dev.background.js
 * @description Animated background layers (hearts/aurora/sparkle) + selector for the portal-dev view. Extracted from portal-dev.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 */
import { useEffect, useRef } from 'preact/hooks';
import { html } from './portal-dev.shared.js';

/* ══════════════════════════════════════════════
   BACKGROUND ANIMATIONS
   ══════════════════════════════════════════════ */
function BackgroundLayer({ activeBg }) {
  const sparkleRef = useRef(null);
  const heartsRef = useRef(null);
  const heartTimer = useRef(null);

  // Hearts animation
  useEffect(() => {
    if (heartTimer.current) clearInterval(heartTimer.current);
    const hearts = ['\u2764','\ud83d\udc95','\ud83d\udc96','\ud83d\udc97','\ud83d\udc93','\ud83e\ude77','\u2763','\ud83d\udc9e'];
    heartTimer.current = setInterval(() => {
      if (activeBg !== 1 || !heartsRef.current) return;
      const h = document.createElement('div');
      h.className = 'dv-heart-particle';
      h.textContent = hearts[Math.floor(Math.random() * hearts.length)];
      h.style.left = Math.random() * 100 + '%';
      h.style.fontSize = (0.8 + Math.random() * 1.8) + 'rem';
      h.style.animationDuration = (6 + Math.random() * 8) + 's';
      heartsRef.current.appendChild(h);
      setTimeout(() => { if (h.parentNode) h.remove(); }, 16000);
    }, 400);
    return () => { if (heartTimer.current) clearInterval(heartTimer.current); };
  }, [activeBg]);

  // Sparkle init
  useEffect(() => {
    if (!sparkleRef.current) return;
    const c = sparkleRef.current;
    c.innerHTML = '';
    const colors = ['rgba(232,86,74,.15)','rgba(232,86,74,.1)','rgba(255,107,107,.1)','rgba(200,60,50,.08)'];
    for (let n = 0; n < 5; n++) {
      const blob = document.createElement('div');
      blob.className = 'dv-nebula-blob';
      const sz = (150 + Math.random() * 250) + 'px';
      blob.style.width = sz; blob.style.height = sz;
      blob.style.left = Math.random() * 90 + '%';
      blob.style.top = Math.random() * 90 + '%';
      blob.style.background = colors[n % colors.length];
      blob.style.animationDuration = (12 + Math.random() * 10) + 's';
      blob.style.animationDelay = (-Math.random() * 10) + 's';
      c.appendChild(blob);
    }
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('div');
      s.className = 'dv-sparkle';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDuration = (2 + Math.random() * 4) + 's';
      s.style.animationDelay = (-Math.random() * 6) + 's';
      const w = (2 + Math.random() * 3) + 'px';
      s.style.width = w; s.style.height = w;
      c.appendChild(s);
    }
  }, []);

  return html`
    <div class=${`dv-bg-layer dv-bg-hearts ${activeBg !== 1 ? 'dv-bg-hidden' : ''}`} ref=${heartsRef}></div>
    <div class=${`dv-bg-layer dv-bg-aurora ${activeBg !== 2 ? 'dv-bg-hidden' : ''}`}>
      <div class="dv-aurora-wave"></div>
      <div class="dv-aurora-wave"></div>
      <div class="dv-aurora-wave"></div>
    </div>
    <div class=${`dv-bg-layer dv-bg-sparkle ${activeBg !== 3 ? 'dv-bg-hidden' : ''}`} ref=${sparkleRef}></div>
  `;
}

function BgSelector({ activeBg, onChange }) {
  return html`
    <div class="dv-bg-selector">
      <button class=${`dv-bg-btn ${activeBg === 1 ? 'active' : ''}`} type="button" title="Floating Hearts" onClick=${() => onChange(1)}>\ud83d\udc95</button>
      <button class=${`dv-bg-btn ${activeBg === 2 ? 'active' : ''}`} type="button" title="Aurora Love" onClick=${() => onChange(2)}>\ud83c\udf0c</button>
      <button class=${`dv-bg-btn ${activeBg === 3 ? 'active' : ''}`} type="button" title="Sparkle Galaxy" onClick=${() => onChange(3)}>\u2728</button>
    </div>
  `;
}

export { BackgroundLayer, BgSelector };
