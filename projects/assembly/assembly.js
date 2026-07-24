/* ============================================================================
   Assembly — live DOM rasterised once, then rendered as a GPU particle system.

   Two rasterisation paths, identical output:
     native    ctx.drawElementImage()  — needs the html-in-canvas flag
     universal SVG <foreignObject>     — works in every shipping browser

   Everything after the snapshot is plain WebGL2, so the effect itself has no
   platform requirements beyond WebGL2 + float render targets.
   ========================================================================= */

const stage   = document.getElementById("stage");
const hero    = document.getElementById("hero");
const canvas  = document.getElementById("dust");
const replay  = document.getElementById("replay");
const readout = document.getElementById("readout");

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_SIDE = 512;              // particle texture side => up to 262,144 particles

/* ---------------------------------------------------------------- rasterise */

function nativeSupported() {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  return !!(ctx && typeof ctx.drawElementImage === "function" &&
            typeof c.requestPaint === "function");
}

/**
 * Rasterise the hero across the whole stage box, so bitmap pixels map 1:1 onto
 * stage coordinates and no offset maths is needed downstream.
 *
 * IMPORTANT constraint, verified against Chromium 149: drawElementImage() throws
 * "Only immediate children of the <canvas> element can be drawn" for any element
 * that is not a direct child of the canvas you are drawing with. So the native
 * path has to physically relocate the hero into a layoutsubtree canvas. That is
 * also why the fallback cannot simply be "call the other function" — the two
 * paths need different DOM.
 *
 * Returns {canvas, scale, mode}.
 */
async function rasterise(el, stageW, stageH, dpr) {
  const w = Math.max(1, Math.round(stageW * dpr));
  const h = Math.max(1, Math.round(stageH * dpr));

  if (nativeSupported()) {
    const host = document.createElement("canvas");
    host.className = "host";
    host.setAttribute("layoutsubtree", "true");
    host.width = w; host.height = h;
    stage.insertBefore(host, stage.firstChild);
    host.appendChild(el);                       // el is now an immediate child

    // Size the hero explicitly rather than trusting `inset: 0`. Inside a
    // layoutsubtree canvas that does not resolve to a height, so the hero
    // collapses to its content and drawElementImage lands it at the top-left
    // instead of centred. Explicit pixels behave predictably on both paths.
    Object.assign(el.style, {
      position: "absolute", left: "0px", top: "0px",
      width: stageW + "px", height: stageH + "px",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
    });
    void host.offsetHeight;                     // force layout before painting

    const hctx = host.getContext("2d", { willReadFrequently: true });
    try {
      // drawElementImage throws "No cached paint record for element" unless the
      // browser has actually painted the subtree first. The API's handshake is
      // requestPaint() -> onpaint -> draw; there is no synchronous shortcut.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("paint timed out")), 2000);
        host.onpaint = () => {
          clearTimeout(timer);
          try {
            // No ctx.scale() here. drawElementImage already rasterises at the
            // device pixel ratio, so applying dpr again renders at 2x and crops.
            // The canvas backing store is dpr-sized, so this lands 1:1.
            hctx.reset();
            hctx.drawElementImage(el, 0, 0);
            resolve();
          } catch (err) { reject(err); }
        };
        host.requestPaint();
      });
      host.onpaint = null;                      // one snapshot is all we need

      if (hasInk(hctx, w, h)) {
        // Snapshot, then wipe the visible bitmap — from here the particles are
        // the only rendering, while `el` stays laid out, focusable and readable.
        const snap = document.createElement("canvas");
        snap.width = w; snap.height = h;
        snap.getContext("2d").drawImage(host, 0, 0);
        hctx.clearRect(0, 0, w, h);
        return { canvas: snap, scale: dpr, mode: "native" };
      }
    } catch (e) {
      console.warn("drawElementImage unusable, falling back:", e.message);
    }
    // Native didn't work — strip the inline box and put the hero back where the
    // universal path expects it, otherwise the fallback inherits a broken layout.
    host.onpaint = null;
    el.removeAttribute("style");
    stage.insertBefore(el, host);
    host.remove();
  }

  // Universal path. The SVG is fully self-contained: the hero's own <style>
  // block is inlined, so there is no external stylesheet or font request and the
  // canvas is never tainted (getImageData keeps working).
  const heroCss = document.getElementById("hero-style").textContent;
  const clone = el.cloneNode(true);
  clone.classList.remove("is-painted");
  clone.removeAttribute("id");
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

  const markup = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${stageW} ${stageH}">` +
      `<style>${heroCss}</style>` +
      `<foreignObject x="0" y="0" width="${stageW}" height="${stageH}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${stageW}px;height:${stageH}px;` +
             `display:flex;align-items:center;justify-content:center">${markup}</div>` +
      `</foreignObject>` +
    `</svg>`;

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: out, scale: dpr, mode: "universal" };
}

