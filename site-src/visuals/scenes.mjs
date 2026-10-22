import { Color } from "three";
import { mountLesson } from "./lesson.mjs";
export { mountMap, courseMap } from "./map.mjs";

export function resolveColor(el, cssVar) {
  const probe = document.createElement("span");
  probe.style.color = `var(${cssVar})`;
  probe.style.display = "none";
  el.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return new Color(value);
}

export function palette(el) {
  const accent = resolveColor(el, "--accent");
  const text = resolveColor(el, "--text");
  const muted = resolveColor(el, "--muted");
  const surface = resolveColor(el, "--surface");
  const dark = surface.r + surface.g + surface.b < 1.2;
  return { accent, text, muted, surface, dark, mix: (a, b, t) => a.clone().lerp(b, t) };
}

export function mount(el, kind) {
  return mountLesson(el, kind, palette);
}
