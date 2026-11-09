// Interactive 3D solar system — textures: Solar System Scope (CC BY 4.0)
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const box = document.getElementById('orrery');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); } catch (e) { renderer = null; }
if (renderer && box) init();

function init() {
  box.classList.add('gl');
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  box.prepend(renderer.domElement);
  renderer.domElement.className = 'gl-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  const HOME = new THREE.Vector3(0, 120, 215);
  camera.position.copy(HOME);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false;
  controls.rotateSpeed = 0.5; controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI - 0.2;
  if (matchMedia('(pointer:coarse)').matches) controls.enabled = false; // keep page scroll on phones

  const tl = new THREE.TextureLoader();
  const tex = (f) => { const t = tl.load('tex/' + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

  // Milky Way backdrop
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 32), new THREE.MeshBasicMaterial({ map: tex('stars.jpg'), side: THREE.BackSide, color: 0x8899aa }));
  scene.add(sky);

  // Sun
  const sun = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 48), new THREE.MeshBasicMaterial({ map: tex('sun.jpg') }));
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
  const bodies = [sun]; const planets = {};
  P.forEach(([id, r, d, period, map], i) => {
    const pivot = new THREE.Object3D(); pivot.rotation.y = i * 1.7 + 0.6; scene.add(pivot);
    const mat = new THREE.MeshStandardMaterial({ map: tex(map), roughness: 1, metalness: 0 });
    if (id === 'earth') { mat.normalMap = tl.load('tex/earth_n.jpg'); mat.normalScale.set(0.6, 0.6); }
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), mat);
    m.position.x = d; m.userData = { id, r, period }; pivot.add(m);
    if (id === 'earth') {
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 64, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tl.load('tex/clouds.jpg'), transparent: true, depthWrite: false }));
      m.add(clouds); m.userData.clouds = clouds;
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 24), new THREE.MeshStandardMaterial({ map: tex('moon.jpg') }));
      const mp = new THREE.Object3D(); mp.add(moon); moon.position.x = 4.5; m.add(mp); m.userData.moon = mp;
    }
    if (id === 'saturn') {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(r * 4.6, r * 4.6), new THREE.MeshStandardMaterial({ map: tex('saturn_ring.png'), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2 + 0.47; m.add(ring);
    }
    if (id === 'uranus') m.rotation.z = 1.7;
    const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 180 }, (_, k) => new THREE.Vector3(Math.cos(k / 180 * Math.PI * 2) * d, 0, Math.sin(k / 180 * Math.PI * 2) * d))), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
    scene.add(orbit);
    planets[id] = { mesh: m, pivot, period, orbit }; bodies.push(m);
  });

  // sizing
  const resize = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(box); resize();

  // picking
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const label = document.createElement('div'); label.className = 'gl-label'; box.appendChild(label);
  const pick = (e) => { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(bodies, false)[0]; return hit && hit.object; };
  const nameOf = (id) => PL[id][cur][0];
  renderer.domElement.addEventListener('pointermove', (e) => { const o = pick(e); renderer.domElement.style.cursor = o ? 'pointer' : 'grab'; if (o && !sel) { const r = box.getBoundingClientRect(); label.textContent = nameOf(o.userData.id); label.style.transform = `translate(${e.clientX - r.left + 14}px,${e.clientY - r.top - 10}px)`; label.style.opacity = 1; } else label.style.opacity = 0; });
  renderer.domElement.addEventListener('pointerleave', () => label.style.opacity = 0);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => down = [e.clientX, e.clientY]);
  renderer.domElement.addEventListener('pointerup', (e) => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; const o = pick(e); if (o) focus(o.userData.id === 'sun' ? sun : o); });

  // camera flights
  let sel = null, fly = null, follow = false;
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function flyTo(posFn, tgtFn, dur = 1600) { follow = false; fly = { t0: performance.now(), dur, p0: camera.position.clone(), q0: controls.target.clone(), posFn, tgtFn }; }
  function focus(m) {
    sel = m; label.style.opacity = 0; box.classList.add('zoom');
    const id = m.userData.id; selP = id; showInfo(id);
    const r = id === 'sun' ? 10 : m.userData.r;
    const dist = id === 'sun' ? 48 : r * 4.2 + (id === 'saturn' ? 8 : 2);
    const wp = () => m.getWorldPosition(new THREE.Vector3());
    flyTo(() => { const p = wp(); if (id === 'sun') return new THREE.Vector3(0, dist * 0.35, dist);
      const out = p.clone().normalize(), side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
      return p.clone().add(out.multiplyScalar(-dist * 0.75)).add(side.multiplyScalar(dist * 0.55)).add(new THREE.Vector3(0, dist * 0.3, 0)); }, wp);
  }
  function home() { sel = null; selP = null; box.classList.remove('zoom'); showInfo(null); flyTo(() => HOME.clone(), () => new THREE.Vector3()); }
  document.getElementById('back').onclick = (e) => { e.stopPropagation(); home(); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) home(); });
  window.__space3d = { focus: (id) => focus(id === 'sun' ? sun : planets[id].mesh), home };

  // render loop (only while visible)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = false, last = performance.now(), simT = 0;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) { last = performance.now(); requestAnimationFrame(loop); } }).observe(box);
  function loop(now) {
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const speed = reduce ? 0.15 : (sel ? 0.12 : 1);
    simT += dt * speed;
    for (const id in planets) { const p = planets[id]; p.pivot.rotation.y += dt * speed * (2.2 / p.period); p.mesh.rotation.y += dt * 0.25; if (p.mesh.userData.clouds) p.mesh.userData.clouds.rotation.y += dt * 0.05; if (p.mesh.userData.moon) p.mesh.userData.moon.rotation.y += dt * speed * 1.2; }
    sun.rotation.y += dt * 0.03;
    if (fly) { const t = Math.min(1, (now - fly.t0) / fly.dur), k = ease(t); camera.position.lerpVectors(fly.p0, fly.posFn(), k); controls.target.lerpVectors(fly.q0, fly.tgtFn(), k); if (t >= 1) { fly = null; follow = !!sel; } }
    if (follow && sel) { const p = sel.getWorldPosition(new THREE.Vector3()); const delta = p.clone().sub(controls.target); camera.position.add(delta); controls.target.copy(p); }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
}
