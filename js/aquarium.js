/* 3D aquarium. Every model is procedural polygon geometry built at load time. */
(function () {
  'use strict';
  const T = window.THREE;
  const $ = (id) => document.getElementById(id);

  // Tank interior in world units; origin is the centre of the tank floor.
  const TW = 14, TD = 7, TH = 8, WY = 7.45, GT = 0.12;
  const TAU = Math.PI * 2;
  const G = { uTime: { value: 0 } };

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const sinp = (x) => Math.max(0, Math.sin(Math.PI * x));
  const rand = (a, b) => a + (b - a) * Math.random();

  // Seeded generator: the scenery is identical on every load, only behaviour is random.
  let seed = 90210;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rr = (a, b) => a + (b - a) * rnd();

  const hex = (h) => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const WHITE = hex(0xffffff), BLACK = hex(0x07080b);

  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let u = x - xi, v = y - yi, w = z - zi;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
    const h = (a, b, c) => hash3(xi + a, yi + b, zi + c);
    return lerp(
      lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
  }
  function fbm(x, y, z, oct) {
    let a = 0.5, s = 0, n = 0;
    for (let i = 0; i < (oct || 4); i++) { s += a * noise3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
    return s / n;
  }

  const sandH = (x, z) => 0.35 + 0.55 * fbm(x * 0.22 + 3.1, 0.5, z * 0.22, 3) + 0.75 * smooth(1.5, -3.5, z) +
    0.03 * Math.sin(x * 4.2 + z * 1.3 + 3 * noise3(x * 0.3, 1, z * 0.3)) * smooth(-1, 2.5, z);

  // ------------------------------------------------------- geometry builder
  class Geo {
    constructor() { this.pos = []; this.col = []; this.uv = []; this.flex = []; this.idx = []; }
    get count() { return this.pos.length / 3; }
    vert(x, y, z, c, u, v, fx, fy, fz, fw) {
      this.pos.push(x, y, z);
      this.col.push(c[0], c[1], c[2], c.length > 3 ? c[3] : 1);
      this.uv.push(u || 0, v || 0);
      this.flex.push(fx || 0, fy || 0, fz || 0, fw || 0);
    }
    // Triangulates a (ni+1) x (nj+1) vertex grid; `wrap` closes the j direction without a seam.
    grid(base, ni, nj, flip, wrap) {
      const w = wrap ? nj : nj + 1;
      for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
        const jn = wrap ? (j + 1) % nj : j + 1;
        const a = base + i * w + j, b = a + w, d = base + i * w + jn, c = d + w;
        if (flip) this.idx.push(a, d, b, b, d, c); else this.idx.push(a, b, d, b, c, d);
      }
    }
    build() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.col, 4));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('aFlex', new T.Float32BufferAttribute(this.flex, 4));
      g.setIndex(this.idx);
      g.computeVertexNormals();
      return g;
    }
  }

  // Tube swept along a polyline, frame carried by parallel transport so it never twists.
  function tube(geo, pts, rad, nr, col, flex) {
    const base = geo.count, n = pts.length - 1;
    const t = new T.Vector3(), N = new T.Vector3(), B = new T.Vector3();
    for (let i = 0; i <= n; i++) {
      t.subVectors(pts[Math.min(i + 1, n)], pts[Math.max(i - 1, 0)]).normalize();
      if (i === 0) { if (Math.abs(t.y) > 0.8) N.set(1, 0, 0); else N.set(0, 1, 0); }
      N.addScaledVector(t, -N.dot(t)).normalize();
      B.crossVectors(t, N);
      const v = i / n, r = rad(v, i), c = col(v), f = flex ? flex(v) : null, p = pts[i];
      for (let j = 0; j < nr; j++) {
        const a = TAU * j / nr, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        geo.vert(p.x + N.x * ca + B.x * sa, p.y + N.y * ca + B.y * sa, p.z + N.z * ca + B.z * sa,
          c, 0, 0, f ? f[0] : 0, f ? f[1] : 0);
      }
    }
    geo.grid(base, n, nr, true, true);
  }

  // ---------------------------------------------------------------- shaders
  // Fish body wave: lateral shear z += f(s), s = 0 at the nose and 1 at the tail base.
  // Amplitude follows the measured carangiform envelope (small at the head, quadratic to the tail).
  const SWIM_GLSL = `
    attribute vec4 aFlex;
    uniform float uPhase, uAmp, uBend, uFinT;
    float swimOff(float s) {
      float c = min(s, 1.5), b = c - 0.35;
      return uAmp * (0.02 - 0.08 * c + 0.16 * c * c) * sin(6.0 * c - uPhase) - uBend * b * b;
    }
    float swimSlope(float s) {
      float c = min(s, 1.5), a = 0.02 - 0.08 * c + 0.16 * c * c, w = 6.0 * c - uPhase;
      return uAmp * ((0.32 * c - 0.08) * sin(w) + a * 6.0 * cos(w)) - 2.0 * uBend * (c - 0.35);
    }`;
  const CAUSTIC_GLSL = `
    varying vec3 vCPos; varying float vCUp;
    uniform float uTime, uCaustic;
    // Tileable water caustics (after Dave Hoskins).
    float aqCaustic(vec2 uv, float t) {
      vec2 p = mod(uv * 6.28318530718, 6.28318530718) - 250.0, i = p;
      float c = 1.0;
      for (int n = 0; n < 5; n++) {
        float k = t * (1.0 - 3.5 / float(n + 1));
        i = p + vec2(cos(k - i.x) + sin(k + i.y), sin(k - i.y) + cos(k + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + k) / 0.005), p.y / (cos(i.y + k) / 0.005)));
      }
      c = 1.17 - pow(c / 5.0, 1.4);
      return pow(abs(c), 8.0);
    }`;

  // Injects vertex animation and caustic lighting into a built-in material.
  function patch(mat, o) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = G.uTime;
      let pars = '', nrm = '', beg = '', end = '';
      if (o.swim) {
        Object.assign(sh.uniforms, o.swim);
        pars += SWIM_GLSL;
        // exact normal for a shear: n' = (nx - f'(x) nz, ny, nz)
        nrm += 'objectNormal.x += swimSlope(0.5 - position.x) * objectNormal.z;';
        beg += 'transformed.z += swimOff(0.5 - position.x); transformed += aFlex.xyz * sin(uFinT + aFlex.w);';
      }
      if (o.sway) {
        pars += 'attribute vec4 aFlex;\nuniform float uTime;\n';
        beg += `float swP = aFlex.y + position.x * 0.45 + position.z * 0.3 - position.y * 0.55;
          transformed.x += aFlex.x * (sin(uTime * 0.9 + swP) + 0.35 * sin(uTime * 2.1 + swP * 1.7));
          transformed.z += aFlex.x * 0.6 * cos(uTime * 0.7 + swP * 0.8);`;
      }
      if (o.caustic) {
        sh.uniforms.uCaustic = { value: o.caustic };
        pars += 'varying vec3 vCPos; varying float vCUp;\n';
        end += `vec4 cW = vec4(transformed, 1.0); vec3 cN = objectNormal;
          #ifdef USE_INSTANCING
            cW = instanceMatrix * cW; cN = mat3(instanceMatrix) * cN;
          #endif
          vCPos = (modelMatrix * cW).xyz; vCUp = normalize(mat3(modelMatrix) * cN).y;`;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * uCaustic * smoothstep(-0.15, 0.6, vCUp) *
              aqCaustic(vCPos.xz * 0.19 + vCPos.y * 0.05, uTime * 0.5 + 23.0);`);
      }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + pars)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + nrm)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + beg)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + end);
    };
    mat.customProgramCacheKey = () => 'aq' + (o.swim ? 1 : 0) + (o.sway ? 1 : 0) + (o.caustic ? 1 : 0);
    return mat;
  }

  // --------------------------------------------------------------- textures
  function canvasTex(size, draw, srgb) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  // Height map of overlapping scales, free edge pointing to the tail (+u).
  const scaleTex = () => canvasTex(256, (g, S) => {
    const n = 8, cw = S / n, r = cw * 0.66;
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    for (let col = n + 1; col >= -1; col--) for (let row = -1; row <= n + 1; row++) {
      const cx = (col + 0.5) * cw, cy = (row + (col & 1 ? 0.5 : 0)) * cw;
      const gr = g.createLinearGradient(cx - r, 0, cx + r, 0);
      gr.addColorStop(0, '#4a4a4a'); gr.addColorStop(0.75, '#d0d0d0'); gr.addColorStop(1, '#ffffff');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = S / 170; g.stroke();
    }
  });
  const grainTex = () => canvasTex(256, (g, S) => {
    const im = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = 165 + rnd() * 90;
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, true);
  const backdropTex = () => canvasTex(512, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, '#58c2e8'); gr.addColorStop(0.35, '#1c7fb0'); gr.addColorStop(0.75, '#0a4369'); gr.addColorStop(1, '#05243b');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,.045)';
    for (let k = 0; k < 9; k++) {
      const x = rr(-0.1, 1) * S, w = rr(0.02, 0.07) * S, sl = rr(0.05, 0.22) * S;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + sl + w * 2.4, S); g.lineTo(x + sl - w, S); g.fill();
    }
  }, true);
  const dotTex = () => canvasTex(64, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });

  // Soft sky-like environment with a bright lamp panel: gives wet highlights on scales and glass.
  function makeEnv(renderer) {
    const s = new T.Scene(), g = new T.SphereGeometry(50, 32, 16);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    const top = hex(0xd6efff), mid = hex(0x2b5f86), bot = hex(0x06121c);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 50;
      c.set(y > 0 ? mix(mid, top, Math.pow(y, 0.6)) : mix(mid, bot, Math.pow(-y, 0.5)), i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    s.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const lamp = new T.Mesh(new T.BoxGeometry(34, 1, 14), new T.MeshBasicMaterial());
    lamp.material.color.setScalar(7); lamp.position.y = 30; s.add(lamp);
    const pm = new T.PMREMGenerator(renderer), tex = pm.fromScene(s, 0.03).texture;
    pm.dispose();
    return tex;
  }

  // ------------------------------------------------------------- fish model
  const finGrad = (a, b, a0, a1, edge) => (kind, u, v) => {
    const c = edge && v > 0.84 ? edge : mix(a, b, v);
    return [c[0], c[1], c[2], lerp(a0, a1, v)];
  };

  const ORANGE = hex(0xff6208), ROYAL = hex(0x1746ff), YELLOW = hex(0xffd21a), SILVER = hex(0xd6dde2);
  const GOLD = [hex(0xff7412), hex(0xff3d1f), hex(0xffae1c)];
  const BETTA = [
    { a: hex(0x1b2fb5), b: hex(0x7a1fa8), f0: hex(0x2a3fd0), f1: hex(0xe01538) },
    { a: hex(0x0fb5ad), b: hex(0xe8f6ff), f0: hex(0x35d6cf), f1: hex(0xe23bb3) },
  ];

  const defaults = {
    p: 0.6, q: 0.7, ped: 0.2, lens: 1.15, arch: 0, detail: 1, scales: 5, variants: 1,
    turn: 2.0, speed: 0.8, beat: 1, iris: hex(0xf2c230), eye: [0.11, 0.3, 0.03],
    pect: { s: 0.27, y: -0.25, len: 0.2 }, pelv: { s: 0.4, len: 0.14 },
  };
  const SPECIES = [
    { // clownfish: lives around the anemone
      name: 'clown', count: 3, len: 0.95, h: 0.2, w: 0.085, p: 0.62, q: 0.62, ped: 0.26, home: true,
      depth: [0.1, 0.45], speed: 0.75, turn: 2.6,
      tail: { len: 0.25, spread: 0.75, fork: -0.12 },
      dorsal: { s0: 0.24, s1: 0.88, h: 0.13, k: 1, e: 0.45, sweep: 0.5 },
      anal: { s0: 0.62, s1: 0.9, h: 0.11, k: 0.9, e: 0.5, sweep: 0.6 },
      paint: (s, yn) => {
        let c = ORANGE;
        for (const [bc, bw, bulge] of [[0.27, 0.04, 0.035], [0.57, 0.05, 0.05], [0.94, 0.03, 0]]) {
          const d = Math.abs(s - (bc - bulge * (1 - yn * yn)));
          if (d < bw) return WHITE;
          if (d < bw + 0.022) c = BLACK;
        }
        return c;
      },
      finPaint: finGrad(ORANGE, hex(0xff7a1a), 0.96, 0.9, BLACK),
    },
    { // blue tang
      name: 'bluetang', count: 2, len: 1.5, h: 0.25, w: 0.07, ped: 0.13, lens: 1.3, depth: [0.3, 0.85],
      speed: 0.85, turn: 1.7, iris: hex(0x202a44),
      tail: { len: 0.24, spread: 0.7, fork: 0.3 },
      dorsal: { s0: 0.2, s1: 0.94, h: 0.09, k: 0.8, e: 0.35, sweep: 0.7 },
      anal: { s0: 0.5, s1: 0.94, h: 0.08, k: 0.8, e: 0.35, sweep: 0.7 },
      paint: (s, yn) => {
        // soft edges: vertex colours cannot hold a hard diagonal boundary
        const hole = 1 - smooth(0.75, 1.15, Math.hypot((s - 0.52) / 0.17, (yn - 0.25) / 0.3));
        const k = smooth(0.17, 0.22, s) * smooth(0.99, 0.94, s) * smooth(-0.2, 0.02, yn) * smooth(0.95, 0.75, yn) *
          (1 - hole) * (1 - smooth(0.44, 0.36, s) * smooth(0.42, 0.2, yn));
        const wedge = smooth(0.82, 0.88, s) * smooth(0.9, 0.6, Math.abs(yn) / ((s - 0.82) / 0.18 + 1e-3));
        return mix(mix(ROYAL, BLACK, k), YELLOW, wedge);
      },
      finPaint: (kind, u, v) => kind === 'tail'
        ? [...(u < 0.14 || u > 0.86 ? BLACK : YELLOW), 0.95]
        : [...(v > 0.72 ? BLACK : kind === 'pect' ? mix(ROYAL, YELLOW, v * 1.3) : ROYAL), 0.93],
    },
    { // yellow tang
      name: 'yellowtang', count: 2, len: 1.2, h: 0.3, w: 0.06, p: 0.68, q: 0.85, ped: 0.12, lens: 1.3,
      depth: [0.25, 0.8], speed: 0.9, turn: 2.0, iris: hex(0xffe9a0),
      tail: { len: 0.22, spread: 0.6, fork: 0.15 },
      dorsal: { s0: 0.2, s1: 0.93, h: 0.17, k: 1.3, e: 0.5, sweep: 0.9 },
      anal: { s0: 0.45, s1: 0.93, h: 0.15, k: 1.3, e: 0.5, sweep: 0.9 },
      paint: (s, yn) => (Math.abs(s - 0.93) < 0.02 && Math.abs(yn) < 0.3 ? WHITE
        : mix(YELLOW, hex(0xfff06a), 0.5 * smooth(0.25, 0, Math.abs(yn + 0.1)))),
      finPaint: finGrad(YELLOW, hex(0xffe14a), 0.97, 0.9),
    },
    { // freshwater angelfish
      name: 'angel', count: 3, len: 1.25, h: 0.33, w: 0.06, p: 0.62, q: 0.8, ped: 0.12, lens: 1.3,
      depth: [0.35, 0.9], speed: 0.6, turn: 1.6, iris: hex(0xe04a2a), eye: [0.12, 0.25, 0.034],
      tail: { len: 0.34, spread: 0.55, fork: 0.1, flex: 0.16 },
      dorsal: { s0: 0.3, s1: 0.9, h: 0.6, k: 1.4, e: 1.1, sweep: 1.1, flex: 0.18 },
      anal: { s0: 0.48, s1: 0.9, h: 0.58, k: 1.4, e: 1.1, sweep: 1.2, flex: 0.18 },
      pelv: { s: 0.36, len: 0.72 },
      paint: (s, yn) => {
        let c = mix(SILVER, hex(0xd9c27a), 0.55 * smooth(0.2, 1, yn));
        for (const [bc, bw] of [[0.13, 0.022], [0.42, 0.036], [0.7, 0.04], [0.97, 0.03]]) {
          c = mix(c, BLACK, 0.92 * (1 - smooth(bw * 0.55, bw, Math.abs(s - bc))));
        }
        return c;
      },
      finPaint: (kind, u, v) => {
        let c = mix(SILVER, hex(0xf4f8ff), v);
        if (kind === 'dorsal' || kind === 'anal') c = mix(c, BLACK, 0.75 * smooth(0.3, 0.5, u) * smooth(0.95, 0.7, u));
        if (kind === 'tail') c = mix(c, BLACK, 0.45 * (0.5 + 0.5 * Math.cos(v * 22)));
        return [c[0], c[1], c[2], lerp(0.92, 0.6, v)];
      },
    },
    { // neon tetra: one tight school
      name: 'tetra', count: 26, len: 0.5, h: 0.125, w: 0.07, p: 0.58, ped: 0.22, detail: 0.6, scales: 3.5,
      school: true, depth: [0.35, 0.8], speed: 1.5, turn: 3.4, beat: 1.25, iris: hex(0xdfe8ee),
      eye: [0.1, 0.3, 0.04],
      tail: { len: 0.24, spread: 0.6, fork: 0.45 },
      dorsal: { s0: 0.42, s1: 0.6, h: 0.12, k: 0.7, e: 0.6, sweep: 0.5 },
      anal: { s0: 0.58, s1: 0.84, h: 0.09, k: 0.7, e: 0.6, sweep: 0.6 },
      paint: (s, yn) => {
        let c = mix(hex(0xe4ebef), hex(0x5d6f4c), smooth(-0.1, 0.9, yn));
        c = mix(c, hex(0xff1f1f), smooth(0.48, 0.6, s) * smooth(0.15, 0, yn) * smooth(-0.85, -0.6, yn));
        const stripe = smooth(0, 0.15, yn) * smooth(0.6, 0.45, yn) * smooth(0.05, 0.1, s) * smooth(0.82, 0.74, s);
        return mix(c, mix(hex(0x12e6ff), hex(0x2a6cff), s), stripe);
      },
      finPaint: finGrad(hex(0xdce8f0), hex(0xf4fbff), 0.4, 0.16),
    },
    { // goldfish
      name: 'gold', count: 3, variants: 3, len: 1.3, h: 0.21, w: 0.13, p: 0.56, q: 0.6, arch: -0.06,
      depth: [0.12, 0.6], speed: 0.6, turn: 1.8, eye: [0.11, 0.34, 0.032],
      tail: { len: 0.5, spread: 0.85, fork: 0.35, flex: 0.28 },
      dorsal: { s0: 0.3, s1: 0.76, h: 0.2, k: 0.8, e: 0.5, sweep: 0.6, flex: 0.18 },
      anal: { s0: 0.68, s1: 0.88, h: 0.13, k: 0.9, e: 0.5, sweep: 0.7 },
      pect: { s: 0.27, y: -0.3, len: 0.22 }, pelv: { s: 0.42, len: 0.2 },
      paint: (s, yn, side, vi) => {
        const c = mix(GOLD[vi], hex(0xffc874), 0.6 * smooth(0.1, -0.9, yn));
        return vi === 1 ? mix(c, WHITE, smooth(0.5, 0.58, fbm(s * 4.5, yn * 2 + 7, side * 1.5, 3))) : c;
      },
      finPaint: (kind, u, v, vi) => { const c = mix(GOLD[vi], hex(0xffe9c8), v * 0.8); return [c[0], c[1], c[2], lerp(0.92, 0.5, v)]; },
    },
    { // betta: long flowing fins
      name: 'betta', count: 2, variants: 2, len: 1.1, h: 0.15, w: 0.075, q: 0.68, ped: 0.32,
      depth: [0.5, 0.92], speed: 0.5, turn: 1.9, iris: hex(0x1a1a22),
      tail: { len: 0.62, spread: 1.15, fork: -0.05, flex: 0.34 },
      dorsal: { s0: 0.5, s1: 0.94, h: 0.36, k: 1.2, e: 0.7, sweep: 1.0, flex: 0.3 },
      anal: { s0: 0.4, s1: 0.97, h: 0.34, k: 1.3, e: 0.6, sweep: 1.0, flex: 0.3 },
      pelv: { s: 0.34, len: 0.4 },
      paint: (s, yn, side, vi) => mix(BETTA[vi].a, BETTA[vi].b, smooth(0.25, 1, s)),
      finPaint: (kind, u, v, vi) => { const c = mix(BETTA[vi].f0, BETTA[vi].f1, Math.pow(v, 0.8)); return [c[0], c[1], c[2], lerp(0.95, 0.72, v)]; },
    },
  ].map((o) => Object.assign({}, defaults, o));

  // Flat fin patch: u runs along the root, v from root to tip. aFlex stores the
  // flutter direction scaled by the distance from the root, plus a phase lag.
  function finPatch(geo, nu, nv, root, dir, len, nrm, paint, amp, lag, phase) {
    const base = geo.count;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, r = root(u), d = dir(u), L = len(u);
      for (let j = 0; j <= nv; j++) {
        const v = j / nv, k = v * L, f = k * amp;
        geo.vert(r[0] + d[0] * k, r[1] + d[1] * k, r[2] + d[2] * k, paint(u, v), 0, 0,
          nrm[0] * f, nrm[1] * f, nrm[2] * f, phase - k * lag + u * 1.5);
      }
    }
    geo.grid(base, nu, nv, false, false);
  }

  function buildFishGeo(sp, vi) {
    const d = sp.detail, fd = Math.max(0.5, d);
    const nS = Math.round(72 * d), nR = Math.round(40 * d);
    const B = new Geo(), F = new Geo();
    const H = (s) => sp.h * (Math.pow(sinp(Math.pow(s, sp.p)), sp.q) + sp.ped * smooth(0.55, 1, s));
    const W = (s) => sp.w * Math.pow(sinp(Math.pow(s, 0.55)), 0.75) + 0.006 * smooth(0.5, 1, s);
    const Y = (s) => sp.arch * sp.h * sinp(s);
    const tilesV = Math.max(1, Math.round(Math.PI * (sp.h + sp.w) * sp.scales));
    const ringS = (i) => Math.pow(i / nS, 1.3); // denser rings on the blunt head
    let gill = 0;
    for (let i = 0; i <= nS; i++) if (Math.abs(ringS(i) - 0.21) < Math.abs(ringS(gill) - 0.21)) gill = i;

    // body: rings lofted nose -> tail, seam along the belly
    for (let i = 0; i <= nS; i++) {
      const s = ringS(i), h = H(s), w = W(s), yc = Y(s);
      for (let j = 0; j <= nR; j++) {
        const th = -Math.PI / 2 + TAU * j / nR, sn = Math.sin(th), cs = Math.cos(th);
        const z = w * Math.sign(cs) * Math.pow(Math.abs(cs), sp.lens);
        let c = sp.paint(s, sn, cs >= 0 ? 1 : -1, vi);
        c = mul(c, 1 - 0.32 * smooth(0.2, 1, sn));                 // darker back
        c = mix(c, WHITE, 0.3 * smooth(-0.35, -1, sn));            // paler belly
        if (i === gill && Math.abs(sn) < 0.8) c = mul(c, 0.7);     // gill cover
        if (s < 0.012) c = mul(c, 0.6);                            // mouth
        B.vert(0.5 - s, yc + h * sn, z, c, s * sp.scales, (j / nR) * tilesV);
      }
    }
    B.grid(0, nS, nR, true, false);

    // eyes: sphere with its pole pointing outwards so pupil and iris are clean rings
    for (const side of [1, -1]) {
      const [es, ey, er] = sp.eye;
      const cz = side * (W(es) * Math.pow(1 - ey * ey, sp.lens / 2) - er * 0.5), cy = Y(es) + H(es) * ey;
      const base = B.count, nl = 10, nm = 16;
      for (let i = 0; i <= nl; i++) {
        const ph = (i / nl) * Math.PI, c = ph < 0.62 ? BLACK : ph < 1.15 ? sp.iris : mul(sp.iris, 0.3);
        for (let j = 0; j < nm; j++) {
          const la = TAU * j / nm, sr = Math.sin(ph) * er;
          B.vert(0.5 - es + sr * Math.cos(la), cy + sr * Math.sin(la), cz + side * Math.cos(ph) * er, c);
        }
      }
      B.grid(base, nl, nm, side < 0, true);
    }

    const rays = (kind, n) => (u, v) => {
      const c = sp.finPaint(kind, u, v, vi), k = 0.84 + 0.16 * Math.cos(u * n * TAU);
      return [c[0] * k, c[1] * k, c[2] * k, c[3]];
    };
    const Z = [0, 0, 1];

    // caudal fin: rays fan out from the peduncle
    const t = sp.tail, hp = H(1) * 0.92;
    finPatch(F, Math.round(40 * fd), Math.round(10 * fd),
      (u) => [-0.49, Y(1) + (u * 2 - 1) * hp, 0],
      (u) => { const a = (u * 2 - 1) * t.spread; return [-Math.cos(a), Math.sin(a), 0]; },
      (u) => t.len * (1 - t.fork * Math.pow(sinp(u), 1.5)) * (0.72 + 0.28 * Math.pow(sinp(u), 0.35)),
      Z, rays('tail', 14), t.flex || 0.1, 5, 0);

    // dorsal and anal fins along the back and belly
    const edge = (kind, f, sign, nu) => finPatch(F, Math.round(nu * fd), Math.round(6 * fd),
      (u) => { const s = lerp(f.s0, f.s1, u); return [0.5 - s, Y(s) + sign * H(s) * 0.93, 0]; },
      (u) => { const sw = f.sweep * (0.6 + 0.8 * u), l = Math.hypot(sw, 1); return [-sw / l, sign / l, 0]; },
      (u) => f.h * Math.pow(sinp(Math.pow(u, f.k)), f.e),
      Z, rays(kind, 11), f.flex || 0.12, 6, sign > 0 ? 1 : 2.5);
    edge('dorsal', sp.dorsal, 1, 30);
    edge('anal', sp.anal, -1, 24);

    for (const side of [1, -1]) {
      // pectoral fins: fan in a plane that points back, out and down
      const pf = sp.pect, e2 = [0, -0.75, side * 0.66];
      const py = Y(pf.s) + H(pf.s) * pf.y, pz = side * W(pf.s) * Math.pow(1 - pf.y * pf.y, sp.lens / 2) * 0.97;
      finPatch(F, Math.round(14 * fd), Math.round(6 * fd),
        (u) => [0.5 - pf.s, py + (u - 0.5) * pf.len * 0.25, pz],
        (u) => { const a = lerp(0.15, 1.15, u); return [-Math.cos(a), e2[1] * Math.sin(a), e2[2] * Math.sin(a)]; },
        (u) => pf.len * Math.pow(sinp(0.12 + 0.76 * u), 0.6),
        [0, 0.66, side * 0.75], rays('pect', 7), 0.4, 2.5, side > 0 ? 0 : 0.5);
      // pelvic fins
      const vf = sp.pelv, vy = Y(vf.s) - H(vf.s) * 0.9, vz = side * W(vf.s) * 0.35;
      finPatch(F, Math.round(8 * fd), Math.round(6 * fd),
        (u) => [0.5 - vf.s - u * vf.len * 0.2, vy, vz],
        (u) => { const a = lerp(1.25, 0.55, u), l = Math.hypot(1, 0.25); return [-Math.cos(a) / l, -Math.sin(a) / l, side * 0.25 / l]; },
        (u) => vf.len * Math.pow(sinp(0.1 + 0.8 * u), 0.7),
        Z, rays('pelv', 4), 0.15, 4, 3 + side);
    }

    const body = B.build(), fins = F.build();
    // weld the normals across the belly seam
    const n = body.attributes.normal, wv = nR + 1;
    for (let i = 0; i <= nS; i++) {
      const a = i * wv, b = a + nR;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
    return { body, fins };
  }

  // ---------------------------------------------------------- fish behaviour
  const fishes = [], obstacles = [], home = new T.Vector3();
  const _d = new T.Vector3(), _t = new T.Vector3(), _g = new T.Vector3();
  const wall = (x, lo, hi, m) => (x < lo + m ? ((lo + m - x) / m) ** 2 : x > hi - m ? -(((x - hi + m) / m) ** 2) : 0);

  class School {
    constructor(depth) { this.depth = depth; this.target = new T.Vector3(); this.centre = new T.Vector3(); this.timer = 0; this.members = []; }
    update(dt) {
      this.centre.set(0, 0, 0);
      for (const m of this.members) this.centre.add(m.pos);
      this.centre.multiplyScalar(1 / this.members.length);
      this.timer -= dt;
      if (this.timer <= 0 || this.centre.distanceToSquared(this.target) < 1.5) {
        this.target.set(rand(-5.3, 5.3), lerp(0.8, WY, rand(this.depth[0], this.depth[1])), rand(-1.5, 2.1));
        this.timer = rand(7, 14);
      }
    }
  }

  class Fish {
    constructor(sp, geo, mats, school) {
      this.sp = sp; this.school = school;
      this.len = sp.len * rand(0.86, 1.12);
      this.uni = { uPhase: { value: rand(0, TAU) }, uAmp: { value: 0.6 }, uBend: { value: 0 }, uFinT: { value: rand(0, TAU) } };
      const depth = patch(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), { swim: this.uni });
      this.mesh = new T.Mesh(geo.body, mats.body(this.uni));
      const fins = new T.Mesh(geo.fins, mats.fins(this.uni));
      for (const m of [this.mesh, fins]) { m.castShadow = true; m.customDepthMaterial = depth; }
      this.mesh.add(fins);
      this.mesh.scale.setScalar(this.len);
      this.pos = this.mesh.position;
      this.bx = TW / 2 - 0.35 - 0.4 * this.len;
      this.bz = TD / 2 - 0.35 - 0.3 * this.len;
      this.top = WY - 0.25 - sp.h * this.len;
      this.target = new T.Vector3();
      this.offset = new T.Vector3(rand(-1.5, 1.5), rand(-0.7, 0.7), rand(-0.9, 0.9));
      this.pickTarget();
      this.pos.copy(school ? this.offset : this.target);
      if (school) this.pos.y += 4;
      this.pickTarget();
      this.yaw = rand(0, TAU); this.pitch = 0; this.w = 0;
      this.v = 0; this.gait = 1; this.gaitT = 0; this.fx = 1; this.fz = 0;
      if (school) school.members.push(this);
    }

    pickTarget() {
      const sp = this.sp, t = this.target;
      for (let tries = 0; tries < 6; tries++) {
        if (sp.home && Math.random() < 0.8) t.set(home.x + rand(-2.3, 2.3), home.y + rand(0.5, 2.4), home.z + rand(-1.5, 1.5));
        else t.set(rand(-this.bx, this.bx), lerp(0.6, WY, rand(sp.depth[0], sp.depth[1])), rand(-this.bz, this.bz));
        t.x = clamp(t.x, -this.bx, this.bx); t.z = clamp(t.z, -this.bz, this.bz);
        t.y = clamp(t.y, sandH(t.x, t.z) + 0.3 + 0.45 * this.len, this.top);
        if (!obstacles.some((o) => o.c.distanceTo(t) < o.r + 0.5 * this.len)) break;
      }
      this.timer = rand(4, 11);
    }

    update(dt) {
      const sp = this.sp, P = this.pos, u = this.uni;
      let tgt = this.target;
      this.timer -= dt;
      if (this.school) {
        tgt = _g.copy(this.school.target).add(this.offset);
        tgt.x = clamp(tgt.x, -this.bx, this.bx); tgt.z = clamp(tgt.z, -this.bz, this.bz);
        if (this.timer <= 0) { this.offset.set(rand(-1.5, 1.5), rand(-0.7, 0.7), rand(-0.9, 0.9)); this.timer = rand(3, 8); }
      } else if (this.timer <= 0 || P.distanceToSquared(tgt) < (0.8 * this.len) ** 2) this.pickTarget();

      // steering: seek the target, keep clear of neighbours, rocks and glass
      const des = _d.subVectors(tgt, P), dist = des.length();
      des.multiplyScalar(1 / (dist + 1e-6));
      for (const o of fishes) {
        if (o === this) continue;
        const d2 = _t.subVectors(P, o.pos).lengthSq(), rad = (this.len + o.len) * 0.75;
        if (d2 < rad * rad && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          des.addScaledVector(_t, (1 - d / rad) * (o.len > this.len * 1.3 ? 4.5 : 2.6) / d);
        }
        if (this.school && o.school === this.school && d2 < 3) { des.x += o.fx * 0.14; des.z += o.fz * 0.14; }
      }
      for (const ob of obstacles) {
        const d = _t.subVectors(P, ob.c).length(), rad = ob.r + 0.6 * this.len;
        if (d < rad) des.addScaledVector(_t, (1 - d / rad) * 4 / (d + 1e-6));
      }
      const m = 0.9 + 0.5 * this.len, lo = sandH(P.x, P.z) + 0.25 + 0.4 * this.len;
      des.x += 3 * wall(P.x, -this.bx, this.bx, m);
      des.z += 3 * wall(P.z, -this.bz, this.bz, m);
      des.y += 3 * wall(P.y, lo, this.top, 0.6 * m);
      des.normalize();

      // fish cannot strafe: turn rate is limited and the body bends into the turn
      const pitchD = clamp(Math.asin(clamp(des.y, -1, 1)) * 0.85, -0.55, 0.55);
      let dy = Math.atan2(-des.z, des.x) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.w += (clamp(dy * 2.2, -sp.turn, sp.turn) - this.w) * Math.min(1, dt * 4);
      this.yaw += this.w * dt;
      this.pitch += (pitchD - this.pitch) * Math.min(1, dt * 1.8);

      // burst-and-coast gait: quick acceleration, slow glide
      this.gaitT -= dt;
      if (this.gaitT <= 0) {
        const burst = Math.random() < 0.12;
        this.gait = burst ? rand(1.7, 2.3) : rand(0.35, 1.15);
        this.gaitT = burst ? rand(0.5, 1) : rand(1.5, 5);
      }
      const cruise = sp.speed * this.len;
      let vD = cruise * this.gait * (1 - 0.5 * Math.min(1, Math.abs(dy) / 1.5));
      if (this.school) vD *= 0.3 + 0.7 * smooth(0, 1.2, dist);
      this.v += (vD - this.v) * Math.min(1, dt * (vD > this.v ? 2.5 : 0.8));

      const cp = Math.cos(this.pitch);
      this.fx = Math.cos(this.yaw) * cp; this.fz = -Math.sin(this.yaw) * cp;
      P.x = clamp(P.x + this.fx * this.v * dt, -this.bx - 0.2, this.bx + 0.2);
      P.z = clamp(P.z + this.fz * this.v * dt, -this.bz - 0.2, this.bz + 0.2);
      P.y = clamp(P.y + Math.sin(this.pitch) * this.v * dt, lo - 0.2, this.top + 0.1);

      // tail beat: frequency tracks speed in body lengths, amplitude tracks effort
      const rel = this.v / this.len, effort = (vD - this.v) / cruise;
      const amp = clamp(0.35 + 0.45 * rel / sp.speed + 0.8 * Math.max(0, effort) + 0.25 * Math.min(0, effort), 0.15, 1.5);
      u.uAmp.value += (amp - u.uAmp.value) * Math.min(1, dt * 3);
      u.uPhase.value = (u.uPhase.value + dt * TAU * (0.7 + 1.5 * rel) * sp.beat) % TAU;
      u.uFinT.value = (u.uFinT.value + dt * (3 + 2.5 * rel)) % TAU;
      u.uBend.value = this.w * 0.11;
      this.mesh.rotation.set(-this.w * 0.1, this.yaw, this.pitch, 'YZX');
    }
  }

  // ---------------------------------------------------------------- scenery
  function buildTank(scene) {
    const glass = new T.MeshPhysicalMaterial({ color: 0xd4f1ff, roughness: 0.03, metalness: 0, transparent: true,
      opacity: 0.1, depthWrite: false, fog: false, envMap: G.env, envMapIntensity: 2.5 });
    const trim = new T.MeshStandardMaterial({ color: 0x0c0f13, roughness: 0.45, metalness: 0.3, fog: false });
    const wood = new T.MeshStandardMaterial({ color: 0x2a1d15, roughness: 0.55, metalness: 0.05, fog: false });
    const box = (w, h, d, x, y, z, m) => {
      const o = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z); scene.add(o); return o;
    };
    const ow = TW + 2 * GT + 0.16, od = TD + 2 * GT + 0.16, sx = TW / 2 + GT / 2, sz = TD / 2 + GT / 2;
    box(TW + 2 * GT, TH, GT, 0, TH / 2, sz, glass);
    box(GT, TH, TD, -sx, TH / 2, 0, glass);
    box(GT, TH, TD, sx, TH / 2, 0, glass);
    box(TW + 2 * GT, TH, GT, 0, TH / 2, -sz, trim);
    // Backdrop on the back and both side walls. The side panels face inwards only, so the
    // tank stays see-through from whichever side the camera is on.
    const drop = new T.MeshBasicMaterial({ map: backdropTex(), fog: false });
    const back = new T.Mesh(new T.PlaneGeometry(TW, TH), drop);
    back.position.set(0, TH / 2, -TD / 2 + 0.01); scene.add(back);
    for (const s of [1, -1]) {
      const side = new T.Mesh(new T.PlaneGeometry(TD, TH), drop);
      side.position.set(s * (TW / 2 - 0.01), TH / 2, 0); side.rotation.y = -s * Math.PI / 2; scene.add(side);
    }

    box(ow, 0.34, od, 0, -0.17, 0, trim);
    for (const s of [1, -1]) {
      box(ow, 0.28, 0.22, 0, TH + 0.02, s * sz, trim);
      box(0.22, 0.28, od, s * sx, TH + 0.02, 0, trim);
      box(0.12, 1.1, 0.5, s * (TW / 2 - 0.3), TH + 0.6, 0, trim);
    }
    box(TW - 1, 0.22, 2.2, 0, TH + 1.15, 0, trim);
    const led = box(TW - 1.6, 0.04, 1.5, 0, TH + 1.03, 0, new T.MeshBasicMaterial({ fog: false }));
    led.material.color.setScalar(4);

    box(ow + 0.5, 5, od + 0.5, 0, -2.84, 0, wood);
    const floor = new T.Mesh(new T.PlaneGeometry(160, 160), new T.MeshLambertMaterial({ color: 0x262a30, fog: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -5.34; scene.add(floor);
  }

  function buildSand(scene, content) {
    const g = new Geo(), nx = 140, nz = 70;
    const a = hex(0xd8bf8e), b = hex(0xae8c5a);
    const X = (i) => -TW / 2 + TW * i / nx, Zc = (j) => -TD / 2 + TD * j / nz;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = X(i), z = Zc(j);
      // kept fairly dark: pale sand clips under the lamp and hides caustics and shadows
      g.vert(x, sandH(x, z), z, mul(mix(a, b, fbm(x * 1.4, 3, z * 1.4, 3)), 0.55 + 0.14 * noise3(x * 7, 0, z * 7)), x * 0.5, z * 0.5);
    }
    g.grid(0, nx, nz, true, false);
    // side walls of the sand bed, visible through the glass
    const skirt = (n, at, flip) => {
      const base = g.count;
      for (let i = 0; i <= n; i++) for (let k = 0; k < 2; k++) {
        const [x, z] = at(i), y = k ? 0 : sandH(x, z);
        g.vert(x, y, z, mul(b, k ? 0.6 : 0.9), (x + z) * 0.5, y * 0.5);
      }
      g.grid(base, n, 1, flip, false);
    };
    skirt(nx, (i) => [X(i), TD / 2], true);
    skirt(nz, (j) => [-TW / 2, Zc(j)], true);
    skirt(nz, (j) => [TW / 2, Zc(j)], false);

    const grain = grainTex();
    const sand = new T.Mesh(g.build(), patch(new T.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain,
      bumpScale: 1.2, roughness: 0.95, metalness: 0 }), { caustic: 1.7 }));
    sand.receiveShadow = true; scene.add(sand); content.push(sand);

    const N = 150, peb = new T.InstancedMesh(new T.IcosahedronGeometry(1, 2),
      patch(new T.MeshStandardMaterial({ roughness: 0.6 }), { caustic: 0.8 }), N);
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), p = new T.Vector3(), col = new T.Color();
    for (let i = 0; i < N; i++) {
      const x = rr(-6.8, 6.8), z = rr(-3.2, 3.4), r = rr(0.04, 0.13);
      m.compose(p.set(x, sandH(x, z) + r * 0.2, z), q.setFromEuler(e.set(rr(-0.3, 0.3), rr(0, TAU), rr(-0.3, 0.3))), s.set(r, r * 0.55, r * rr(0.6, 1)));
      peb.setMatrixAt(i, m);
      peb.setColorAt(i, col.setHSL(rr(0.04, 0.12), rr(0.05, 0.3), rr(0.25, 0.7)));
    }
    peb.castShadow = peb.receiveShadow = true; scene.add(peb); content.push(peb);
  }

  function buildRocks(scene, content) {
    const mat = patch(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), { caustic: 1.2 });
    const g1 = hex(0x565049), g2 = hex(0x9c9080), moss = hex(0x47683a), pink = hex(0x9a5676);
    const spots = [[-4.4, -1.7, 1.5, 0.8], [-2.9, -2.3, 1.0, 0.9], [4.4, -1.9, 1.7, 0.75], [3.0, -1.0, 0.8, 0.7],
      [0.3, -2.4, 1.1, 0.85], [-5.9, 2.3, 0.45, 0.6], [5.9, 2.4, 0.4, 0.6], [1.6, 2.0, 0.35, 0.55]];
    for (const [x, z, r, sy] of spots) {
      let g = new T.IcosahedronGeometry(1, Math.round(10 + r * 9));
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = T.mergeVertices(g, 1e-4);
      const p = g.attributes.position, col = new Float32Array(p.count * 3), o = rr(0, 50);
      for (let i = 0; i < p.count; i++) {
        const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
        const n = fbm(nx * 1.3 + o, ny * 1.3, nz * 1.3, 4), n2 = fbm(nx * 4 + o, ny * 4, nz * 4 + 7, 3);
        const d = (0.7 + 0.62 * n + 0.14 * (n2 - 0.5)) * r;
        p.setXYZ(i, nx * d, ny * d * sy, nz * d);
        let c = mul(mix(g1, g2, n2), 0.4 + 0.65 * n);
        c = mix(c, moss, 0.75 * smooth(0.15, 0.8, ny) * smooth(0.35, 0.65, fbm(nx * 2 + o, ny * 2, nz * 2 + 20, 3)));
        c = mix(c, pink, 0.5 * smooth(0.56, 0.68, fbm(nx * 2.6 + o, ny * 2.6 + 40, nz * 2.6, 3)));
        col.set(c, i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const rock = new T.Mesh(g, mat), y = sandH(x, z) + r * sy * 0.3;
      rock.position.set(x, y, z); rock.rotation.y = rr(0, TAU);
      rock.castShadow = rock.receiveShadow = true; scene.add(rock); content.push(rock);
      obstacles.push({ c: new T.Vector3(x, y, z), r: r * 0.95 });
    }
  }

  function buildFlora(scene, content) {
    const P = new Geo(), C = new Geo(); // P: leaves (double sided), C: corals and anemone (tubes)
    const greens = [hex(0x0e4720), hex(0x1f6b2c), hex(0x4fb04a), hex(0x8ccf52)];

    // ribbon blade with a raised midrib; sways more towards the tip
    const blade = (x, z, h, w, lean, dir, twist, c0, c1) => {
      const y0 = sandH(x, z) - 0.05, n = Math.max(6, Math.round(h * 5)), base = P.count, ph = rr(0, TAU);
      h = Math.min(h, WY - 0.12 - y0);
      for (let i = 0; i <= n; i++) {
        const v = i / n, bend = lean * v * v * h, wig = Math.sin(v * 4 + ph) * 0.035 * h * v;
        const cx = x + Math.cos(dir) * bend + wig, cz = z + Math.sin(dir) * bend, cy = y0 + v * h * (1 - 0.12 * lean * v);
        const a = dir + Math.PI / 2 + twist * v, ww = w * Math.sqrt(1 - v * v * v), c = mix(c0, c1, v);
        const sw = Math.pow(v, 1.7) * h * 0.05;
        for (let k = -1; k <= 1; k++) {
          P.vert(cx + Math.cos(a) * ww * k - Math.sin(a) * (k ? 0 : ww * 0.3), cy, cz + Math.sin(a) * ww * k + Math.cos(a) * (k ? 0 : ww * 0.3),
            k ? c : mul(c, 1.25), 0, 0, sw, ph);
        }
      }
      P.grid(base, n, 2, false, false);
    };
    for (const [x, z, h] of [[-6.3, -2.9, 5.8], [-5.2, -3.0, 6.6], [-3.6, -3.1, 5.0], [-1.4, -3.0, 6.2], [0.2, -3.1, 4.4],
      [2.3, -3.0, 6.5], [3.9, -3.1, 5.2], [5.6, -2.9, 6.4], [6.4, -1.6, 4.6], [-6.5, -1.2, 4.0], [6.5, 0.4, 3.0]]) {
      for (let k = 0, n = 9 + Math.floor(rnd() * 6); k < n; k++) {
        blade(x + rr(-0.4, 0.4), z + rr(-0.25, 0.25), h * rr(0.55, 1.05), rr(0.06, 0.1), rr(0.02, 0.12), rr(0, TAU), rr(-1.5, 1.5),
          mix(greens[0], greens[1], rnd()), mix(greens[2], greens[3], rnd()));
      }
    }
    for (let i = 0; i < 80; i++) { // low carpet tufts
      const x = rr(-6.7, 6.7), z = rr(-1.6, 3.3);
      if (obstacles.some((o) => Math.hypot(o.c.x - x, o.c.z - z) < o.r)) continue;
      for (let k = 0; k < 5; k++) blade(x + rr(-0.08, 0.08), z + rr(-0.08, 0.08), rr(0.22, 0.6), rr(0.02, 0.035), rr(0.2, 0.6), rr(0, TAU), 0, greens[1], greens[3]);
    }

    // broad leaf on a stalk, arching outwards
    const leaf = (x, z, dir, len, wid, droop, c0, c1) => {
      const n = 14, base = P.count, ph = rr(0, TAU), ca = Math.cos(dir), sa = Math.sin(dir);
      let px = 0, py = sandH(x, z) - 0.05;
      for (let i = 0; i <= n; i++) {
        const v = i / n, phi = droop * v * (0.4 + 0.6 * v), t = (v - 0.22) / 0.78;
        const wv = wid * (t < 0 ? 0.07 : 0.07 * (1 - t) + Math.pow(sinp(Math.pow(t, 0.7)), 0.8));
        const c = mix(c0, c1, v), sw = v * v * len * 0.035;
        for (let k = -2; k <= 2; k++) {
          const off = wv * k / 2, cup = Math.abs(off) * 0.3; // edges curl up along the leaf normal
          P.vert(x + ca * px - sa * off - Math.cos(phi) * ca * cup, py + Math.sin(phi) * cup, z + sa * px + ca * off - Math.cos(phi) * sa * cup,
            k ? c : mul(c, 1.3), 0, 0, sw, ph);
        }
        px += Math.sin(phi) * len / n; py += Math.cos(phi) * len / n;
      }
      P.grid(base, n, 4, false, false);
    };
    const reds = [hex(0x5a1420), hex(0xc23a3a)];
    for (const [x, z, red] of [[-3.3, 0.3, 0], [2.7, 0.9, 0], [5.0, -0.3, 1], [-0.6, -1.4, 0]]) {
      for (let k = 0, n = 11 + Math.floor(rnd() * 4); k < n; k++) {
        leaf(x + rr(-0.06, 0.06), z + rr(-0.06, 0.06), TAU * k / n + rr(-0.3, 0.3), rr(1.2, 2.3), rr(0.26, 0.42), rr(0.5, 1.5),
          red ? reds[0] : mix(greens[0], greens[1], rnd()), red ? mix(reds[1], greens[3], rnd() * 0.35) : mix(greens[2], greens[3], rnd()));
      }
      obstacles.push({ c: new T.Vector3(x, sandH(x, z) + 0.5, z), r: 0.5 });
    }

    // branching coral
    const coral = (x, z, scale, c0, c1) => {
      const grow = (p, dir, len, rad, depth) => {
        const pts = [p.clone()], q = p.clone(), d = dir.clone();
        for (let k = 0; k < 5; k++) {
          d.x += rr(-0.2, 0.2); d.z += rr(-0.2, 0.2); d.y += 0.07; d.normalize();
          q.addScaledVector(d, len / 5); pts.push(q.clone());
        }
        const end = depth ? rad * 0.7 : rad * 0.45;
        if (!depth) pts.push(q.clone().addScaledVector(d, rad * 0.5)); // rounded tip
        const last = pts.length - 1, tint = 1 - depth / 4;
        tube(C, pts, (v, i) => (!depth && i === last ? 0 : lerp(rad, end, Math.min(1, i / 5))), 8,
          (v) => mix(c0, c1, clamp(tint * 0.8 + v * 0.25, 0, 1)));
        for (let k = 0, n = depth ? (depth > 2 ? 3 : 2 + (rnd() < 0.45 ? 1 : 0)) : 0; k < n; k++) {
          const nd = d.clone().add(new T.Vector3(rr(-1, 1), rr(-0.1, 0.7), rr(-1, 1)).multiplyScalar(0.75)).normalize();
          grow(q, nd, len * rr(0.62, 0.84), end, depth - 1);
        }
      };
      const y = sandH(x, z) - 0.1;
      grow(new T.Vector3(x, y, z), new T.Vector3(0, 1, 0), 0.75 * scale, 0.13 * scale, 4);
      obstacles.push({ c: new T.Vector3(x, y + 0.9 * scale, z), r: 0.95 * scale });
    };
    coral(-5.6, 0.9, 1.0, hex(0xc02a5c), hex(0xffb3c9));
    coral(1.4, -1.2, 1.2, hex(0xd9541a), hex(0xffd08a));
    coral(5.7, 0.9, 0.9, hex(0x5b3bc4), hex(0xcdb8ff));

    // anemone: stubby column plus a crown of swaying bubble-tip tentacles
    const ax = -1.3, az = 1.4, ay = sandH(ax, az) - 0.05;
    const colR = [0.42, 0.45, 0.5, 0.5, 0.38, 0], colY = [0, 0.15, 0.3, 0.42, 0.5, 0.53];
    tube(C, colY.map((y) => new T.Vector3(ax, ay + y, az)), (v, i) => colR[i], 20, (v) => mix(hex(0x8a4a3a), hex(0xd89a78), v));
    const t0 = hex(0xe8c9a0), t1 = hex(0xff4fa3);
    for (let i = 0; i < 120; i++) {
      const r0 = Math.sqrt(rnd()) * 0.46, a = rr(0, TAU), ph = rr(0, TAU), len = rr(0.6, 1.15);
      const q = new T.Vector3(ax + Math.cos(a) * r0, ay + 0.47, az + Math.sin(a) * r0), pts = [q.clone()];
      const d = new T.Vector3(Math.cos(a) * r0 * 2.2, 1, Math.sin(a) * r0 * 2.2).normalize();
      for (let k = 0; k < 8; k++) {
        d.x += Math.cos(a) * 0.09 * r0 * 2; d.z += Math.sin(a) * 0.09 * r0 * 2; d.y -= 0.05; d.normalize();
        q.addScaledVector(d, len / 8); pts.push(q.clone());
      }
      tube(C, pts, (v) => (v < 0.75 ? lerp(0.042, 0.028, v / 0.75) : v < 1 ? 0.028 + 0.03 * Math.sin((v - 0.75) * 4 * Math.PI * 0.8) : 0.012), 7,
        (v) => mix(t0, t1, smooth(0.55, 1, v)), (v) => [Math.pow(v, 1.5) * len * 0.11, ph]);
    }
    home.set(ax, ay + 0.6, az);
    obstacles.push({ c: new T.Vector3(ax, ay + 0.2, az), r: 0.55 });

    const depth = () => patch(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), { sway: true });
    const add = (geo, side) => {
      const m = new T.Mesh(geo.build(), patch(new T.MeshStandardMaterial({ vertexColors: true, side, roughness: 0.6, metalness: 0 }),
        { sway: true, caustic: 0.45 }));
      m.customDepthMaterial = depth(); m.castShadow = m.receiveShadow = true;
      scene.add(m); content.push(m);
    };
    add(P, T.DoubleSide); add(C, T.FrontSide);
  }

  function buildWater(scene) {
    // surface: waves are recomputed on the CPU every frame (small grid)
    const sg = new T.PlaneGeometry(TW, TD, 70, 35); sg.rotateX(-Math.PI / 2);
    const surface = new T.Mesh(sg, new T.MeshPhysicalMaterial({ color: 0x8fd4ff, roughness: 0.06, metalness: 0, transparent: true,
      opacity: 0.5, side: T.DoubleSide, depthWrite: false, fog: false, envMap: G.env, envMapIntensity: 1.6 }));
    surface.position.y = WY; scene.add(surface);
    const sp = sg.attributes.position;

    // light shafts: additive quads hanging from the surface
    const rp = [], ruv = [], rs = [], ri = [];
    for (let k = 0; k < 9; k++) {
      const x = rr(-6, 5), z = rr(-2.8, 2.6), w = rr(0.5, 1.3), sl = rr(0.8, 2.2), b = rp.length / 3;
      rp.push(x - w / 2, WY, z, x + w / 2, WY, z, x + sl + w, 0.4, z, x + sl - w, 0.4, z);
      ruv.push(0, 1, 1, 1, 1, 0, 0, 0); rs.push(k, k, k, k); ri.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const rg = new T.BufferGeometry();
    rg.setAttribute('position', new T.Float32BufferAttribute(rp, 3));
    rg.setAttribute('uv', new T.Float32BufferAttribute(ruv, 2));
    rg.setAttribute('aSeed', new T.Float32BufferAttribute(rs, 1));
    rg.setIndex(ri);
    scene.add(new T.Mesh(rg, new T.ShaderMaterial({
      uniforms: { uTime: G.uTime }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      vertexShader: `attribute float aSeed; uniform float uTime; varying vec2 vUv; varying float vSeed;
        void main() { vUv = uv; vSeed = aSeed; vec3 p = position;
          p.x += sin(uTime * 0.25 + aSeed * 7.0) * 0.4 * (1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vSeed;
        void main() { float a = pow(sin(vUv.x * 3.14159), 2.0) * pow(vUv.y, 1.3) * (0.55 + 0.45 * sin(uTime * 0.7 + vSeed * 13.0));
          gl_FragColor = vec4(vec3(0.75, 0.93, 1.0) * a * 0.13, 1.0); }`,
    })));

    // bubbles: two aerator streams plus stray singles
    const NB = 150, bub = new T.InstancedMesh(new T.IcosahedronGeometry(1, 3), new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main() { vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV;
        void main() { vec3 n = normalize(vN);
          float f = pow(1.0 - abs(dot(n, normalize(vV))), 2.2);
          float s = pow(max(dot(n, normalize(vec3(0.3, 0.9, 0.4))), 0.0), 40.0);
          gl_FragColor = vec4(mix(vec3(0.55, 0.8, 0.95), vec3(1.0), f) + s, f * 0.85 + 0.08 + s);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }), NB);
    bub.frustumCulled = false; scene.add(bub);
    const src = [[3.7, 1.4], [-3.4, -0.4]], bs = [];
    const spawn = (b, warm) => {
      const s = rnd() < 0.82 ? src[rnd() < 0.5 ? 0 : 1] : [rr(-6.5, 6.5), rr(-3, 3)];
      b.x = s[0] + rr(-0.12, 0.12); b.z = s[1] + rr(-0.12, 0.12);
      b.y = warm ? rr(0, WY) : sandH(b.x, b.z) - rr(0, 1.5);
      b.v = rr(0.9, 1.9); b.r = rr(0.022, 0.07); b.ph = rr(0, TAU);
    };
    for (let i = 0; i < NB; i++) { const b = {}; spawn(b, true); bs.push(b); }

    // suspended particles
    const ND = 600, dp = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) dp.set([rr(-6.9, 6.9), rr(0.5, WY), rr(-3.4, 3.4)], i * 3);
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(dp, 3));
    scene.add(new T.Points(dg, new T.PointsMaterial({ size: 0.055, map: dotTex(), color: 0xd9f2ff, transparent: true,
      opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending })));

    const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
    return (dt, t) => {
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i), z = sp.getZ(i);
        sp.setY(i, 0.035 * Math.sin(x * 1.3 + t * 1.4) + 0.025 * Math.sin(z * 2.1 - t * 1.1 + x * 0.5) + 0.015 * Math.sin((x + z) * 3.3 + t * 2.3));
      }
      sp.needsUpdate = true; sg.computeVertexNormals();

      for (let i = 0; i < NB; i++) {
        const b = bs[i];
        b.y += b.v * dt;
        if (b.y > WY - 0.05) spawn(b, false);
        const k = b.y / WY, wob = 0.05 + 0.11 * k, r = b.y < sandH(b.x, b.z) ? 0 : b.r * (1 + 0.4 * k);
        m.compose(p.set(b.x + Math.sin(t * 3 + b.ph) * wob, b.y, b.z + Math.cos(t * 2.3 + b.ph) * wob), q, s.setScalar(r));
        bub.setMatrixAt(i, m);
      }
      bub.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < ND; i++) {
        dp[i * 3] += Math.cos(t * 0.3 + i * 1.7) * 0.03 * dt;
        dp[i * 3 + 1] += (Math.sin(t * 0.4 + i) * 0.03 - 0.012) * dt;
        if (dp[i * 3 + 1] < 0.5) dp[i * 3 + 1] = WY - 0.1;
      }
      dg.attributes.position.needsUpdate = true;
    };
  }

  // ------------------------------------------------------------------- main
  function init() {
    const canvas = $('scene');
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
    catch (e) { $('loading').textContent = 'Браузер не поддерживает WebGL — 3D-сцену показать не получится.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;

    const scene = new T.Scene();
    scene.background = new T.Color(0x04090f);
    // The environment map also lights diffusely and is never shadowed, so the scenery gets
    // little of it (direct light keeps shadows and caustics readable); materials that set
    // envMap themselves, like scales and glass, keep their own stronger reflections.
    scene.environment = G.env = makeEnv(renderer);
    scene.environmentIntensity = 0.3;
    scene.fog = new T.Fog(0x0a4466, 10, 40);

    const centre = new T.Vector3(0, 3.7, 0);
    const camera = new T.PerspectiveCamera(36, 1, 0.5, 200);
    const controls = new T.OrbitControls(camera, canvas);
    controls.target.copy(centre);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minAzimuthAngle = -1.15; controls.maxAzimuthAngle = 1.15;
    controls.minPolarAngle = 0.95; controls.maxPolarAngle = 1.72;
    controls.minDistance = 11;

    scene.add(new T.HemisphereLight(0xcdeaff, 0x2a4352, 0.6));
    const sun = new T.DirectionalLight(0xf2fbff, 2.6);
    sun.position.set(2.5, 18, 5); sun.target.position.set(0, 1, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 5, far: 26 });
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun, sun.target);
    const fill = new T.PointLight(0x9fdcff, 160, 0, 2); // viewer-side fill, also spills onto the cabinet
    fill.position.set(0, 4.5, 10); scene.add(fill);

    const content = []; // meshes that take part in the polygon view and count
    buildTank(scene);
    buildSand(scene, content);
    buildRocks(scene, content);
    buildFlora(scene, content);
    const animateWater = buildWater(scene);

    const scales = scaleTex();
    const mats = {
      body: (uni) => patch(new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.12, clearcoat: 0.55,
        clearcoatRoughness: 0.3, iridescence: 0.25, iridescenceIOR: 1.35, bumpMap: scales, bumpScale: 0.55,
        envMap: G.env, envMapIntensity: 0.8 }), { swim: uni, caustic: 0.5 }),
      fins: (uni) => patch(new T.MeshStandardMaterial({ vertexColors: true, transparent: true, side: T.DoubleSide, roughness: 0.7,
        metalness: 0, envMap: G.env, envMapIntensity: 0.3 }), { swim: uni, caustic: 0.4 }),
    };
    const schools = [];
    for (const sp of SPECIES) {
      const geos = [], school = sp.school ? new School(sp.depth) : null;
      if (school) schools.push(school);
      for (let v = 0; v < sp.variants; v++) geos.push(buildFishGeo(sp, v));
      for (let k = 0; k < sp.count; k++) {
        const f = new Fish(sp, geos[k % geos.length], mats, school);
        fishes.push(f); scene.add(f.mesh); content.push(f.mesh, f.mesh.children[0]);
      }
    }
    const step = (dt) => { for (const s of schools) s.update(dt); for (const f of fishes) f.update(dt); };
    for (let i = 0; i < 400; i++) step(0.05); // settle so the first frame already looks natural

    let tris = 0;
    for (const m of content) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);
    $('st-fish').textContent = fishes.length;
    $('st-poly').textContent = Math.round(tris).toLocaleString('ru-RU');

    const wireBtn = $('btn-wire');
    wireBtn.addEventListener('click', () => {
      const on = wireBtn.getAttribute('aria-pressed') !== 'true';
      wireBtn.setAttribute('aria-pressed', on);
      wireBtn.textContent = on ? 'Скрыть полигоны' : 'Показать полигоны';
      for (const m of content) m.material.wireframe = on;
    });

    // keep the whole tank in frame for any aspect ratio
    const fit = (place) => {
      const a = window.innerWidth / window.innerHeight, t = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
      const dist = Math.max(6.3 / t, 8.7 / (t * a)) + TD / 2;
      camera.aspect = a; camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      controls.maxDistance = dist * 1.5;
      if (place) camera.position.set(0, centre.y + dist * 0.09, dist);
    };
    fit(true);
    window.addEventListener('resize', () => fit(false));

    let last = performance.now(), time = 0, frames = 0, fpsT = last;
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      G.uTime.value = time;
      step(dt);
      animateWater(dt, time);
      controls.update();
      // water haze is measured from the viewer, so depth reads the same at any zoom
      const d = camera.position.distanceTo(centre);
      scene.fog.near = d - 4; scene.fog.far = d + 17;
      renderer.render(scene, camera);
      if (++frames && now - fpsT > 500) { $('st-fps').textContent = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
    };
    requestAnimationFrame((now) => { last = now; frame(now); $('loading').classList.add('done'); });
  }

  // let the loading text paint before the (synchronous) scene build
  requestAnimationFrame(() => setTimeout(init, 0));
})();
