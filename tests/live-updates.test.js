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
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick;
  let pollInterval;
  globalThis.setInterval = (callback, interval) => {
    tick = callback;
    pollInterval = interval;
    return 1;
  };
  globalThis.clearInterval = () => {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url) =>
    new Promise((resolve) => requests.push({ url, resolve }));
  const { useLiveData } = await import("../src/live-updates.js");
  let query;
  function Screen({ path }) {
    query = useLiveData(path, null);
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
    assert.equal(pollInterval, 5000);
    await act(async () => {
      for (let i = 0; i < 10; i++) tick();
    });
    await respond(0, { body: "Initial response" });
    assert.equal(requests.length, 1, "automatic polls must not queue reads behind a slow request");
    await act(async () => tick());
    await act(async () => {
      for (let i = 0; i < 10; i++) query.reload();
    });
    assert.equal(
      requests.length,
      2,
      "refreshes must not overlap unfinished requests",
    );
    await respond(1, { body: "First response" });
    assert.equal(
      query.data.body,
      "First response",
      "refreshes must not discard slow responses",
    );
    assert.equal(requests.length, 3, "refreshes coalesce into one queued read");
    await act(async () =>
      root.render(React.createElement(Screen, { path: "/messages/2" })),
    );
    assert.equal(requests.length, 4);
    await respond(3, { body: "New conversation" });
    await respond(2, { body: "Stale conversation" });
    assert.equal(query.data.body, "New conversation");
    assert.equal(query.loading, false);
    assert.equal(query.error, "");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => tick());
    assert.equal(requests.length, 4, "hidden tabs must not poll");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => tick());
    assert.equal(requests.length, 4, "offline tabs must not poll");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new window.Event("online")));
    assert.equal(requests.length, 5, "reconnecting refreshes immediately");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
