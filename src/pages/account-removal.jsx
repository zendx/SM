import React, { useState, useRef } from "react";
import { Trash2, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Button, Modal } from "../components";
import "./account-removal.css";
export function AccountRemoval({ account, onClose, onRemoved }) {
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  async function remove(e) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/users/${account.id}`, {
        method: "DELETE",
        body: { reason },
      });
      onRemoved(result.data.message);
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Delete account"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="account-removal" onSubmit={remove}>
        <div className="account-removal-identity">
          <span>
            <Trash2 size={22} />
          </span>
          <div>
            <strong>{account.name}</strong>
            <small>{account.email}</small>
          </div>
        </div>
        <p>
          This account will disappear from your school's user list and any
          linked staff directory. Their current sessions will end and they will
          no longer be able to sign in.
        </p>
        <div className="account-retention-note">
          <ShieldCheck size={20} />
          <p>
            The SMPIS owner retains the profile and associated school records,
            including any employment, attendance and teaching records. Existing
            school records will be preserved.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-removal-reason">
          <label htmlFor="account-removal-reason">Reason for removal</label>
          <textarea
            id="account-removal-reason"
            required
            maxLength={1000}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this account is no longer needed"
          />
        </div>
        <label className="account-removal-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I understand this account will lose access to the school portal.
          </span>
        </label>
        <div className="account-removal-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="btn account-remove-confirm"
            disabled={busy || !confirmed || !reason.trim()}
          >
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
