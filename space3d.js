// Interactive 3D solar system — textures: Solar System Scope (CC BY 4.0)
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const box = document.getElementById('orrery');
const LOW = matchMedia('(pointer:coarse)').matches || innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;
const SEG = LOW ? 32 : 64;
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: false, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
if (renderer && box) {
  let started = false; const start = () => { if (started) return; started = true; lazy.disconnect(); init(); };
  const lazy = new IntersectionObserver((es) => { if (es[0].isIntersecting) start(); }, { rootMargin: '1500px' }); lazy.observe(box);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  addEventListener('load', () => idle(start, { timeout: 4000 }), { once: true });
}

function init() {
  box.classList.add('gl');
  let pr = Math.min(devicePixelRatio, LOW ? 1 : 1.5); renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  box.prepend(renderer.domElement);
  renderer.domElement.className = 'gl-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false;
  controls.rotateSpeed = 0.5; controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI - 0.2;
  if (matchMedia('(pointer:coarse)').matches) controls.enabled = false; // keep page scroll on phones

  const tl = new THREE.TextureLoader();
  const tex = (f) => { const t = tl.load('tex/' + f, (t) => renderer.initTexture(t)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

  const atmo = (r, color, power = 3.0, k = 1.2) => new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, SEG, SEG * 0.75), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, p: { value: power }, k: { value: k } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); vC=(modelMatrix*vec4(0.,0.,0.,1.)).xyz; vW=normalize((modelMatrix*vec4(position,1.0)).xyz - vC); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float p; uniform float k; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC; void main(){ float f=pow(1.0-max(dot(vN,vV),0.0),p); float lit=smoothstep(-0.2,0.45,dot(vW,normalize(-vC))); gl_FragColor=vec4(c, f*k*lit); }',
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  // Milky Way backdrop
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 20), new THREE.MeshBasicMaterial({ map: tex('stars.jpg'), side: THREE.BackSide, color: 0x8899aa }));
  scene.add(sky);

  // Sun
  const sun = new THREE.Mesh(new THREE.SphereGeometry(10, SEG, SEG * 0.75), new THREE.MeshBasicMaterial({ map: tex('sun.jpg') }));
  sun.userData.id = 'sun'; scene.add(sun);
  const glowC = document.createElement('canvas'); glowC.width = glowC.height = 256;
  const g = glowC.getContext('2d'); const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,220,140,0.9)'); grad.addColorStop(0.25, 'rgba(255,160,60,0.45)'); grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(46, 46, 1); sun.add(glow);
  scene.add(new THREE.PointLight(0xffffff, 2.2, 0, 0));
  scene.add(new THREE.AmbientLight(0x334466, 0.35));

  // Planets (sizes and distances compressed so everything fits)
  const P = [
    ['mercury', 1.2, 18, 0.88, 'mercury.jpg'],
    ['venus', 2.2, 26, 2.25, 'venus.jpg'],
    ['earth', 2.4, 35, 3.65, 'earth.jpg'],
    ['mars', 1.6, 44, 6.87, 'mars.jpg'],
    ['jupiter', 6.5, 60, 20, 'jupiter.jpg'],
    ['saturn', 5.4, 78, 32, 'saturn.jpg'],
    ['uranus', 3.6, 94, 46, 'uranus.jpg'],
    ['neptune', 3.5, 108, 60, 'neptune.jpg'],
  ];
  const bodies = [sun]; const planets = {}; const extras = {}; const spin = [];
  const addHit = (obj, rad) => { const h = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 8), new THREE.MeshBasicMaterial({ visible: false })); h.userData = obj.userData; obj.userData.mesh = obj; obj.add(h); bodies.push(h); };
  const smallMoon = (parent, r, dist, speed, color, tilt = 0) => { const piv = new THREE.Object3D(); piv.rotation.z = tilt; piv.rotation.y = Math.random() * 6; const mo = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 1 })); mo.position.x = dist; piv.add(mo); parent.add(piv); spin.push([piv, speed]); return mo; };
  P.forEach(([id, r, d, period, map], i) => {
    const pivot = new THREE.Object3D(); pivot.rotation.y = i * 1.7 + 0.6; scene.add(pivot);
    const mat = new THREE.MeshStandardMaterial({ map: tex(map), roughness: 1, metalness: 0 });
    if (id === 'earth') { mat.normalMap = tl.load('tex/earth_n.jpg'); mat.normalScale.set(0.6, 0.6); }
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, SEG, SEG * 0.75), mat);
    m.position.x = d; m.userData = { id, r, period }; pivot.add(m);
    if (id === 'earth') {
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, SEG, SEG * 0.75), new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tl.load('tex/clouds.jpg'), transparent: true, depthWrite: false }));
      m.add(clouds); m.userData.clouds = clouds;
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 24), new THREE.MeshStandardMaterial({ map: tex('moon.jpg') }));
      const mp = new THREE.Object3D(); mp.add(moon); moon.position.x = 3.4; mp.rotation.z = 0.35; m.add(mp); m.userData.moon = mp; moon.userData = { id: 'moon', r: 0.65, parent: 'earth' }; extras.moon = moon;
    }
    if (id === 'saturn') {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(r * 4.6, r * 4.6), new THREE.MeshStandardMaterial({ map: tex('saturn_ring.png'), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2 + 0.47; m.add(ring);
    }
    if (id === 'uranus') m.rotation.z = 1.7;
    const AC = { venus: 0xffd59a, earth: 0x5fa8ff, mars: 0xff8a50, uranus: 0x9fe8f0, neptune: 0x6f8cff };
    if (AC[id]) m.add(atmo(r, AC[id], 4.0, id === 'earth' ? 0.9 : 0.45));
    const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 180 }, (_, k) => new THREE.Vector3(Math.cos(k / 180 * Math.PI * 2) * d, 0, Math.sin(k / 180 * Math.PI * 2) * d))), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
    scene.add(orbit);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r * 2.2, 4.5), 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData = m.userData; hit.userData.mesh = m; m.add(hit);
    planets[id] = { mesh: m, pivot, period, orbit }; bodies.push(hit);
  });

  // --- ISS (simple model) orbiting Earth
  const E = planets.earth.mesh;
  { const iss = new THREE.Group(); const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.6, roughness: 0.35 });
    const pc = document.createElement('canvas'); pc.width = 64; pc.height = 256; const pg = pc.getContext('2d'); pg.fillStyle = '#1b2f6b'; pg.fillRect(0, 0, 64, 256); pg.strokeStyle = '#c9a24a'; pg.lineWidth = 2; for (let y = 0; y <= 256; y += 16) { pg.beginPath(); pg.moveTo(0, y); pg.lineTo(64, y); pg.stroke(); } pg.beginPath(); pg.moveTo(32, 0); pg.lineTo(32, 256); pg.stroke();
    const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.MeshStandardMaterial({ map: ptex, metalness: 0.5, roughness: 0.35, emissive: 0x0d1d4a, emissiveIntensity: 0.5, side: THREE.DoubleSide });
    const truss = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.05), metal); iss.add(truss);
    const mod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 12), metal); mod.rotation.x = Math.PI / 2; mod.position.z = -0.08; iss.add(mod);
    const mod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), metal); mod2.rotation.z = Math.PI / 2; mod2.position.z = 0.22; iss.add(mod2);
    for (const x of [-0.56, -0.42, 0.42, 0.56]) for (const y of [-1, 1]) { const pnl = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.44), panel); pnl.position.set(x, y * 0.27, 0); iss.add(pnl); }
    const rad = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })); rad.position.set(0.15, 0.08, 0); iss.add(rad);
    iss.scale.setScalar(0.42); const piv = new THREE.Object3D(); piv.rotation.z = 0.9; iss.position.x = 2.95; piv.add(iss); E.add(piv); spin.push([piv, 0.9]);
    iss.userData = { id: 'iss', r: 0.62, parent: 'earth' }; extras.iss = iss; addHit(iss, 0.9); }
  addHit(extras.moon, 1.3);
  // --- satellite constellation around Earth (glinting points)
  { const n = LOW ? 60 : 140, pos = new Float32Array(n * 3); const sats = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
    const data = Array.from({ length: n }, (_, i) => ({ r: 2.65 + Math.random() * 0.35, inc: (i % 7) * 0.45 + Math.random() * 0.1, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 0.5 }));
    sats.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); E.add(sats); extras.sats = sats;
    extras.satTick = (t) => { data.forEach((d, i) => { const a = d.ph + t * d.sp; const x = Math.cos(a) * d.r, z = Math.sin(a) * d.r; pos[i * 3] = x; pos[i * 3 + 1] = z * Math.sin(d.inc); pos[i * 3 + 2] = z * Math.cos(d.inc); }); sats.geometry.attributes.position.needsUpdate = true; }; }
  // --- other moons
  const J = planets.jupiter.mesh; [[0.32, 8.4, 1.8, 0xd9c27a], [0.28, 9.6, 1.3, 0xbfae9e], [0.42, 11.0, 0.9, 0x8f8a83], [0.38, 12.6, 0.6, 0x6f6a64]].forEach(([r, d, sp, c]) => smallMoon(J, r, d, sp, c));
  smallMoon(planets.saturn.mesh, 0.45, 12.5, 0.6, 0xd9a85b, 0.47);
  smallMoon(planets.mars.mesh, 0.18, 2.5, 2.2, 0x8a7f74); smallMoon(planets.mars.mesh, 0.12, 3.4, 1.4, 0x9a9087);
  smallMoon(planets.neptune.mesh, 0.3, 6.5, -0.8, 0xc9c4bd, 0.4);
  // --- asteroid belt between Mars and Jupiter
  { const n = LOW ? 280 : 900, geo = new THREE.IcosahedronGeometry(0.22, 0), belt = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 1, flatShading: true }), n); const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 49 + Math.random() * 6; v.set(Math.cos(a) * r, (Math.random() - 0.5) * 1.4, Math.sin(a) * r); q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)); const k = 0.4 + Math.random() * 1.4; sc.set(k, k * (0.6 + Math.random() * 0.6), k); M.compose(v, q, sc); belt.setMatrixAt(i, M); }
    const bp = new THREE.Object3D(); bp.add(belt); scene.add(bp); spin.push([bp, 0.012]); extras.belt = bp; }
  // --- comet with a tail pointing away from the Sun
  { const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdff6ff })); scene.add(head);
    const n = LOW ? 70 : 160, tp = new Float32Array(n * 3), tail = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.9, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    tail.geometry.setAttribute('position', new THREE.BufferAttribute(tp, 3)); scene.add(tail); const off = Array.from({ length: n }, () => [Math.random(), (Math.random() - .5), (Math.random() - .5)]);
    extras.comet = { head, tail }; extras.cometTick = (t) => { const a = t * 0.05, rx = 120, rz = 46; const x = Math.cos(a) * rx - 60, z = Math.sin(a) * rz; head.position.set(x, 6 + Math.sin(a) * 4, z);
      const away = head.position.clone().normalize(), len = 10 + 26 * Math.max(0, 1 - head.position.length() / 160);
      off.forEach(([u, j, k], i) => { const d = u * len, spread = u * 1.6; tp[i * 3] = head.position.x + away.x * d + j * spread; tp[i * 3 + 1] = head.position.y + away.y * d + k * spread; tp[i * 3 + 2] = head.position.z + away.z * d + (j - k) * spread; }); tail.geometry.attributes.position.needsUpdate = true; }; }

  // sizing
  let narrow = false;
  const resize = () => { const w = box.clientWidth, h = box.clientHeight || w; narrow = w < 700; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(box); resize();

  // picking
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const label = document.createElement('div'); label.className = 'gl-label'; box.appendChild(label);
  const pick = (e) => { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); const real = [sun, ...Object.values(planets).map((q) => q.mesh), extras.moon, extras.iss].filter((o) => o && o.visible !== false);
    const rh = ray.intersectObjects(real, true).find((h) => h.object.visible !== false && !(h.object.material && h.object.material.visible === false));
    if (rh) { let o = rh.object; while (o && !(o.userData && o.userData.id)) o = o.parent; if (o) return o.userData.mesh || o; }
    const hs = ray.intersectObjects(bodies, false).sort((a, b) => a.object.geometry.parameters.radius - b.object.geometry.parameters.radius);
    return hs[0] && (hs[0].object.userData.mesh || hs[0].object); };
  const nameOf = (id) => PL[id][cur][0];
  let hoverEv = null; const hover = () => { const e = hoverEv; hoverEv = null; const o = pick(e); hoverObj = o; renderer.domElement.style.cursor = o ? 'pointer' : 'grab'; if (o && !sel) { const r = box.getBoundingClientRect(); label.textContent = nameOf(o.userData.id); label.style.transform = `translate(${e.clientX - r.left + 14}px,${e.clientY - r.top - 10}px)`; label.style.opacity = 1; } else label.style.opacity = 0; };
  renderer.domElement.addEventListener('pointermove', (e) => { hovering = true; if (!hoverEv) requestAnimationFrame(hover); hoverEv = e; });
  renderer.domElement.addEventListener('pointerleave', () => { label.style.opacity = 0; hovering = false; });
  let hovering = false; renderer.domElement.addEventListener('pointerenter', () => hovering = true);
  let down = null, hoverObj = null;
  renderer.domElement.addEventListener('pointerdown', (e) => down = [e.clientX, e.clientY]);
  renderer.domElement.addEventListener('pointerup', (e) => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; const o = pick(e); if (o && o !== sel) focus(o.userData.id === 'sun' ? sun : o); });

  // camera views
  let sel = null, fly = null, view = null;
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const isNarrow = () => narrow;
  function featureView(m) {
    const id = m.userData.id, r = id === 'sun' ? 10 : m.userData.r * (id === 'saturn' ? 1.9 : 1);
    return () => {
      const p = m.getWorldPosition(new THREE.Vector3());
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const fill = isNarrow() ? 0.62 : 0.6;               // planet diameter vs viewport height
      const D = r / (fill * halfH);
      let side;
      if (id === 'sun') side = new THREE.Vector3(0.2, 0.15, 1).normalize();
      else { const out = p.clone().normalize(); side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize(); side.add(out.multiplyScalar(-0.12)).normalize(); side.y = 0.08; side.normalize(); }
      const pos = p.clone().add(side.clone().multiplyScalar(D));
      const fwd = p.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const shift = isNarrow() ? 0 : 0.36 * halfH * camera.aspect * D;   // push planet to the right half
      const tgt = p.clone().sub(right.multiplyScalar(shift));
      return [pos, tgt];
    };
  }
  const overView = () => () => { const n = isNarrow(); return [new THREE.Vector3(n ? 0 : -60, n ? 170 : 115, n ? 260 : 205), new THREE.Vector3(n ? 0 : -60, 0, 0)]; };
  const isolate = (m0) => { const m = m0 && m0.userData.parent ? planets[m0.userData.parent].mesh : m0; if (extras.belt) extras.belt.visible = !m0; if (extras.sats) extras.sats.visible = !m0 || m0 === planets.earth.mesh; if (extras.comet) { extras.comet.head.visible = extras.comet.tail.visible = !m0; } for (const id in planets) { const q = planets[id]; const show = !m || q.mesh === m; q.mesh.visible = show; q.orbit.visible = !m; } sun.visible = !m || m === sun || true; };
  function go(v, dur = 1800) { const [p1, t1] = v(); fly = { t0: performance.now(), dur, p0: camera.position.clone(), q0: controls.target.clone(), v }; view = v; }
  function focus(m) {
    sel = m; label.style.opacity = 0; box.classList.add('zoom'); controls.enabled = false;
    selP = m.userData.id; showInfo(selP); isolate(m === sun ? sun : m); go(featureView(m));
  }
  function home() { sel = null; selP = null; box.classList.remove('zoom'); showInfo(null); isolate(null); go(overView()); controls.enabled = !matchMedia('(pointer:coarse)').matches; }
  document.getElementById('back').onclick = (e) => { e.stopPropagation(); home(); };
  document.getElementById('overview').onclick = () => home();
  document.querySelectorAll('.psel').forEach((b) => b.onclick = () => focus(b.dataset.p === 'sun' ? sun : (extras[b.dataset.p] || planets[b.dataset.p].mesh)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) home(); });
  const byId = (id) => id === 'sun' ? sun : (extras[id] || planets[id].mesh);
  window.__space3d = { focus: (id) => focus(byId(id)), home, screen: (id) => { const v = byId(id).getWorldPosition(new THREE.Vector3()).project(camera); const r = renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; } };
  // start featured on Earth, already framed
  { const v = featureView(planets.earth.mesh); sel = planets.earth.mesh; selP = 'earth'; box.classList.add('zoom'); controls.enabled = false; view = v; isolate(planets.earth.mesh); const [p0, t0] = v(); camera.position.copy(p0); controls.target.copy(t0); showInfo('earth'); }

  // render loop (only while visible)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = false, ready = false, last = performance.now(), simT = 0;
  const kick = () => { if (visible && ready) { last = performance.now(); requestAnimationFrame(loop); } };
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); }).observe(box);
  const hidden = []; scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  const warm = renderer.compileAsync(scene, camera); hidden.forEach((o) => { o.visible = false; });
  warm.catch(() => {}).then(() => { renderer.render(scene, camera); ready = true; kick(); });
  // phones: skip drawing while the page is being scrolled so the GPU stays free for scrolling
  let scrolling = 0; if (LOW) addEventListener('scroll', () => { clearTimeout(scrolling); scrolling = setTimeout(() => { scrolling = 0; }, 150); }, { passive: true });
  let lastDraw = 0; const slow = { n: 0, t: 0, cap: false };
  function loop(now) {
    if (!visible) return;
    if (now - lastDraw < 15 || ((LOW || slow.cap) && (scrolling || now - lastDraw < 32))) { requestAnimationFrame(loop); return; } lastDraw = now;
    if (!LOW && !slow.cap) { slow.n++; slow.t += now - last; if (slow.n === 90) { if (slow.t / 90 > 22) { if (pr > 1) { pr = Math.max(1, pr - 0.25); renderer.setPixelRatio(pr); resize(); } else slow.cap = true; } slow.n = slow.t = 0; } }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const speed = reduce ? 0.05 : (sel ? 0.25 : (hoverObj ? 0 : (hovering ? 0.35 : 1)));
    simT += dt * speed;
    for (const id in planets) { const p = planets[id]; p.pivot.rotation.y += dt * speed * (0.3 / Math.sqrt(p.period)); p.mesh.rotation.y += dt * 0.25; if (p.mesh.userData.clouds) p.mesh.userData.clouds.rotation.y += dt * 0.05; if (p.mesh.userData.moon) p.mesh.userData.moon.rotation.y += dt * speed * 1.2; }
    sun.rotation.y += dt * 0.03;
    for (const [o, sp] of spin) o.rotation.y += dt * sp * (sel ? 0.4 : 1);
    if (extras.iss) { extras.iss.lookAt(camera.position); extras.iss.rotateY(0.55); extras.iss.rotateX(-0.25); }
    if (extras.satTick) extras.satTick(simT); if (extras.cometTick) extras.cometTick(simT);
    if (fly) { const t = Math.min(1, (now - fly.t0) / fly.dur), k = ease(t); const [p1, t1] = fly.v(); camera.position.lerpVectors(fly.p0, p1, k); controls.target.lerpVectors(fly.q0, t1, k); camera.lookAt(controls.target); if (t >= 1) fly = null; }
    else if (sel && view) { const [p1, t1] = view(); camera.position.copy(p1); controls.target.copy(t1); camera.lookAt(t1); }
    else controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
}
