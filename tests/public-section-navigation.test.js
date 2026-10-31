import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { followPublicSection } from "../shared/public-section-navigation.js";

test("cross-page sections scroll after rendering and on history/hash navigation", () => {
  const { window } = new JSDOM("", { url: "https://school.test/#pricing" });
  let frame;
  window.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  window.cancelAnimationFrame = () => {};
  const stop = followPublicSection(window, window.document);
  window.document.body.innerHTML = '<section id="pricing"></section><section id="faq"></section>';
  const visited = [];
  for (const section of window.document.querySelectorAll("section"))
    section.scrollIntoView = () => visited.push(section.id);
  frame();
  assert.deepEqual(visited, ["pricing"]);
  window.history.replaceState(null, "", "/#faq");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  window.dispatchEvent(new window.Event("pageshow"));
  assert.deepEqual(visited, ["pricing", "faq", "faq"]);
  window.history.replaceState(null, "", "/#unknown");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  stop();
  window.history.replaceState(null, "", "/#pricing");
  window.dispatchEvent(new window.Event("pageshow"));
  assert.deepEqual(visited, ["pricing", "faq", "faq"]);
  window.close();
});
