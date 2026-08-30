/**
 * @file atelier/scene3d.js
 * @description The 3D scene — a band of real depth on the three-world bundle (three r185 +
 *   OrbitControls + Sky, the same foundation the UNIVERSE world-builder stands on), loaded
 *   lazily so an app pays the ~745 kB only when a scene actually mounts. Three kinds:
 *
 *     orb    a signature object — the app's mark given mass, turning under the hand;
 *     sky    the procedural sky with a sun — an atmosphere band for a front or a story;
 *     bars   data as terrain — the bound rows stand up as a field of columns, the 3D chart;
 *     model  any .glb/.gltf by URL — fitted, grounded and studio-lit like a product shot;
 *     globe  the earth as a graticule sphere — points at real places, data travelling
 *            between them as lifted arcs (federation, members, deliveries).
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
 *   v0.36.0 — 2026-08-30 — kind "globe": the abstract earth — a graticule sphere, points at
 *     lat/lon, routes as lifted arcs — on the base bundle alone (no loaders, no new library).
 *   v0.35.0 — 2026-08-29 — kind "model": any .glb/.gltf by URL — fitted whole, grounded on a
 *     soft shadow disc, lit by a real studio environment (GLTFLoader + RoomEnvironment ride
 *     the companion bundle /lib/three-world-loaders@1.min.js), turning under the hand.
 *   v0.32.0 — 2026-08-29 — Initial (TARGET-074 next level: depth joins the vocabulary on the
 *     bundle universe proved, nothing newly vendored).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { skeleton, emptyState } from './state.js';

/** One shared load of the three-world bundle, whoever asks first. */
let threePromise = null;
function ensureThree() {
  if (window.THREE && window.THREE.Addons) return Promise.resolve(window.THREE);
  if (threePromise) return threePromise;
  threePromise = new Promise(function (ok, fail) {
    const s = document.createElement('script');
    // NODE_URL: the app subdomain proxies this node's /lib, so the load is same-origin.
    s.src = NODE_URL + '/lib/three-world@1.min.js';
    s.onload = function () { ok(window.THREE); };
    s.onerror = function () { threePromise = null; fail(new Error('three-world failed to load')); };
    document.head.appendChild(s);
  });
  return threePromise;
}

