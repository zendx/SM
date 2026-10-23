import React, { useState } from "react";
import { api } from "../api";
import { Button } from "../components";
export function SchoolBranding({ school, reloadConfig }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function update(file) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (file) {
        const body = new FormData();
        body.append("logo", file);
        await api("/school/logo", { method: "POST", body });
      } else await api("/school/logo", { method: "DELETE" });
      await reloadConfig();
      setMessage(file ? "School logo updated." : "School logo removed.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="school-branding">
      <h3>School logo</h3>
      <p>
        Your logo appears in your school portal, invoices, payment receipts and
        report cards. Upload a PNG or JPEG up to 256 KB and 2048 × 2048 pixels.
      </p>
      {school.logo_data && (
        <img
          className="school-logo"
          src={school.logo_data}
          alt={`${school.name} logo`}
        />
      )}
      <label>
        Upload school logo
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) update(f);
            e.target.value = "";
          }}
        />
      </label>
      {school.logo_data && (
        <Button secondary disabled={busy} onClick={() => update(null)}>
          Remove logo
        </Button>
      )}
      {error && <p className="form-error">{error}</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
