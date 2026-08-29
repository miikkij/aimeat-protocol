/**
 * @file atelier/scene3d.js
 * @description The 3D scene — a band of real depth on the three-world bundle (three r185 +
 *   OrbitControls + Sky, the same foundation the UNIVERSE world-builder stands on), loaded
 *   lazily so an app pays the ~745 kB only when a scene actually mounts. Three kinds:
 *
 *     orb    a signature object — the app's mark given mass, turning under the hand;
 *     sky    the procedural sky with a sun — an atmosphere band for a front or a story;
 *     bars   data as terrain — the bound rows stand up as a field of columns, the 3D chart.
 *
 *   THE KIT'S PHYSICS HOLD IN 3D: every colour is read from the look's --ak-* tokens at mount
 *   (a palette or theme change re-reads on set()), the entrance is finite, and the render loop
 *   RUNS ONLY WHILE SOMETHING MOVES — during the entrance and under the hand (orbit damping
 *   counts), then draws one last frame and stops. Idle cost is zero, exactly like every other
 *   component. Reduced motion skips the entrance and stills the damping; orbiting stays,
 *   because it happens only under the person's own hand.
 * @structure scene3d(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.scene3d({ target: host, kind: 'bars', data: { items: rows } });
 * @version-history
 *   v0.32.0 — 2026-08-29 — Initial (TARGET-074 next level: depth joins the vocabulary on the
 *     bundle universe proved, nothing newly vendored).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { APEX_URL } from '../_core/config.js';
import { skeleton, emptyState } from './state.js';

/** One shared load of the three-world bundle, whoever asks first. */
let threePromise = null;
function ensureThree() {
  if (window.THREE && window.THREE.Addons) return Promise.resolve(window.THREE);
  if (threePromise) return threePromise;
  threePromise = new Promise(function (ok, fail) {
    const s = document.createElement('script');
    s.src = APEX_URL + '/lib/three-world@1.min.js';
    s.onload = function () { ok(window.THREE); };
    s.onerror = function () { threePromise = null; fail(new Error('three-world failed to load')); };
    document.head.appendChild(s);
  });
  return threePromise;
}

/**
 * Read a token colour off the live element — the look, palette and mode all answered at once.
 * A custom property's computed value is the raw token stream, so a color-mix() expression comes
 * back UNRESOLVED and THREE.Color cannot parse it. The probe span makes the browser do the
 * resolving: its `color` computes all the way to an rgb() whatever the expression was.
 */
let colorCtx = null;
function tokenColor(node, name, fallbackName) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = fallbackName
    ? 'var(' + name + ', var(' + fallbackName + ', currentColor))'
    : 'var(' + name + ', currentColor)';
  node.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  // The computed colour can come back in oklab() (color-mix's home space), which THREE.Color
  // cannot parse — a 1×1 canvas fill settles any CSS colour the browser knows into sRGB bytes.
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  colorCtx.fillStyle = resolved;
  colorCtx.fillRect(0, 0, 1, 1);
  const px = colorCtx.getImageData(0, 0, 1, 1).data;
  return 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')';
}

/** An entrance eased the kit's way: 0→1 over ms, cubic-out. */
function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