function hasInk(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) return true;
  return false;
}

/* ------------------------------------------------------- particles from bitmap */

/** Every sufficiently opaque pixel becomes a candidate particle, in stage px. */
function extract(rasterCanvas, scale) {
  const w = rasterCanvas.width, h = rasterCanvas.height;
  const d = rasterCanvas.getContext("2d").getImageData(0, 0, w, h).data;

  const xs = [], ys = [], cols = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3];
      if (a < 24) continue;
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * (a / 255);
      if (lum < 18) continue;                       // skip near-black pixels
      xs.push(x / scale); ys.push(y / scale);
      cols.push(d[i], d[i + 1], d[i + 2]);
    }
  }
  return { xs, ys, cols, count: xs.length };
}

/* ------------------------------------------------------------------- shaders */

const QUAD_VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

// One simulation step. Reads pos/vel, writes pos/vel.
const SIM_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;    // xy = position (css px), zw = velocity
uniform sampler2D uTarget;   // xy = rest position
uniform vec2  uMouse;
uniform float uMouseOn;
uniform float uStiffness;
uniform float uDamping;
out vec4 outState;

void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, c, 0);
  vec2 pos = s.xy, vel = s.zw;
  vec2 tgt = texelFetch(uTarget, c, 0).xy;

  vel += (tgt - pos) * uStiffness;              // spring home

  if (uMouseOn > 0.5) {                          // cursor shockwave
    vec2 away = pos - uMouse;
    float d = length(away) + 0.0001;
    const float R = 150.0;
    if (d < R) {
      float f = 1.0 - d / R;
      vel += (away / d) * f * f * 34.0;
    }
  }

  vel *= uDamping;
  pos += vel;
  outState = vec4(pos, vel);
}`;

const DRAW_VS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uColor;
uniform vec2  uRes;
uniform float uSize;
out vec3 vColor;
out float vSpeed;

void main(){
  int w = textureSize(uState, 0).x;
  ivec2 c = ivec2(gl_VertexID % w, gl_VertexID / w);
  vec4 s = texelFetch(uState, c, 0);
  vColor = texelFetch(uColor, c, 0).rgb;
  vSpeed = clamp(length(s.zw) * 0.11, 0.0, 1.0);

  vec2 clip = (s.xy / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = uSize * (1.0 + vSpeed * 0.7);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vSpeed;
out vec4 outColor;

void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.15, d);
  // disturbed particles flare toward gold, so motion reads as heat
  vec3 col = mix(vColor, vec3(0.85, 0.65, 0.24), vSpeed * 0.75);
  outColor = vec4(col * a, a);
}`;

