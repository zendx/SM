import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./api.js";

// Polling must not invalidate an unfinished response: its round trip may take
// longer than the polling interval on a mobile connection or a remote database.
export function useLiveData(path, initial = [], interval = 1000) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(null);
  const reload = useCallback(() => current.current?.load(), []);
  useEffect(() => {
    const request = { alive: true, pending: null, queued: false };
    request.load = () => {
      if (!request.alive || !path) return Promise.resolve();
      if (request.pending) {
        request.queued = true;
        return request.pending;
      }
      request.pending = get(path)
        .then((value) => {
          if (request.alive) {
            setData(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (request.alive) setError(cause.message);
        })
        .finally(() => {
          request.pending = null;
          if (!request.alive) return;
          setLoading(false);
          if (request.queued) {
            request.queued = false;
            if (document.visibilityState !== "hidden" && navigator.onLine)
              request.load();
          }
        });
      return request.pending;
    };
    current.current = request;
    setData(initial);
    setError("");
    setLoading(Boolean(path));
    request.load();
    return () => {
      request.alive = false;
      if (current.current === request) current.current = null;
    };
  }, [path]);
  useLiveUpdates(reload, interval);
  return { data, error, loading, reload, setData };
}

export function useLiveUpdates(refresh, interval = 3000) {
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    };
    const timer = setInterval(update, interval);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("focus", update);
    };
  }, [refresh, interval]);
}
