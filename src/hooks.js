import { useState, useEffect } from "react";
import { get } from "./api";
export function useData(path, initial = []) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    if (!path) {
      setLoading(false);
      return;
    }
    get(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, version]);
  return {
    data,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
    setData,
  };
}