/** The model kind's extra: GLTFLoader + RoomEnvironment, attached onto the loaded THREE. */
let loadersPromise = null;
function ensureLoaders() {
  return ensureThree().then(function (THREE) {
    if (THREE.Addons.GLTFLoader) return THREE;
    if (loadersPromise) return loadersPromise;
    loadersPromise = new Promise(function (ok, fail) {
      const s = document.createElement('script');
      s.src = NODE_URL + '/lib/three-world-loaders@1.min.js';
      s.onload = function () { ok(THREE); };
      s.onerror = function () { loadersPromise = null; fail(new Error('three-world-loaders failed to load')); };
      document.head.appendChild(s);
    });
    return loadersPromise;
  });
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
 *   target?: string|Element, kind?: 'orb'|'sky'|'bars'|'model'|'globe',
 *   data?: { items?: Array<{ label?: string, value: number }>, url?: string,
 *            points?: Array<{ lat: number, lon: number, label?: string }>,
 *            routes?: Array<{ from: [number, number], to: [number, number] }> }|null,
 *   title?: string, empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function scene3d(spec) {
  const kind = ['sky', 'bars', 'model', 'globe'].indexOf(spec.kind) >= 0 ? spec.kind : 'orb';
  const root = el('figure', { class: 'ak-root ak-scene', 'data-ak-scene': kind });
  if (spec.target) resolve(spec.target).appendChild(root);
  if (spec.title) root.appendChild(el('figcaption', { class: 'ak-scene__title' }, spec.title));
  const stage = el('div', { class: 'ak-scene__stage' });
  root.appendChild(stage);
  const wait = skeleton({ target: stage, rows: 2 });

  let destroyed = false;
  let world = null; // { renderer, scene, camera, controls, dispose(), rebuild(data) }

  (kind === 'model' ? ensureLoaders() : ensureThree()).then(function (THREE) {
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
  controls.enableZoom = kind === 'bars' || kind === 'model' || kind === 'globe';
  if (kind === 'sky') { controls.enableZoom = false; controls.rotateSpeed = -0.35; }
  if (kind === 'model') {
    // The showcase spins like a product on a table: PBR needs a real environment, so the
    // studio light (RoomEnvironment via PMREM) stands in for the missing world. The ground
    // is the DARKER of the theme's own ink/bg pair — a studio is dark in both modes.
    renderer.toneMappingExposure = 1.15;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.Addons.RoomEnvironment(), 0.04).texture;
    const inkC = new THREE.Color(tokenColor(root, '--ak-ink'));
    const bgC = new THREE.Color(tokenColor(root, '--ak-bg'));
    const luma = (c) => c.r + c.g + c.b;
    scene.background = (luma(inkC) < luma(bgC) ? inkC : bgC);
  }

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
    if (kind === 'model') {
      camera.position.set(2.6, 1.7, 4.6);
      controls.target.set(0, 1.1, 0);
      controls.update();
      return;
    }
    if (kind === 'globe') {
      camera.position.set(0, 2.4, 8.4);
      controls.target.set(0, 0, 0);
    } else if (kind === 'sky') {
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

    if (kind === 'model') {
      // THE LOADABLE MODEL: any .glb/.gltf by URL, fitted whole, grounded on a soft disc,
      // turning under the hand. The environment (set at build) does the material justice.
      const url = data && data.url ? String(data.url) : '';
      if (!url) { applyEntrance = function () {}; wake(0); return; }
      const shimmer = skeleton({ target: stage, rows: 2 });
      new THREE.Addons.GLTFLoader().load(url, function (gltf) {
        shimmer.destroy();
        const model = gltf.scene;
        // Fit: centre on the origin, stand on the floor, span ~2.6 units whatever the file's scale.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = 2.6 / Math.max(size.x, size.y, size.z, 1e-6);
        model.scale.setScalar(scale);
        model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
        group.add(model);
        // The soft ground: a radial shadow disc, drawn on canvas so no asset is fetched. Its
        // colour is the scene's own ground (the darker of ink and surface, the same rule the
        // studio background follows) pushed further down — a shadow, derived, not hardcoded.
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g2 = c.getContext('2d');
        const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
        const channels = function (s) { return (s.match(/\d+/g) || ['0', '0', '0']).map(Number); };
        const inkCh = channels(ink);
        const surfCh = channels(surface);
        const shadow = (inkCh[0] + inkCh[1] + inkCh[2] <= surfCh[0] + surfCh[1] + surfCh[2] ? inkCh : surfCh)
          .map(function (v) { return Math.round(v * 0.3); }).join(',');
        grad.addColorStop(0, 'rgba(' + shadow + ',0.42)');
        grad.addColorStop(1, 'rgba(' + shadow + ',0)');
        g2.fillStyle = grad;
        g2.fillRect(0, 0, 128, 128);
        const disc = new THREE.Mesh(
          new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
        );
        disc.position.y = 0.001;
        group.add(disc);
        applyEntrance = function (p) {
          model.rotation.y = (1 - p) * 1.2;
          model.position.y = -box.min.y * scale + (1 - p) * 0.35;
        };
        frameCamera(3);
        clock.start = performance.now();
        entranceUntil = reducedMotion() ? clock.start : clock.start + 900;
        if (reducedMotion()) applyEntrance(1);
        wake(reducedMotion() ? 0 : 950);
      }, undefined, function () {
        shimmer.destroy();
        emptyState({ target: stage, title: (spec.empty && spec.empty.title) || '3D is resting',
          hint: (spec.empty && spec.empty.hint) || 'The model could not load from its address.' });
      });
      applyEntrance = function () {};
      return; // the loader's callback finishes the build
    }

    if (kind === 'globe') {
      // THE ABSTRACT EARTH: a graticule sphere in the theme's own colours, points at real
      // places, routes as lifted arcs. Deliberately no landmass — this is the data's globe.
      const R = 3;
      const accentC = new THREE.Color(accent);
      const inkC = new THREE.Color(ink);
      const surfaceC = new THREE.Color(surface);
      // The lights live in `group`, the earth in `ball`: the data-facing turn below rotates
      // the BALL only, so the sun keeps shining from the front whatever the data's centre.
      const ball = new THREE.Group();
      group.add(ball);
      ball.add(new THREE.Mesh(
        new THREE.SphereGeometry(R - 0.02, 48, 32),
        new THREE.MeshStandardMaterial({ color: surfaceC.clone().lerp(inkC, 0.05), roughness: 0.9, metalness: 0.02 })
      ));
      // The atmosphere: a back-face rim in the accent, so the ball sits in space instead of
      // floating as a flat grey circle on the card.
      ball.add(new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.045, 48, 32),
        new THREE.MeshBasicMaterial({ color: accentC, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false })
      ));
      const gratMat = new THREE.LineBasicMaterial({ color: inkC, transparent: true, opacity: 0.22 });
      const toV = function (lat, lon, r) {
        return new THREE.Vector3().setFromSphericalCoords(
          r || R, THREE.MathUtils.degToRad(90 - lat), THREE.MathUtils.degToRad(lon + 180));
      };
      for (let lat = -60; lat <= 60; lat += 20) {
        const pts = [];
        for (let lon = 0; lon <= 360; lon += 6) pts.push(toV(lat, lon));
        ball.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
      }
      for (let lon = 0; lon < 360; lon += 20) {
        const pts = [];
        for (let lat = -90; lat <= 90; lat += 6) pts.push(toV(lat, lon));
        ball.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
      }
      const points = (data && Array.isArray(data.points) ? data.points : [])
        .filter(function (p) { return p && typeof p.lat === 'number' && typeof p.lon === 'number'; });
      const dotGeo = new THREE.SphereGeometry(0.085, 12, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: accentC });
      for (const p of points) {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(toV(p.lat, p.lon, R + 0.02));
        ball.add(dot);
      }
      const routes = (data && Array.isArray(data.routes) ? data.routes : [])
        .filter(function (r2) { return r2 && Array.isArray(r2.from) && Array.isArray(r2.to); });
      const arcMat = new THREE.MeshBasicMaterial({ color: accentC, transparent: true, opacity: 0.7 });
      for (const r2 of routes) {
        const a = toV(Number(r2.from[0]) || 0, Number(r2.from[1]) || 0, R + 0.02);
        const b = toV(Number(r2.to[0]) || 0, Number(r2.to[1]) || 0, R + 0.02);
        const sum = a.clone().add(b);
        if (sum.lengthSq() < 1e-6) sum.set(0, R, 0); // antipodes: lift the arc over a pole
        const lift = R + 0.25 + a.distanceTo(b) * 0.3;
        const mid = sum.normalize().multiplyScalar(lift);
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        ball.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 6, false), arcMat));
      }
      // Face the data: turn the globe so the points' centre looks at the camera, instead of
      // greeting the viewer with whichever hemisphere the maths happened to leave in front.
      const centre = new THREE.Vector3();
      for (const p of points) centre.add(toV(p.lat, p.lon, 1));
      for (const r2 of routes) {
        centre.add(toV(Number(r2.from[0]) || 0, Number(r2.from[1]) || 0, 1));
        centre.add(toV(Number(r2.to[0]) || 0, Number(r2.to[1]) || 0, 1));
      }
      const baseY = centre.lengthSq() > 1e-6 ? -Math.atan2(centre.x, centre.z) : 0;
      ball.rotation.y = baseY;
      applyEntrance = function (p) {
        ball.rotation.y = baseY + (1 - p) * 1.4;
        ball.scale.setScalar(0.6 + 0.4 * p);
      };
    } else if (kind === 'sky') {
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
