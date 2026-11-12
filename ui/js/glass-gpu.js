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
uniform float uBevel;
uniform float uDepth;
uniform vec3 uIor;
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
  if (d < uBevel) {
    float t = clamp(1.0 - max(d, 0.0) / uBevel, 0.0, 0.985);
    float rise = t / sqrt(1.0 - t * t);
    vec2 g = vec2(
      sdf(l + vec2(0.5, 0.0), h, r) - sdf(l - vec2(0.5, 0.0), h, r),
      sdf(l + vec2(0.0, 0.5), h, r) - sdf(l - vec2(0.0, 0.5), h, r));
    g = length(g) > 0.0 ? normalize(g) : vec2(0.0);
    vec3 n = normalize(vec3(g * rise, 1.0));
    float cap = 0.5 * min(uRect.z, uRect.w);
    for (int i = 0; i < 3; i++) {
      vec3 ray = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / uIor[i]);
      vec2 shift = ray.xy / max(-ray.z, 0.05) * uDepth;
      float len = length(shift);
      if (len > cap) shift *= cap / len;
      col[i] = wall(p + shift)[i];
    }
  }
  float inner = smoothstep(0.0, 0.18 * min(uRect.z, uRect.w), d);
  col = mix(col, uFrost.rgb, uFrost.a * mix(0.2, 1.0, inner));
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
    /** @param {number} width @param {number} height CSS px */
    resize(width, height) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
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
      gl.uniform4f(u.uImg, img[0], img[1], img[2], img[3]);
      gl.uniform1f(u.uBright, look.brightness);
      gl.uniform4f(u.uTint, look.tint[0], look.tint[1], look.tint[2], look.tint[3]);
      gl.uniform4f(u.uFrost, look.frost[0], look.frost[1], look.frost[2], look.frost[3]);
      const spread = 0.04 * look.dispersion;
      gl.uniform3f(u.uIor, 1.5 - spread, 1.5, 1.5 + spread);
      for (const it of items) {
        const { left, top, width, height } = it.rect;
        const bevel = Math.max(1, Math.min(0.32 * Math.min(width, height), 36));
        gl.uniform4f(u.uRect, left, top, width, height);
        gl.uniform1f(u.uRadius, it.radius);
        gl.uniform1f(u.uBevel, bevel);
        gl.uniform1f(u.uDepth, look.bend * bevel);
        gl.uniform1f(u.uAlpha, it.alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
  };
}