/**
 * The 3D scene.
 * @param {{
 *   target?: string|Element, kind?: 'orb'|'sky'|'bars',
 *   data?: { items?: Array<{ label?: string, value: number }> }|null,
 *   title?: string, empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function scene3d(spec) {
  const kind = spec.kind === 'sky' || spec.kind === 'bars' ? spec.kind : 'orb';
  const root = el('figure', { class: 'ak-root ak-scene', 'data-ak-scene': kind });
  if (spec.target) resolve(spec.target).appendChild(root);
  if (spec.title) root.appendChild(el('figcaption', { class: 'ak-scene__title' }, spec.title));
  const stage = el('div', { class: 'ak-scene__stage' });
  root.appendChild(stage);
  const wait = skeleton({ target: stage, rows: 2 });

  let destroyed = false;
  let world = null; // { renderer, scene, camera, controls, dispose(), rebuild(data) }

  ensureThree().then(function (THREE) {
    if (destroyed) return;
    wait.destroy();
    world = buildWorld(THREE, stage, kind, spec, root);
    world.rebuild(spec.data || null);
  }).catch(function () {
    if (destroyed) return;
    wait.destroy();
    emptyState({
      target: stage,
      title: (spec.empty && spec.empty.title) || '3D is resting',
      hint: (spec.empty && spec.empty.hint) || 'The scene library could not load here.',
    });
  });

  return {
    el: root,
    set: function (patch) {
      if (world && patch && 'data' in patch) world.rebuild(patch.data || null);
    },
    destroy: function () {
      destroyed = true;
      if (world) world.dispose();
      root.remove();
    },
  };
}

/** Build renderer + camera + controls + the kind's content, with the stop-at-rest loop. */
function buildWorld(THREE, stage, kind, spec, root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  const controls = new THREE.Addons.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion();
  controls.enablePan = false;
  controls.enableZoom = kind === 'bars';
  if (kind === 'sky') { controls.enableZoom = false; controls.rotateSpeed = -0.35; }

  // ── The stop-at-rest loop: frames only while the entrance plays or the hand moves. ──
  let raf = 0;
  let entranceUntil = 0;
  let settleUntil = 0;
  let disposed = false;
  const clock = { start: 0 };
  function frame(now) {
    raf = 0;
    if (disposed) return;
    const entering = now < entranceUntil;
    if (entering) {
      const p = easeOut(Math.min(1, (now - clock.start) / (entranceUntil - clock.start)));
      applyEntrance(p);
    }
    controls.update();
    renderer.render(scene, camera);
    if (entering || now < settleUntil) raf = requestAnimationFrame(frame);
  }
  function wake(settleMs) {
    settleUntil = Math.max(settleUntil, performance.now() + (settleMs || 0));
    if (!raf) raf = requestAnimationFrame(frame);
  }
  controls.addEventListener('start', function () { wake(60 * 1000); });
  controls.addEventListener('end', function () {
    // Give damping room to glide to rest, then the loop parks itself.
    settleUntil = performance.now() + (controls.enableDamping ? 1600 : 0);
  });

  const ro = new ResizeObserver(function () {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    wake(0);
  });
  ro.observe(stage);

  // ── Content per kind, colours read from the live tokens every rebuild. ──
  let group = new THREE.Group();
  scene.add(group);
  /** @type {(p: number) => void} */
  let applyEntrance = function () {};

  function disposeGroup() {
    group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); }); }
    });
    scene.remove(group);
    group = new THREE.Group();
    scene.add(group);
  }

  /** Frame the camera for what was just built — bars scale with the grid they carry. */
  function frameCamera(cols) {
    if (kind === 'sky') {
      // A look-around: the target sits up and away, so the gaze rests on the sky, not the haze.
      camera.position.set(0, 2, 0.5);
      controls.target.set(0, 16, -22);
    } else if (kind === 'bars') {
      camera.position.set(cols * 2.2, cols * 2.0, cols * 3.2);
      controls.target.set(0, 1.4, 0);
    } else {
      camera.position.set(0, 1.2, 11.5);
      controls.target.set(0, 0, 0);
    }
    controls.update();
  }

  function rebuild(data) {
    disposeGroup();
    const accent = tokenColor(root, '--ak-accent');
    const ink = tokenColor(root, '--ak-ink');
    const surface = tokenColor(root, '--ak-surface-2', '--ak-surface');
    scene.fog = null;
    let barCols = 3;

    if (kind === 'sky') {
      const sky = new THREE.Addons.Sky();
      sky.scale.setScalar(300);
      group.add(sky);
      const dark = root.closest('[data-theme="dark"]') !== null
        || (matchMedia('(prefers-color-scheme: dark)').matches && root.closest('[data-theme="light"]') === null);
      const elevation = dark ? 1.6 : 18;
      const phi = THREE.MathUtils.degToRad(90 - elevation);
      const theta = THREE.MathUtils.degToRad(160);
      const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
      sky.material.uniforms.sunPosition.value.copy(sun);
      sky.material.uniforms.turbidity.value = dark ? 6 : 8;
      sky.material.uniforms.rayleigh.value = dark ? 0.6 : 2.2;
      applyEntrance = function () {};
    } else if (kind === 'bars') {
      const items = (data && data.items) || [];
      const n = Math.min(items.length, 64);
      if (n === 0) {
        applyEntrance = function () {};
      } else {
        const max = items.reduce(function (m, it) { return Math.max(m, Number(it.value) || 0); }, 0) || 1;
        const box = new THREE.BoxGeometry(0.8, 1, 0.8);
        box.translate(0, 0.5, 0); // grow from the ground, not through it
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.08 });
        const mesh = new THREE.InstancedMesh(box, mat, n);
        const cols = Math.ceil(Math.sqrt(n));
        barCols = cols;
        const accentC = new THREE.Color(accent);
        const surfaceC = new THREE.Color(surface);
        const heights = [];
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < n; i++) {
          const h = 0.15 + 4.6 * ((Number(items[i].value) || 0) / max);
          heights.push(h);
          const x = ((i % cols) - (cols - 1) / 2) * 1.15;
          const z = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 1.15;
          m4.makeScale(1, 0.001, 1).setPosition(x, 0, z);
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, surfaceC.clone().lerp(accentC, 0.25 + 0.75 * (heights[i] / 4.75)));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
        const ground = new THREE.Mesh(
          new THREE.CylinderGeometry(cols * 0.95 + 1, cols * 0.95 + 1, 0.12, 48),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(surface), roughness: 0.9 })
        );
        ground.position.y = -0.06;
        group.add(ground);
        applyEntrance = function (p) {
          const v = new THREE.Matrix4();
          for (let i = 0; i < n; i++) {
            mesh.getMatrixAt(i, v);
            const pos = new THREE.Vector3().setFromMatrixPosition(v);
            v.makeScale(1, Math.max(0.001, heights[i] * p), 1).setPosition(pos.x, 0, pos.z);
            mesh.setMatrixAt(i, v);
          }
          mesh.instanceMatrix.needsUpdate = true;
        };
      }
    } else {
      const geo = new THREE.IcosahedronGeometry(3.1, 1);
      const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent), flatShading: true, roughness: 0.35, metalness: 0.15,
      }));
      const frame3 = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.35 })
      );
      group.add(body, frame3);
      applyEntrance = function (p) {
        const s = 0.25 + 0.75 * p;
        group.scale.setScalar(s);
        group.rotation.y = (1 - p) * 0.9;
      };
    }

    if (kind !== 'sky') {
      const sun = new THREE.DirectionalLight(); // default white — sunlight is physics, not palette
      sun.intensity = 2.2;
      sun.position.set(4, 8, 6);
      const fill = new THREE.HemisphereLight(new THREE.Color(surface), new THREE.Color(ink), 0.7);
      group.add(sun, fill);
    }

    frameCamera(barCols);
    clock.start = performance.now();
    entranceUntil = reducedMotion() ? clock.start : clock.start + 750;
    if (reducedMotion()) applyEntrance(1);
    wake(reducedMotion() ? 0 : 800);
  }

  return {
    rebuild: rebuild,
    dispose: function () {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup();
      renderer.dispose();
      clear(stage);
    },
  };
}
