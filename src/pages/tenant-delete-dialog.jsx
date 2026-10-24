import React, { useRef, useState } from "react";
import { Trash2, ShieldAlert } from "lucide-react";
import { api } from "../api";
import { Button, Modal } from "../components";
import "./tenant-delete.css";

export function TenantDeleteDialog({ tenant, onClose, onDeleted }) {
  const [confirmation, setConfirmation] = useState(""),
    [password, setPassword] = useState(""),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false);
  async function remove(e) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/saas/owner/tenants/${tenant.school_id}`, {
        method: "DELETE",
        body: { confirmation, password, reason },
      });
      onDeleted(result.data.message);
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Delete tenant account"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="tenant-delete-form" onSubmit={remove}>
        <div className="tenant-delete-summary">
          <span>
            <Trash2 size={21} />
          </span>
          <div>
            <strong>{tenant.name}</strong>
            <small>/{tenant.portal_slug}/</small>
          </div>
        </div>
        <div className="tenant-delete-impact">
          <ShieldAlert size={20} />
          <div>
            <strong>This closes the school account immediately.</strong>
            <p>
              All school users will be signed out and unable to sign in.
              Automatic subscription renewal will be disabled.
            </p>
            <p>
              School records, payment history and email addresses are retained.
              Only the full owner can reactivate the account.
            </p>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy}>
          <label htmlFor="tenant-delete-reason">Reason for deletion</label>
          <textarea
            id="tenant-delete-reason"
            required
            maxLength={1000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record why you are closing this account"
          />
          <label htmlFor="tenant-delete-confirmation">
            Type the school name to confirm
          </label>
          <p className="tenant-delete-name">{tenant.name}</p>
          <input
            id="tenant-delete-confirmation"
            required
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            maxLength={250}
          />
          <label htmlFor="tenant-delete-password">Your owner password</label>
          <input
            id="tenant-delete-password"
            required
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </fieldset>
        <div className="tenant-delete-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="btn tenant-delete-confirm"
            disabled={
              busy ||
              confirmation.trim() !== tenant.name ||
              !reason.trim() ||
              !password
            }
          >
            <Trash2 size={15} />
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
