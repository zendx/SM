import { useEffect } from "react";

export function useLiveUpdates(refresh, interval = 3000) {
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    };
    const timer = setInterval(update, interval);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
    };
  }, [refresh, interval]);
}
