import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

test("slow messaging reads survive refreshes and ignore responses from a previous conversation", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://school.test/greenfield/",
    pretendToBeVisual: true,
  });
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url) =>
    new Promise((resolve) => requests.push({ url, resolve }));
  const { useLiveData } = await import("../src/live-updates.js");
  let query;
  function Screen({ path }) {
    query = useLiveData(path, null, 60000);
    return React.createElement("p", null, JSON.stringify(query.data));
  }
  const root = createRoot(document.getElementById("root"));
  const respond = async (index, data) =>
    act(async () => {
      requests[index].resolve({
        ok: true,
        status: 200,
        json: async () => ({ data }),
      });
    });
  try {
    await act(async () =>
      root.render(React.createElement(Screen, { path: "/messages/1" })),
    );
    await act(async () => {
      for (let i = 0; i < 10; i++) query.reload();
    });
    assert.equal(
      requests.length,
      1,
      "refreshes must not overlap unfinished requests",
    );
    await respond(0, { body: "First response" });
    assert.equal(
      query.data.body,
      "First response",
      "refreshes must not discard slow responses",
    );
    assert.equal(requests.length, 2, "refreshes coalesce into one queued read");
    await act(async () =>
      root.render(React.createElement(Screen, { path: "/messages/2" })),
    );
    assert.equal(requests.length, 3);
    await respond(2, { body: "New conversation" });
    await respond(1, { body: "Stale conversation" });
    assert.equal(query.data.body, "New conversation");
    assert.equal(query.loading, false);
    assert.equal(query.error, "");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
