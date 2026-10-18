import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Localized, volumetric 3D weather phenomena anchored in world space at each
// weather point. Designed in a stylized low-poly diorama aesthetic:
//   • two-tone sculpted cumulus/storm cloud banks (flat bottoms + puffy tops)
//   • falling 3D rain shafts with expanding ground splash ripples
//   • swirling snow columns with tumbling 3D ice crystals & ground snowdrifts
//   • layered 3D low-poly mist ribbons + soft ground-hugging fog puffs
//   • a faceted 3D sun with dual counter-rotating ray crowns & corona halo
//   • multi-branch forked lightning bolts with internal cloud-belly flash
//
// Entirely procedural — no external model assets to download — so it works
// offline and adds no bundle weight, and is driven per frame from the terrain
// viewer's render loop. Distant rigs are culled so a long route with many
// weather points stays cheap.
// ---------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// Soft radial-gradient sprite texture (glow / snowflake / fog puff).
function softTexture(inner, outer) {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class WeatherFx3D {
  // scale    — marker scale (≈ worldSpan / 300); sizes the rigs to the terrain.
  // worldSpan — terrain span in world units; sets the distance-cull radius.
  constructor(scene, { scale = 1, worldSpan = 2000 } = {}) {
    this.scene = scene;
    this.U = Math.max(0.5, scale);
    this.worldSpan = worldSpan || 2000;
    this.group = new THREE.Group();
    this.group.renderOrder = 4;
    scene.add(this.group);

    this._rigs = [];
    this._visible = true;
    this._time = 0;
    // Only rigs beyond this radius of the camera sleep. Kept generous so weather
    // stays visible when the user zooms out to frame the whole route — it only
    // trims genuinely far-off rigs on very large multi-day routes.
    this._cullDist = Math.max(this.worldSpan * 8, 50000);

    // Shared GPU resources, disposed together with the instance.
    this._glowTex = softTexture('rgba(255,242,195,0.95)', 'rgba(255,195,70,0)');
    this._flakeTex = softTexture('rgba(255,255,255,0.95)', 'rgba(220,240,255,0)');
    this._fogTex = softTexture('rgba(230,238,248,0.78)', 'rgba(220,230,242,0)');
    this._cloudGeo = new THREE.DodecahedronGeometry(1, 1);
    this._cloudBaseGeo = new THREE.CylinderGeometry(0.92, 0.78, 0.55, 7);
    this._sunGeo = new THREE.IcosahedronGeometry(1, 1);
    this._coronaGeo = new THREE.OctahedronGeometry(1, 0);
    this._rayGeo = new THREE.ConeGeometry(0.22, 1, 4);
    this._SplashRingGeo = new THREE.RingGeometry(0.65, 1.0, 12);
    this._crystalGeo = new THREE.OctahedronGeometry(1, 0);
    this._mistGeo = new THREE.DodecahedronGeometry(1, 0);
    this._disposables = [
      this._glowTex, this._flakeTex, this._fogTex,
      this._cloudGeo, this._cloudBaseGeo, this._sunGeo,
      this._coronaGeo, this._rayGeo, this._SplashRingGeo,
      this._crystalGeo, this._mistGeo,
    ];
  }

  // points: [{ pos: THREE.Vector3, cat: string }]. cat is the coarse weather
  // category ('clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder').
  build(points) {
    for (const p of points || []) {
      if (!p || !p.pos) continue;
      const rig = this._buildRig(p.cat || 'clear');
      if (!rig) continue;
      rig.group.position.copy(p.pos);
      rig.group.rotation.y = Math.random() * TWO_PI;
      this.group.add(rig.group);
      this._rigs.push(rig);
    }
    this.group.visible = this._visible;
  }

  hasRigs() {
    return this._rigs.length > 0;
  }

  setVisible(v) {
    this._visible = !!v;
    if (this.group) this.group.visible = this._visible;
  }

  update(dt, camera) {
    if (!this._visible || !this._rigs.length || !this.group) return;
    this._time += dt;
    const t = this._time;
    const camPos = camera ? camera.position : null;
    for (const rig of this._rigs) {
      if (camPos) {
        const vis = rig.group.position.distanceTo(camPos) < this._cullDist;
        if (rig.group.visible !== vis) rig.group.visible = vis;
        if (!vis) continue;
      }
      rig.update(dt, t);
    }
  }

  dispose() {
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    for (const d of this._disposables) { try { d.dispose(); } catch { /* noop */ } }
    this._disposables = [];
    this._rigs = [];
    this.group = null;
  }

  // ---- rig factory ----------------------------------------------------------

  _buildRig(cat) {
    switch (cat) {
      case 'clear':   return this._makeSun();
      case 'cloudy':  return this._makeCloudy();
      case 'fog':     return this._makeFog();
      case 'snow':    return this._makeSnow();
      case 'drizzle':
      case 'rain':
      case 'thunder': return this._makePrecip(cat);
      default:        return this._makeCloudy();
    }
  }

  // Sculpted low-poly diorama cloud cluster: flat-bottomed underside base +
  // multi-tiered puffy upper crown lobes with subtle two-tone shading.
  // Returns { obj, update, bellyMat } so storm rigs can pulse the underside.
  _makeClouds(count, color, opacity, baseY, spread, blobR) {
    const g = new THREE.Group();
    g.position.y = baseY;
    const topCol = new THREE.Color(color);
    const bellyCol = topCol.clone().multiplyScalar(0.76);

    const topMat = new THREE.MeshStandardMaterial({
      color: topCol,
      roughness: 0.88,
      metalness: 0.02,
      flatShading: true,
      transparent: true,
      opacity,
      emissive: topCol.clone().multiplyScalar(0.24),
    });
    const bellyMat = new THREE.MeshStandardMaterial({
      color: bellyCol,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: Math.min(1, opacity + 0.02),
      emissive: bellyCol.clone().multiplyScalar(0.18),
    });
    this._disposables.push(topMat, bellyMat);

    const blobs = [];
    // Central main crown lobe + surrounding sculpted lobes.
    for (let i = 0; i < count; i++) {
      const isCenter = i === 0;
      const a = isCenter ? 0 : ((i - 1) / Math.max(1, count - 1)) * TWO_PI + Math.random() * 0.45;
      const rr = isCenter ? 0 : spread * (0.32 + Math.random() * 0.62);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr * 0.76;
      const tier = isCenter ? 1.25 : (0.72 + Math.random() * 0.48);
      const s = blobR * tier;
      const y0 = (isCenter ? 0.22 : (Math.random() - 0.35) * 0.26) * blobR;

      // Upper puffy crown lobe.
      const m = new THREE.Mesh(this._cloudGeo, topMat);
      m.position.set(x, y0 + s * 0.18, z);
      m.scale.set(s * 1.32, s * 0.88, s * 1.08);
      m.rotation.set(Math.random() * 0.5, Math.random() * TWO_PI, Math.random() * 0.5);
      m.castShadow = true;
      g.add(m);

      // Flat-bottomed diorama cloud base disc under the lobe.
      const base = new THREE.Mesh(this._cloudBaseGeo, bellyMat);
      base.position.set(x, y0 - s * 0.28, z);
      base.scale.set(s * 1.25, s * 0.6, s * 1.02);
      base.rotation.y = a;
      g.add(base);

      blobs.push({ m, base, y0, s, ph: Math.random() * TWO_PI, bob: 0.5 + Math.random() * 0.55 });
    }

    const driftR = spread * 0.15;
    const dphase = Math.random() * TWO_PI;
    const update = (dt, t) => {
      g.rotation.y += dt * 0.035;
      g.position.x = Math.cos(t * 0.065 + dphase) * driftR;
      g.position.z = Math.sin(t * 0.052 + dphase) * driftR;
      for (const b of blobs) {
        const dy = Math.sin(t * b.bob + b.ph) * blobR * 0.1;
        b.m.position.y = b.y0 + b.s * 0.18 + dy;
        b.base.position.y = b.y0 - b.s * 0.28 + dy * 0.6;
      }
    };
    return { obj: g, update, bellyMat };
  }

  _makeCloudy() {
    const U = this.U;
    const g = new THREE.Group();
    const mainClouds = this._makeClouds(7, 0xf2f6fc, 0.96, 40 * U, 22 * U, 10 * U);
    const subClouds = this._makeClouds(4, 0xdce5f2, 0.9, 33 * U, 14 * U, 6.5 * U);
    subClouds.obj.position.x = 12 * U;
    subClouds.obj.position.z = -8 * U;
    g.add(mainClouds.obj, subClouds.obj);
    return {
      group: g,
      update: (dt, t) => {
        mainClouds.update(dt, t);
        subClouds.update(dt, t + 1.7);
      },
    };
  }

  // Storm cloud + falling rain shaft + ground splash ripples.
  // Thunder additionally forks a multi-branch bolt to ground and pulses the cloud belly.
  _makePrecip(cat) {
    const U = this.U;
    const g = new THREE.Group();
    const isThunder = cat === 'thunder';
    const isDrizzle = cat === 'drizzle';

    const cloudBaseY = 40 * U;
    const cloudColor = isThunder ? 0x525c70 : (isDrizzle ? 0xaab8ca : 0x8796ab);
    const clouds = this._makeClouds(isThunder ? 8 : 7, cloudColor, 0.96, cloudBaseY, 22 * U, isThunder ? 11 * U : 10 * U);
    g.add(clouds.obj);

    const drops = isDrizzle ? 65 : 120;
    const colH = cloudBaseY - 3 * U;
    const radius = 13.5 * U;
    const len = (isDrizzle ? 3.2 : 6.2) * U;
    const positions = new Float32Array(drops * 2 * 3);
    const bx = new Float32Array(drops);
    const bz = new Float32Array(drops);
    const ys = new Float32Array(drops);
    const sp = new Float32Array(drops);
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * TWO_PI;
      const rr = Math.sqrt(Math.random()) * radius;
      bx[i] = Math.cos(a) * rr;
      bz[i] = Math.sin(a) * rr;
      ys[i] = Math.random() * colH;
      sp[i] = (isDrizzle ? 19 : 35) * U * (0.8 + Math.random() * 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: isDrizzle ? 0xc2d6ee : 0x9cc6ff,
      transparent: true,
      opacity: isDrizzle ? 0.38 : 0.54,
      depthWrite: false,
    });
    this._disposables.push(mat);
    const rain = new THREE.LineSegments(geo, mat);
    rain.frustumCulled = false;
    g.add(rain);

    // Diorama ground splash ripples where the rain column meets the terrain.
    const rippleCount = isDrizzle ? 3 : 5;
    const ripples = [];
    for (let i = 0; i < rippleCount; i++) {
      const rmat = new THREE.MeshBasicMaterial({
        color: 0xaad4ff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this._disposables.push(rmat);
      const rmesh = new THREE.Mesh(this._SplashRingGeo, rmat);
      rmesh.rotation.x = -Math.PI / 2;
      const ang = (i / rippleCount) * TWO_PI;
      const dist = (0.2 + 0.55 * ((i * 0.618) % 1)) * radius;
      rmesh.position.set(Math.cos(ang) * dist, 0.8 * U, Math.sin(ang) * dist);
      g.add(rmesh);
      ripples.push({ mesh: rmesh, mat: rmat, phase: i / rippleCount });
    }

    const writeDrops = () => {
      const p = positions;
      for (let i = 0; i < drops; i++) {
        const y = ys[i];
        const o = i * 6;
        p[o] = bx[i];                  p[o + 1] = y + len; p[o + 2] = bz[i];
        p[o + 3] = bx[i] - 0.16 * len; p[o + 4] = y;       p[o + 5] = bz[i];
      }
      geo.attributes.position.needsUpdate = true;
    };
    writeDrops();

    // Thunder extras: a multi-branch forked bolt (main trunk + 2 side branches) +
    // point flash + cloud-belly internal illumination.
    let boltGeo = null;
    let bolt = null;
    let flashLight = null;
    let nextStrike = 0;
    let flash = 0;
    const MAIN_SEGS = 10;
    const BRANCH_SEGS = 4;
    const TOTAL_SEGS = MAIN_SEGS + BRANCH_SEGS * 2;
    const baseBellyEmissive = clouds.bellyMat.emissive.clone();
    if (isThunder) {
      boltGeo = new THREE.BufferGeometry();
      boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TOTAL_SEGS * 2 * 3), 3));
      const bmat = new THREE.LineBasicMaterial({
        color: 0xdff0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._disposables.push(bmat);
      bolt = new THREE.LineSegments(boltGeo, bmat);
      bolt.frustumCulled = false;
      bolt.visible = false;
      g.add(bolt);
      flashLight = new THREE.PointLight(0xc4dcff, 0, 150 * U, 2);
      flashLight.position.y = cloudBaseY * 0.72;
      g.add(flashLight);
      nextStrike = 0.9 + Math.random() * 3.5;
    }

    const strike = () => {
      const arr = boltGeo.attributes.position.array;
      const topY = cloudBaseY - 2 * U;
      const botY = 1.5 * U;
      const ex = (Math.random() - 0.5) * radius * 0.9;
      const ez = (Math.random() - 0.5) * radius * 0.9;
      const spine = [];
      for (let i = 0; i <= MAIN_SEGS; i++) {
        const f = i / MAIN_SEGS;
        const jit = (1 - f * 0.7) * 5.5 * U;
        spine.push([
          ex * f + (i === 0 ? 0 : (Math.random() - 0.5) * jit),
          topY + (botY - topY) * f,
          ez * f + (i === 0 ? 0 : (Math.random() - 0.5) * jit),
        ]);
      }
      let ptr = 0;
      const pushSeg = (a, b) => {
        arr[ptr++] = a[0]; arr[ptr++] = a[1]; arr[ptr++] = a[2];
        arr[ptr++] = b[0]; arr[ptr++] = b[1]; arr[ptr++] = b[2];
      };
      for (let i = 0; i < MAIN_SEGS; i++) pushSeg(spine[i], spine[i + 1]);

      // Two forked side branches splitting off from mid-air nodes.
      for (const rootIdx of [3, 6]) {
        let cur = spine[rootIdx];
        const dirX = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 2.5) * U;
        const dirZ = (Math.random() - 0.5) * 4 * U;
        for (let s = 0; s < BRANCH_SEGS; s++) {
          const nxt = [
            cur[0] + dirX + (Math.random() - 0.5) * 2 * U,
            cur[1] - (topY - botY) * 0.11,
            cur[2] + dirZ + (Math.random() - 0.5) * 2 * U,
          ];
          pushSeg(cur, nxt);
          cur = nxt;
        }
      }
      boltGeo.attributes.position.needsUpdate = true;
      flash = 1;
    };

    const update = (dt, t) => {
      clouds.update(dt, t);
      for (let i = 0; i < drops; i++) {
        ys[i] -= sp[i] * dt;
        if (ys[i] < 0) ys[i] += colH;
      }
      writeDrops();
      for (const r of ripples) {
        const cyc = (t * (isDrizzle ? 0.75 : 1.15) + r.phase) % 1;
        const sc = (1.2 + cyc * 4.2) * U;
        r.mesh.scale.set(sc, sc, 1);
        r.mat.opacity = (1 - cyc) * (isDrizzle ? 0.28 : 0.45);
      }
      if (isThunder) {
        nextStrike -= dt;
        if (nextStrike <= 0) { strike(); nextStrike = 2.4 + Math.random() * 4.8; }
        if (flash > 0) flash = Math.max(0, flash - dt / 0.18);
        bolt.material.opacity = flash;
        bolt.visible = flash > 0;
        flashLight.intensity = flash * 2.6;
        clouds.bellyMat.emissive.copy(baseBellyEmissive).lerp(new THREE.Color(0x9ec5ff), flash * 0.85);
      }
    };
    return { group: g, update };
  }

  // Snow cloud + swirling flake sprites + tumbling 3D ice crystals + ground snowdrift.
  _makeSnow() {
    const U = this.U;
    const g = new THREE.Group();
    const cloudBaseY = 40 * U;
    const clouds = this._makeClouds(7, 0xe4ecf7, 0.96, cloudBaseY, 22 * U, 10 * U);
    g.add(clouds.obj);

    // Diorama snowdrift ring cushion on the ground beneath the snowfall.
    const driftMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff, roughness: 0.85, metalness: 0.05, flatShading: true,
      emissive: 0x2a384c, emissiveIntensity: 0.25,
    });
    this._disposables.push(driftMat);
    for (let i = 0; i < 5; i++) {
      const mound = new THREE.Mesh(this._cloudGeo, driftMat);
      const ang = (i / 5) * TWO_PI;
      const rr = (i === 0 ? 0 : 6.5 * U);
      const sx = (i === 0 ? 7.5 : 4.8) * U;
      mound.position.set(Math.cos(ang) * rr, 0.6 * U, Math.sin(ang) * rr);
      mound.scale.set(sx, 1.3 * U, sx * 0.85);
      g.add(mound);
    }

    const n = 90;
    const colH = cloudBaseY - 2 * U;
    const radius = 15 * U;
    const pos = new Float32Array(n * 3);
    const bx = new Float32Array(n);
    const bz = new Float32Array(n);
    const ys = new Float32Array(n);
    const ph = new Float32Array(n);
    const sp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const rr = Math.sqrt(Math.random()) * radius;
      bx[i] = Math.cos(a) * rr;
      bz[i] = Math.sin(a) * rr;
      ys[i] = Math.random() * colH;
      ph[i] = Math.random() * TWO_PI;
      sp[i] = (3 + Math.random() * 3) * U;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this._flakeTex, color: 0xffffff, size: 2.8 * U, sizeAttenuation: true,
      transparent: true, opacity: 0.92, depthWrite: false,
    });
    this._disposables.push(mat);
    const snow = new THREE.Points(geo, mat);
    snow.frustumCulled = false;
    g.add(snow);

    // 3D tumbling low-poly ice crystals interspersed in the snow shaft.
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x8ab8e6, emissiveIntensity: 0.45,
      roughness: 0.3, metalness: 0.1, flatShading: true,
    });
    this._disposables.push(crystalMat);
    const crystals = [];
    for (let i = 0; i < 12; i++) {
      const cm = new THREE.Mesh(this._crystalGeo, crystalMat);
      const a = (i / 12) * TWO_PI;
      const rr = (0.25 + 0.7 * ((i * 0.37) % 1)) * radius;
      cm.scale.set(1.3 * U, 0.45 * U, 1.3 * U);
      g.add(cm);
      crystals.push({
        m: cm,
        x0: Math.cos(a) * rr,
        z0: Math.sin(a) * rr,
        y: (i / 12) * colH,
        sp: (3.5 + (i % 3) * 0.9) * U,
        ph: i * 1.1,
      });
    }

    const write = (t) => {
      for (let i = 0; i < n; i++) {
        pos[i * 3] = bx[i] + Math.sin(t * 0.8 + ph[i]) * 2.2 * U;
        pos[i * 3 + 1] = ys[i];
        pos[i * 3 + 2] = bz[i] + Math.cos(t * 0.7 + ph[i]) * 2.2 * U;
      }
      geo.attributes.position.needsUpdate = true;
    };
    write(0);
    const update = (dt, t) => {
      clouds.update(dt, t);
      for (let i = 0; i < n; i++) { ys[i] -= sp[i] * dt; if (ys[i] < 0) ys[i] += colH; }
      write(t);
      for (const c of crystals) {
        c.y -= c.sp * dt;
        if (c.y < 1 * U) c.y += colH;
        c.m.position.set(
          c.x0 + Math.sin(t * 0.9 + c.ph) * 2 * U,
          c.y,
          c.z0 + Math.cos(t * 0.8 + c.ph) * 2 * U
        );
        c.m.rotation.x += dt * 1.4;
        c.m.rotation.z += dt * 1.1;
      }
    };
    return { group: g, update };
  }

  // Layered ground-hugging 3D low-poly mist ribbons + soft breathing fog puffs.
  _makeFog() {
    const U = this.U;
    const g = new THREE.Group();
    const n = 7;
    const radius = 24 * U;
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._fogTex, color: 0xd8e0ea, transparent: true, opacity: 0, depthWrite: false,
      });
      this._disposables.push(mat);
      const s = new THREE.Sprite(mat);
      const a = (i / n) * TWO_PI;
      const rr = radius * (0.25 + Math.random() * 0.75);
      const size = (22 + Math.random() * 18) * U;
      s.scale.set(size * 1.75, size, 1);
      s.position.set(Math.cos(a) * rr, (3.5 + Math.random() * 6) * U, Math.sin(a) * rr);
      g.add(s);
      puffs.push({ s, a, rr, base: 0.28 + Math.random() * 0.22, ph: Math.random() * TWO_PI, spin: 0.04 + Math.random() * 0.05 });
    }

    // Sculpted 3D low-poly mist pillows floating horizontally through the fog bank.
    const mistMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0x3b4452,
      emissiveIntensity: 0.28,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this._disposables.push(mistMat);
    const ribbons = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this._mistGeo, mistMat);
      const a = (i / 5) * TWO_PI;
      const rr = (5 + i * 3.2) * U;
      const y0 = (2.8 + (i % 3) * 3.2) * U;
      const w = (9 + (i % 2) * 4) * U;
      m.scale.set(w * 1.6, 1.8 * U, w * 0.9);
      m.position.set(Math.cos(a) * rr, y0, Math.sin(a) * rr);
      g.add(m);
      ribbons.push({ m, a, rr, y0, ph: i * 1.3 });
    }

    const update = (dt, t) => {
      for (const p of puffs) {
        p.a += dt * p.spin;
        p.s.position.x = Math.cos(p.a) * p.rr;
        p.s.position.z = Math.sin(p.a) * p.rr;
        p.s.material.opacity = p.base * (0.6 + 0.4 * Math.sin(t * 0.5 + p.ph));
      }
      for (const r of ribbons) {
        r.a += dt * 0.03;
        r.m.position.x = Math.cos(r.a) * r.rr;
        r.m.position.z = Math.sin(r.a) * r.rr;
        r.m.position.y = r.y0 + Math.sin(t * 0.6 + r.ph) * 0.9 * U;
        r.m.rotation.y = -r.a;
      }
    };
    return { group: g, update };
  }

  // A pulsing 3D diorama sun: faceted golden core, inner amber corona shell,
  // dual counter-rotating crowns of long & short sunbeams, and additive glow.
  _makeSun() {
    const U = this.U;
    const g = new THREE.Group();
    const sky = new THREE.Group();
    sky.position.y = 48 * U;
    g.add(sky);

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffd84d, emissive: 0xffa818, emissiveIntensity: 1.15, roughness: 0.42, metalness: 0.05, flatShading: true,
    });
    const coronaMat = new THREE.MeshStandardMaterial({
      color: 0xffe885, emissive: 0xffbe2e, emissiveIntensity: 0.9, roughness: 0.5, transparent: true, opacity: 0.48, flatShading: true,
    });
    this._disposables.push(coreMat, coronaMat);

    const core = new THREE.Mesh(this._sunGeo, coreMat);
    core.scale.setScalar(7.8 * U);
    sky.add(core);

    const corona = new THREE.Mesh(this._coronaGeo, coronaMat);
    corona.scale.setScalar(9.6 * U);
    sky.add(corona);

    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0xffd65c, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._disposables.push(glowMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(36 * U);
    sky.add(glow);

    // Outer primary sunbeam crown + inner tilted secondary crown.
    const raysOuter = new THREE.Group();
    const raysInner = new THREE.Group();
    raysInner.rotation.x = Math.PI / 7;
    raysInner.rotation.z = Math.PI / 9;

    const rayMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xff9d14, emissiveIntensity: 0.95, transparent: true, opacity: 0.88, flatShading: true,
    });
    const rayMatInner = new THREE.MeshStandardMaterial({
      color: 0xffe680, emissive: 0xffb82b, emissiveIntensity: 0.85, transparent: true, opacity: 0.78, flatShading: true,
    });
    this._disposables.push(rayMat, rayMatInner);

    const rayCount = 10;
    for (let i = 0; i < rayCount; i++) {
      const isMajor = (i % 2) === 0;
      const m = new THREE.Mesh(this._rayGeo, rayMat);
      const a = (i / rayCount) * TWO_PI;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const len = (isMajor ? 9.5 : 6.2) * U;
      const rad = (isMajor ? 3.2 : 2.3) * U;
      m.scale.set(rad, len, rad);
      m.quaternion.setFromUnitVectors(UP, dir);
      m.position.copy(dir).multiplyScalar((isMajor ? 15.2 : 13.5) * U);
      raysOuter.add(m);
    }

    const innerCount = 6;
    for (let i = 0; i < innerCount; i++) {
      const m = new THREE.Mesh(this._rayGeo, rayMatInner);
      const a = ((i + 0.5) / innerCount) * TWO_PI;
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a * 2) * 0.28, Math.sin(a)).normalize();
      m.scale.set(2.2 * U, 6.8 * U, 2.2 * U);
      m.quaternion.setFromUnitVectors(UP, dir);
      m.position.copy(dir).multiplyScalar(13.8 * U);
      raysInner.add(m);
    }

    sky.add(raysOuter, raysInner);

    const update = (dt, t) => {
      core.rotation.y += dt * 0.32;
      core.rotation.x += dt * 0.16;
      corona.rotation.y -= dt * 0.45;
      corona.rotation.z += dt * 0.25;
      raysOuter.rotation.y += dt * 0.48;
      raysInner.rotation.y -= dt * 0.36;
      const pulse = 1 + 0.08 * Math.sin(t * 2.2);
      corona.scale.setScalar(9.6 * U * (1 + 0.05 * Math.cos(t * 3)));
      glow.scale.setScalar(36 * U * pulse);
      glow.material.opacity = 0.72 + 0.14 * Math.sin(t * 2.2);
    };
    return { group: g, update };
  }
}
