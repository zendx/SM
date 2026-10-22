import React, { useEffect, useState } from "react";
import { get, post } from "./api";
import { Button, Modal, human } from "./components";

export function TeacherAttendancePrompt({ notify }) {
  const [today, setToday] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    let alive = true;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try {
        const result = await get("/attendance/staff/today");
        if (alive) { setToday(result); setError(""); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (today?.attendance || (today && dismissed === today.date)) return null;
  if (!today && (!error || dismissed === "unavailable")) return null;
  const eligible = today?.staff?.status === "ACTIVE";
  return (
    <Modal title="Your attendance today" onClose={() => { if (!busy) setDismissed(today?.date || "unavailable"); }}>
      {today && <p>{today.date} · {today.timezone}</p>}
      {eligible ? (
        <>
          <p>Hello {today.staff.first_name}. Select Present to record your arrival. Your school records the date and time automatically.</p>
          <p>Arrival after the school’s staff start time is recorded as late.</p>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const attendance = await post("/attendance/staff/check-in", {});
              setToday((current) => ({ ...current, attendance }));
              notify(`Attendance saved: ${human(attendance.status)}.`);
            } catch (e) {
              if (e.status === 409) {
                try {
                  setToday(await get("/attendance/staff/today"));
                } catch (refreshError) { setError(refreshError.message); }
              } else setError(e.message);
            } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Present"}</Button>
        </>
      ) : today ? (
        <p>Your staff profile is inactive. Please contact your school administrator to restore attendance access.</p>
      ) : null}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
