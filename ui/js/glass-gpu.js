// @ts-check

const VS = `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec2 uView;
void main() {
  vec2 p = uRect.xy - 1.0 + aPos * (uRect.zw + 2.0);
  vec2 c = p / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRect;
uniform vec2 uView;
uniform float uRadius;
#define LUT 64
uniform float uBevel;
uniform float uSide;
uniform float uCap;
uniform float uProfile[LUT];
uniform float uAlpha;
uniform vec4 uImg;
uniform float uBright;
uniform vec4 uTint;
uniform vec4 uFrost;
out vec4 o;

float sdf(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 wall(vec2 p) {
  vec3 c = texture(uTex, (p - uImg.xy) / uImg.zw).rgb * uBright;
  return mix(c, uTint.rgb, uTint.a);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 h = uRect.zw * 0.5;
  vec2 l = p - uRect.xy - h;
  float r = clamp(uRadius, 0.0, min(h.x, h.y));
  float edge = sdf(l, h, r);
  float cover = clamp(0.5 - edge, 0.0, 1.0);
  if (cover <= 0.0) discard;
  float d = -edge;
  vec3 col = wall(p);
  if (d < uBevel && uSide > 0.0) {
    float x = clamp(max(d, 0.0) / uBevel, 0.0, 1.0) * float(LUT - 1);
    int i = int(x);
    float pull = min(mix(uProfile[i], uProfile[min(i + 1, LUT - 1)], fract(x)) * uSide, uCap);
    vec2 q = abs(l) - h + r;
    vec2 n = max(q.x, q.y) > 0.0 && min(q.x, q.y) > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    col = wall(p - n * sign(l) * pull);
  }
  col = mix(col, uFrost.rgb, uFrost.a);
  float k = cover * uAlpha;
  o = vec4(col * k, k);
}`;

