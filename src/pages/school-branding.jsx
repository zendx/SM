import React, { useState } from "react";
import { api } from "../api";
import { Button } from "../components";
function SchoolImage({ school, reloadConfig, signature = false }) {
  const kind = signature ? "signature" : "logo",
    label = signature ? "Administrator signature" : "School logo",
    image = school[`${kind}_data`];
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
        body.append(kind, file);
        await api(`/school/${kind}`, { method: "POST", body });
      } else await api(`/school/${kind}`, { method: "DELETE" });
      await reloadConfig();
      setMessage(`${label} ${file ? "updated" : "removed"}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="school-branding">
      <h3>{label}</h3>
      <p>
        {signature
          ? "Upload a scanned signature for report cards and official documents."
          : "Your logo appears in your school portal, invoices, payment receipts and report cards."}{" "}
        Upload a PNG or JPEG up to 256 KB and 2048 × 2048 pixels.
      </p>
      {image && <img className="school-logo" src={image} alt={label} />}
      <label>
        Upload {label.toLowerCase()}
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
      {image && (
        <Button secondary disabled={busy} onClick={() => update(null)}>
          Remove {kind}
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

export function SchoolBranding(props) {
  return (
    <>
      <SchoolImage {...props} />
      <SchoolImage {...props} signature />
    </>
  );
}
