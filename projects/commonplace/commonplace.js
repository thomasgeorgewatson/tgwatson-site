/* ============================================
   Commonplace — mounts Canvas UI's Liquid as ink.
   ============================================ */

import { createLiquid, supportsHtmlInCanvas } from "./liquid.js";

const stage = document.getElementById("stage");
const native = supportsHtmlInCanvas();

/* Two tunings, not one.
   Native: the hero IS the texture, so distortion can be pushed — that's the whole effect.
   Fallback: the shader has no page texture, so it paints *over* the type. At Canvas UI's
   default intensity/blend that swallows entire paragraphs, so the wash runs much fainter
   and leans on distortion-free colour instead. */
const INK = { r: 0.79, g: 0.63, b: 0.16 };            // gold, matches --gold
const TUNING = native
  ? { distortion: 0.75, intensity: 1.9, blend: 3.4, densityDissipation: 0.972 }
  : { distortion: 0.0,  intensity: 0.7, blend: 1.1, densityDissipation: 0.955 };

function buildStage() {
  const source = document.createElement("canvas");
  source.className = "stage-source";
  source.setAttribute("layoutsubtree", "true");

  const content = document.createElement("div");
  content.className = "stage-content";
  content.append(document.getElementById("hero").content.cloneNode(true));

  if (native) {
    // Content lives inside the canvas; it stays laid out and hit-testable but is
    // painted by the shader rather than by the browser.
    Object.assign(source.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
    });
    source.append(content);
    stage.append(source);
  } else {
    // No html-in-canvas: render the hero normally and overlay the fluid on top.
    source.style.display = "none";
    stage.append(source, content);
  }

  const output = document.createElement("canvas");
  output.className = "stage-output";
  output.setAttribute("aria-hidden", "true");
  stage.append(output);

  return { source, content, output };
}

function wireHero() {
  const form = document.getElementById("reserve-form");
  const input = document.getElementById("reserve-email");
  const note = document.getElementById("reserve-note");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    // Deliberately local — there is nothing to reserve. It exists to prove the form
    // is live DOM even when you are looking at a shader of it.
    note.textContent = !value
      ? "A bottle needs somewhere to go."
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? `Reserved against ${value}. Not really — this is a demo.`
        : "That address wants another look.";
  });
}

async function mount() {
  // drawElementImage rasterises whatever is laid out right now. Without this the
  // texture bakes in the fallback serif and never updates when Garamond arrives.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* keep going with fallback metrics */ }
  }

  const elements = buildStage();
  wireHero();

  const instance = createLiquid(elements, {
    ...TUNING,
    rainbow: false,
    color: [INK.r, INK.g, INK.b],
    curl: 2.1,
    radius: 0.28,
    force: 1.15,
    simResolution: 128,
    dyeResolution: 512,
  });

  if (!instance) return;   // no WebGL2 — the hero still reads fine on its own

  // Canvas UI honours prefers-reduced-motion by disabling itself entirely, which is
  // correct and which we keep. But a dead hero looks broken rather than considerate,
  // so offer a deliberate opt-in. The stub only ever runs behind a real click.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    offerInk(instance, elements);
  }
}

function offerInk(instance, elements) {
  const button = document.createElement("button");
  button.className = "optin";
  button.type = "button";
  button.textContent = "Let the ink run";
  stage.append(button);

  button.addEventListener("click", () => {
    button.remove();
    instance.destroy();

    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (q) => /prefers-reduced-motion/.test(q)
      ? { matches: false, media: q, onchange: null,
          addEventListener() {}, removeEventListener() {},
          addListener() {}, removeListener() {}, dispatchEvent: () => false }
      : realMatchMedia(q);

    createLiquid(elements, {
      ...TUNING,
      rainbow: false,
      color: [INK.r, INK.g, INK.b],
      curl: 2.1, radius: 0.28, force: 1.15,
      simResolution: 128, dyeResolution: 512,
    });

    window.matchMedia = realMatchMedia;
  }, { once: true });
}

mount();
