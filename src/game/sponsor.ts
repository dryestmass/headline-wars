/// <reference types="vite/client" />

// Set both public Vite build variables to enable a direct sponsor placement.
// A future ad provider can fill the same placement after it returns a creative.
export function mountSponsor(slot: HTMLElement): void {
  const label = import.meta.env.VITE_SPONSOR_TEXT?.trim();
  const destination = import.meta.env.VITE_SPONSOR_URL?.trim();
  if (!label || !destination) return;

  let url: URL;
  try { url = new URL(destination); }
  catch { return; }
  if (url.protocol !== "https:" || url.username || url.password) return;

  const disclosure = document.createElement("span");
  disclosure.className = "eyebrow";
  disclosure.textContent = "Advertisement";
  const link = document.createElement("a");
  link.href = url.href;
  link.rel = "sponsored";
  link.textContent = label;
  slot.replaceChildren(disclosure, link);
  slot.hidden = false;
}