const BLUR_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -40; i <= 40; i++) {
    float x = float(i);
    if (abs(x) > 3.0 * uSigma) continue;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uTex, vUv + uStep * x) * w;
    total += w;
  }
  o = sum / total;
}`;

const SLAB = { bezel: 0.2535, base: 0.2488, rise: 0.3226 };
const IOR = 1.5;
const LUT = 64;
const MAX_SIDE = 108;
const MAX_SCALE = 2;
const squircle = (/** @type {number} */ x) => (1 - (1 - x) ** 4) ** 0.25;
/** @type {Map<number, Float32Array>} */
const profiles = new Map();
/** @param {number} bend */
export function slabProfile(bend) {
  let out = profiles.get(bend);
  if (out) return out;
  out = new Float32Array(LUT);
  const thick = bend / 0.9;
  const e = 1e-4;
  for (let i = 0; i < LUT - 1; i++) {
    const x = Math.max(i, 0.5) / (LUT - 1);
    const slope = (SLAB.rise * thick * (squircle(Math.min(x + e, 1)) - squircle(x))) / (e * SLAB.bezel);
    const a = Math.atan(slope);
    out[i] = (SLAB.base + SLAB.rise * squircle(x)) * thick * Math.tan(a - Math.asin(Math.sin(a) / IOR));
  }
  profiles.set(bend, out);
  return out;
}

/** @typedef {{ bend: number, dispersion: number, brightness: number, tint: number[], frost: number[] }} GlassLook */
/** @typedef {{ rect: { left: number, top: number, width: number, height: number }, radius: number, alpha: number }} GlassItem */

/** @param {WebGL2RenderingContext} gl @param {string} vs @param {string} fs */
function compile(gl, vs, fs) {
  const program = gl.createProgram();
  /** @type {WebGLShader[]} */
  const shaders = [];
  const fail = (/** @type {string} */ why) => {
    console.warn('[glass] shader failed:', why);
    for (const sh of shaders) gl.deleteShader(sh);
    gl.deleteProgram(program);
    return null;
  };
  for (const [type, src] of /** @type {[number, string][]} */ ([
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ])) {
    const shader = gl.createShader(type);
    if (!shader) return fail('no shader object');
    shaders.push(shader);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return fail(gl.getShaderInfoLog(shader) ?? 'compile');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail(gl.getProgramInfoLog(program) ?? 'link');
  for (const sh of shaders) {
    gl.detachShader(program, sh);
    gl.deleteShader(sh);
  }
  /** @type {Record<string, WebGLUniformLocation|null>} */
  const u = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) u[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u, aPos: gl.getAttribLocation(program, 'aPos') };
}

/** Returns null without WebGL2 or a compiled shader.
    @param {HTMLCanvasElement} canvas @param {{ blur?: boolean }} [options] */
export function createGlassRenderer(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    antialias: false,
    alpha: true,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const main = compile(gl, VS, FS);
  if (!main) return null;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  /** @type {WebGLTexture|null} */
  let tex = null;
  let img = [0, 0, 1, 1];
  /** @type {number} */
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let scale = 1;
  let origin = [0, 0];
  let profileBend = Number.NaN;

  /** @param {number} w @param {number} h @param {TexImageSource|null} src */
  const texture = (w, h, src) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };

  /** @type {ReturnType<typeof compile>} */
  let blurProg = null;
  /** Returns a blurred quarter-size copy and deletes src. Without the blur shader it returns src.
      @param {WebGLTexture} src @param {number} w @param {number} h @param {number} sigma */
  const blurred = (src, w, h, sigma) => {
    blurProg ??= compile(gl, BLUR_VS, BLUR_FS);
    if (!blurProg) return src;
    const prog = blurProg;
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    const a = texture(bw, bh, null);
    const b = texture(bw, bh, null);
    const fb = gl.createFramebuffer();
    gl.useProgram(prog.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    for (const [from, to, step, s] of /** @type {[WebGLTexture, WebGLTexture, number[], number][]} */ ([
      [src, a, [0, 0], 0.5],
      [a, b, [1 / bw, 0], sigma / 4],
      [b, a, [0, 1 / bh], sigma / 4],
    ])) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, to, 0);
      gl.viewport(0, 0, bw, bh);
      gl.bindTexture(gl.TEXTURE_2D, from);
      gl.uniform2f(prog.u.uStep, step[0], step[1]);
      gl.uniform1f(prog.u.uSigma, Math.max(0.5, s));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(b);
    gl.deleteTexture(src);
    return a;
  };

  return {
    maxSize,
    /** Returns false when the GPU refused the picture. Sampling it would paint black.
        @param {ImageBitmap|null} bitmap @param {number[]} box wallpaper box in CSS px: x, y, w, h @param {number} blurPx
        @returns {boolean} */
    setWallpaper(bitmap, box, blurPx) {
      if (tex) gl.deleteTexture(tex);
      tex = null;
      if (!bitmap) return true;
      if (bitmap.width > maxSize || bitmap.height > maxSize) return false;
      gl.getError();
      tex = texture(0, 0, bitmap);
      if (gl.getError() !== gl.NO_ERROR) {
        gl.deleteTexture(tex);
        tex = null;
        return false;
      }
      if (options.blur && blurPx > 0 && tex)
        tex = blurred(tex, bitmap.width, bitmap.height, (blurPx * bitmap.width) / box[2]);
      img = box;
      return true;
    },
    /** Moves the wallpaper without a new upload. @param {number[]} box wallpaper box in CSS px: x, y, w, h */
    setBox(box) {
      img = box;
    },
    /** @param {number} width @param {number} height @param {number} [x] @param {number} [y] CSS px */
    resize(width, height, x = 0, y = 0) {
      scale = Math.min(globalThis.devicePixelRatio || 1, MAX_SCALE, maxSize / Math.max(width, height, 1));
      origin = [x, y];
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
    /** @param {GlassItem[]} items @param {GlassLook} look */
    draw(items, look) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!tex || !items.length) return;
      const u = main.u;
      gl.useProgram(main.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(main.aPos);
      gl.vertexAttribPointer(main.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(u.uView, canvas.width, canvas.height);
      const k = scale;
      const [ox, oy] = origin;
      gl.uniform4f(u.uImg, (img[0] - ox) * k, (img[1] - oy) * k, img[2] * k, img[3] * k);
      gl.uniform1f(u.uBright, look.brightness);
      gl.uniform4f(u.uTint, look.tint[0], look.tint[1], look.tint[2], look.tint[3]);
      gl.uniform4f(u.uFrost, look.frost[0], look.frost[1], look.frost[2], look.frost[3]);
      if (look.bend !== profileBend) {
        gl.uniform1fv(u['uProfile[0]'], slabProfile(look.bend));
        profileBend = look.bend;
      }
      for (const it of items) {
        const { left, top, width, height } = it.rect;
        const short = Math.min(width, height);
        const side = Math.min(short, MAX_SIDE) * k;
        gl.uniform4f(u.uRect, (left - ox) * k, (top - oy) * k, width * k, height * k);
        gl.uniform1f(u.uRadius, it.radius * k);
        gl.uniform1f(u.uBevel, Math.max(1, SLAB.bezel * side));
        gl.uniform1f(u.uSide, look.bend > 0 ? side : 0);
        gl.uniform1f(u.uCap, 0.5 * short * k);
        gl.uniform1f(u.uAlpha, it.alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
  };
}

const LENS_VS = `#version 300 es
in vec2 aPos;
out vec2 v;
void main() {
  v = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The rim bend grows as (1 - d / bevel) to this power. The tab bar's CSS bend uses it too. */
export const RIM_CURVE = 1.6;

const LENS_FS = `#version 300 es
precision highp float;
in vec2 v;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uScene2;
uniform float uMix;
uniform int uMode;
uniform vec3 uCard;
uniform vec4 uRail;
uniform vec3 uRailCol;
uniform vec3 uFillCol;
uniform float uFill;
uniform float uGrad;
uniform float uDpr;
uniform vec2 uSize;
uniform vec4 uLens;
uniform float uBevel;
uniform float uDepth;
uniform float uFrost;
uniform vec3 uVeil;
uniform float uBlur;
uniform float uLine;
uniform float uRim;
uniform float uShadow;
uniform float uDisp;
uniform float uLift;
float sdf(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 scene(vec2 p) {
  if (uMode == 1) {
    vec2 rh = uRail.zw * 0.5;
    vec2 rc = uRail.xy + rh;
    float a = clamp(0.5 - sdf(p - rc, rh, rh.y) * uDpr, 0.0, 1.0);
    vec3 rail = uGrad > 0.5 ? texture(uScene, vec2(clamp((p.x - uRail.x) / uRail.z, 0.0, 1.0), 0.5)).rgb : uRailCol;
    if (uGrad < 0.5 && uFill > 0.2) {
      vec2 fh = vec2(max(uFill, uRail.w) * 0.5, rh.y);
      rail = mix(rail, uFillCol, clamp(0.5 - sdf(p - vec2(uRail.x + fh.x, rc.y), fh, rh.y) * uDpr, 0.0, 1.0));
    }
    return mix(uCard, rail, a);
  }
  vec2 uv = p / uSize;
  return mix(texture(uScene, uv).rgb, texture(uScene2, uv).rgb, uMix);
}
vec3 sceneBlur(vec2 p) {
  if (uBlur < 0.05) return scene(p);
  vec3 c = vec3(0.0);
  for (int i = -2; i <= 2; i++)
    for (int j = -2; j <= 2; j++) c += scene(p + vec2(float(i), float(j)) * uBlur * 0.5);
  return c / 25.0;
}
void main() {
  vec2 p = vec2(v.x, 1.0 - v.y) * uSize;
  vec2 h = uLens.zw * 0.5;
  vec2 c = uLens.xy + h;
  vec2 l = p - c;
  float r = min(h.x, h.y);
  float e = sdf(l, h, r);
  float shadow = uShadow * (1.0 - smoothstep(-4.0, 9.0, sdf(l - vec2(0.0, 3.0), h, r)));
  float cover = clamp(0.5 - e, 0.0, 1.0);
  if (cover <= 0.0) {
    o = vec4(0.0, 0.0, 0.0, shadow);
    return;
  }
  float d = -e;
  vec2 g = vec2(sdf(l + vec2(0.5, 0.0), h, r) - sdf(l - vec2(0.5, 0.0), h, r),
                sdf(l + vec2(0.0, 0.5), h, r) - sdf(l - vec2(0.0, 0.5), h, r));
  g = length(g) > 0.0 ? normalize(g) : vec2(0.0);
  float t = clamp(1.0 - d / uBevel, 0.0, 1.0);
  float pull = pow(t, ${RIM_CURVE.toFixed(2)}) * uDepth * (g.x * g.x);
  if (uMode == 2) {
    o = texture(uScene, (p + g * pull) / uSize) * cover;
    return;
  }
  vec3 col = sceneBlur(p + g * pull);
  if (abs(pull * uDisp) * uDpr >= (uBlur >= 1.0 ? 0.02 : 0.005)) {
    col.r = sceneBlur(p + g * pull * (1.0 + uDisp)).r;
    col.b = sceneBlur(p + g * pull * (1.0 - uDisp)).b;
  }
  float line = 1.0 - smoothstep(0.0, 1.6, d);
  col = pow(col, vec3(1.0 + 1.4 * line * uLine)) * (1.0 - 0.25 * line * uLine);
  col *= 1.0 - 0.09 * (1.0 - smoothstep(0.0, 7.0, d)) * uLine;
  col = mix(col, vec3(1.0), uLift * uLine);
  col *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, h.y * 0.9, l.y + h.y)) * uLine;
  float rimZone = (1.0 - smoothstep(0.5, 3.5, d)) * smoothstep(0.0, 0.8, d);
  float lit = max(dot(g, normalize(vec2(-0.6, -0.8))), 0.0) + 0.7 * max(dot(g, normalize(vec2(0.6, 0.8))), 0.0);
  col = mix(col, vec3(1.0), clamp(rimZone * lit * uRim, 0.0, 1.0));
  col = mix(col, uVeil, uFrost);
  o = vec4(col * cover, cover + shadow * (1.0 - cover));
}`;

/** @typedef {{ x: number, y: number, w: number, h: number, mix?: number, bevel?: number, depth?: number, frost?: number,
               veil?: number[], blur?: number, line?: number, rim?: number, shadow?: number, disp?: number,
               lift?: number, ink?: boolean,
               rail?: { card: number[], x: number, y: number, w: number, h: number, rail: number[], fill: number[], fillW: number, grad: boolean } }} LensLook */

/** @typedef {{ cv: HTMLCanvasElement, gl: WebGL2RenderingContext, prog: NonNullable<ReturnType<typeof compile>>,
               owner: object|null, copy: HTMLCanvasElement|null, size: [number, number],
               pics: Map<string, WebGLTexture> }} LensSlot */

/** Lens canvases, each with its own WebGL context. */
const POOL = 4;
/** Scene pictures kept on the GPU per slot, least recently used dropped first. */
const PICTURES = 16;
/** After WebGL2 fails, wait this long before trying again. */
const RETRY_MS = 10_000;
/** @type {LensSlot[]} */
const pool = [];
let failedAt = -Infinity;
/** @type {WeakMap<object, number>} */
const ownerIds = new WeakMap();
let nextOwner = 1;

/** @returns {LensSlot|null} */
function newSlot() {
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  cv.className = 'glass-lens';
  cv.setAttribute('aria-hidden', 'true');
  const prog = compile(gl, LENS_VS, LENS_FS);
  if (!prog) return null;
  gl.useProgram(prog.program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(prog.u.uScene, 0);
  gl.uniform1i(prog.u.uScene2, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  /** @type {LensSlot} */
  const slot = { cv, gl, prog, owner: null, copy: null, size: [0, 0], pics: new Map() };
  cv.addEventListener('webglcontextlost', () => {
    const i = pool.indexOf(slot);
    if (i >= 0) pool.splice(i, 1);
    slot.pics.clear();
    cv.remove();
  });
  return slot;
}

/** Whether a lens can be drawn: WebGL2 and the lens shader both work. */
export function lensSupported() {
  if (pool.length) return true;
  if (performance.now() - failedAt < RETRY_MS) return false;
  const s = newSlot();
  if (!s) {
    failedAt = performance.now();
    return false;
  }
  pool.push(s);
  return true;
}

/** The lens canvas for `owner`, placed after `own`, or null when every slot is
    busy or there is no WebGL2. With `copy`, the slot stays off the page and each
    frame is copied into `own`.
    @param {object} owner @param {HTMLCanvasElement} own @param {boolean} [copy] */
export function lensClaim(owner, own, copy = false) {
  if (!lensSupported()) return null;
  let s = pool.find(x => x.owner === owner) || pool.find(x => !x.owner) || null;
  if (!s && pool.length < POOL) {
    s = newSlot();
    if (s) pool.push(s);
  }
  if (!s) return null;
  if (copy) {
    s.owner = owner;
    s.copy = own;
    if (!s.cv.hidden) s.cv.hidden = true;
    if (own.hidden) own.hidden = false;
    return s;
  }
  if (s.owner !== owner || s.copy || s.cv.hidden || s.cv.previousSibling !== own) {
    s.owner = owner;
    s.copy = null;
    if (s.cv.previousSibling !== own) own.after(s.cv);
    s.cv.style.cssText = own.style.cssText;
    s.size = [0, 0];
    s.cv.hidden = false;
  }
  if (!own.hidden) own.hidden = true;
  return s;
}

/** @param {object} owner */
export function lensRelease(owner) {
  const s = pool.find(x => x.owner === owner);
  if (!s) return;
  s.owner = null;
  s.cv.hidden = true;
}

/** A scene picture kept on the GPU per owner and key, drawn the first time.
    A see-through picture without `premultiplied` samples dark edges.
    @param {LensSlot} s @param {object} owner @param {string} key @param {() => TexImageSource} draw
    @param {boolean} [premultiplied] */
export function lensPicture(s, owner, key, draw, premultiplied = false) {
  let id = ownerIds.get(owner);
  if (!id) {
    id = nextOwner++;
    ownerIds.set(owner, id);
  }
  const k = `${id}:${key}`;
  const m = s.pics;
  const have = m.get(k);
  if (have) {
    m.delete(k);
    m.set(k, have);
    return have;
  }
  const gl = s.gl;
  const t = /** @type {WebGLTexture} */ (gl.createTexture());
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw());
  if (premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  m.set(k, t);
  if (m.size > PICTURES) {
    const [k0, t0] = /** @type {[string, WebGLTexture]} */ (m.entries().next().value);
    m.delete(k0);
    gl.deleteTexture(t0);
  }
  return t;
}

/** One frame into a w x h CSS px canvas at `dpr`.
    @param {LensSlot} s @param {WebGLTexture|null} a @param {WebGLTexture|null} b
    @param {number} w @param {number} h @param {number} dpr @param {LensLook} look */
export function lensFrame(s, a, b, w, h, dpr, look) {
  const { gl, cv, prog } = s;
  const u = prog.u;
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  if (!s.copy && (s.size[0] !== w || s.size[1] !== h)) {
    s.size = [w, h];
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
  }
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (a) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b ?? a);
    gl.activeTexture(gl.TEXTURE0);
  }
  const r = look.rail;
  gl.uniform1i(u.uMode, r ? 1 : look.ink ? 2 : 0);
  gl.uniform1f(u.uMix, look.mix ?? 0);
  gl.uniform1f(u.uDpr, dpr);
  if (r) {
    gl.uniform3f(u.uCard, r.card[0], r.card[1], r.card[2]);
    gl.uniform4f(u.uRail, r.x, r.y, r.w, r.h);
    gl.uniform3f(u.uRailCol, r.rail[0], r.rail[1], r.rail[2]);
    gl.uniform3f(u.uFillCol, r.fill[0], r.fill[1], r.fill[2]);
    gl.uniform1f(u.uFill, r.fillW);
    gl.uniform1f(u.uGrad, r.grad ? 1 : 0);
  }
  const veil = look.veil ?? [1, 1, 1];
  gl.uniform2f(u.uSize, w, h);
  gl.uniform4f(u.uLens, look.x, look.y, look.w, look.h);
  gl.uniform1f(u.uBevel, look.bevel ?? 12);
  gl.uniform1f(u.uDepth, look.depth ?? 0);
  gl.uniform1f(u.uFrost, look.frost ?? 0);
  gl.uniform3f(u.uVeil, veil[0], veil[1], veil[2]);
  gl.uniform1f(u.uBlur, look.blur ?? 0);
  gl.uniform1f(u.uLine, look.line ?? 1);
  gl.uniform1f(u.uRim, look.rim ?? 0.8);
  gl.uniform1f(u.uShadow, look.shadow ?? 0.1);
  gl.uniform1f(u.uDisp, look.disp ?? 0.02);
  gl.uniform1f(u.uLift, look.lift ?? 0.07);
  const x0 = Math.max(0, Math.floor((look.x - 10) * dpr));
  const x1 = Math.min(W, Math.ceil((look.x + look.w + 10) * dpr));
  const y0 = Math.max(0, Math.floor((look.y - 8) * dpr));
  const y1 = Math.min(H, Math.ceil((look.y + look.h + 16) * dpr));
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x0, H - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.SCISSOR_TEST);
  const into = s.copy;
  if (into) {
    if (into.width !== W || into.height !== H) {
      into.width = W;
      into.height = H;
      into.style.width = `${w}px`;
      into.style.height = `${h}px`;
    }
    const ctx = into.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(cv, 0, 0);
    }
  }
}