/* ----------------------------------------------------------------- gl helpers */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader: " + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function dataTexture(gl, side, internal, format, type, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, side, side, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
    say("WebGL2 float targets unavailable — showing plain DOM", "warn");
    return;                       // hero stays visible; page is still correct
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const stageBox0 = stage.getBoundingClientRect();
  const { canvas: raster, scale, mode } =
    await rasterise(hero, stageBox0.width, stageBox0.height, dpr);
  const pts = extract(raster, scale);
  if (pts.count < 500) { say("not enough ink to sample", "warn"); return; }

  // Largest square texture that fits the sampled pixels.
  const side = Math.min(MAX_SIDE, Math.floor(Math.sqrt(pts.count)));
  const N = side * side;

  // Even stride through the candidates so the sample is spatially uniform.
  const stride = pts.count / N;
  const target = new Float32Array(N * 4);
  const colour = new Uint8Array(N * 4);
  const state  = new Float32Array(N * 4);

  // The raster covers the whole stage, so sampled pixels are already in stage
  // coordinates — no offset correction needed on either path.
  for (let i = 0; i < N; i++) {
    const src = Math.floor(i * stride);
    const tx = pts.xs[src];
    const ty = pts.ys[src];
    target[i * 4] = tx; target[i * 4 + 1] = ty;

    colour[i * 4]     = pts.cols[src * 3];
    colour[i * 4 + 1] = pts.cols[src * 3 + 1];
    colour[i * 4 + 2] = pts.cols[src * 3 + 2];
    colour[i * 4 + 3] = 255;

    if (REDUCED) {                       // settle instantly, no intro flight
      state[i * 4] = tx; state[i * 4 + 1] = ty;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = 260 + Math.random() * 620;
      state[i * 4]     = tx + Math.cos(a) * r;
      state[i * 4 + 1] = ty + Math.sin(a) * r;
      state[i * 4 + 2] = 0; state[i * 4 + 3] = 0;
    }
  }

  const simProg  = program(gl, QUAD_VS, SIM_FS);
  const drawProg = program(gl, DRAW_VS, DRAW_FS);

  const targetTex = dataTexture(gl, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, target);
  const colourTex = dataTexture(gl, side, gl.RGBA8,   gl.RGBA, gl.UNSIGNED_BYTE, colour);
  let  a = dataTexture(gl, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, state);
  let  b = dataTexture(gl, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();

  // Fullscreen triangle-strip for the simulation pass.
  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(simProg, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const empty = gl.createVertexArray();

  const uSim = {
    state: gl.getUniformLocation(simProg, "uState"),
    target: gl.getUniformLocation(simProg, "uTarget"),
    mouse: gl.getUniformLocation(simProg, "uMouse"),
    mouseOn: gl.getUniformLocation(simProg, "uMouseOn"),
    stiff: gl.getUniformLocation(simProg, "uStiffness"),
    damp: gl.getUniformLocation(simProg, "uDamping"),
  };
  const uDraw = {
    state: gl.getUniformLocation(drawProg, "uState"),
    colour: gl.getUniformLocation(drawProg, "uColor"),
    res: gl.getUniformLocation(drawProg, "uRes"),
    size: gl.getUniformLocation(drawProg, "uSize"),
  };

  let W = 0, H = 0;
  function resize() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  resize();
  addEventListener("resize", resize);

  const mouse = { x: -9999, y: -9999, on: 0 };
  if (!REDUCED) {
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.on = 1;
    });
    stage.addEventListener("pointerleave", () => { mouse.on = 0; });
  }

  // Universal path hides the hero with opacity (still selectable, still in the
  // a11y tree). Native path needs no hiding — canvas children are never painted.
  if (mode !== "native") hero.classList.add("is-painted");
  say(mode === "native"
      ? `native drawElementImage &middot; ${N.toLocaleString()} particles`
      : `universal foreignObject path &middot; ${N.toLocaleString()} particles`,
      mode === "native" ? "ok" : "");
  const inline = document.getElementById("count-inline");
  if (inline) inline.textContent = `${N.toLocaleString()} particles`;

  function step() {
    // ---- simulate
    // Blending MUST be off here. The draw pass below turns it on, and if it is
    // still on when we render state into the float texture the shader output is
    // alpha-blended with the previous state instead of replacing it — the values
    // compound every frame and reach NaN within about a second.
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b, 0);
    gl.viewport(0, 0, side, side);
    gl.useProgram(simProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a);
    gl.uniform1i(uSim.state, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, targetTex);
    gl.uniform1i(uSim.target, 1);
    gl.uniform2f(uSim.mouse, mouse.x, mouse.y);
    gl.uniform1f(uSim.mouseOn, REDUCED ? 0 : mouse.on);
    gl.uniform1f(uSim.stiff, 0.014);
    gl.uniform1f(uSim.damp, 0.905);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    [a, b] = [b, a];

    // ---- draw
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(drawProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a);
    gl.uniform1i(uDraw.state, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, colourTex);
    gl.uniform1i(uDraw.colour, 1);
    gl.uniform2f(uDraw.res, W, H);
    gl.uniform1f(uDraw.size, Math.max(1.4, 1.7 * dpr));
    gl.bindVertexArray(empty);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.bindVertexArray(null);

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  replay.addEventListener("click", () => {
    const fresh = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 260 + Math.random() * 620;
      fresh[i * 4]     = target[i * 4]     + Math.cos(ang) * rad;
      fresh[i * 4 + 1] = target[i * 4 + 1] + Math.sin(ang) * rad;
    }
    gl.bindTexture(gl.TEXTURE_2D, a);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, side, side, gl.RGBA, gl.FLOAT, fresh);
  });
}

function say(html, cls) {
  readout.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
}

boot().catch((err) => {
  say("could not start — showing plain DOM", "warn");
  hero.classList.remove("is-painted");
  console.error(err);
});
