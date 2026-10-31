// Cross-page fragments can be processed before React has rendered the section.
export function followPublicSection(window, document) {
  const scroll = () => {
    const id = window.location.hash.slice(1);
    if (!["features", "how-it-works", "pricing", "faq", "public-main"].includes(id))
      return;
    document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
  };
  const frame = window.requestAnimationFrame(scroll);
  window.addEventListener("hashchange", scroll);
  // Safari may restore a page from its back/forward cache.
  window.addEventListener("pageshow", scroll);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("hashchange", scroll);
    window.removeEventListener("pageshow", scroll);
  };
}
