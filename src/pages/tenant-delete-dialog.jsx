import React, { useRef, useState } from "react";
import { Trash2, ShieldAlert } from "lucide-react";
import { api } from "../api";
import { Button, Modal } from "../components";
import "./tenant-delete.css";

export function TenantDeleteDialog({ tenant, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false);
  async function remove(e) {
    e.preventDefault();
    if (sending.current) return;
    const form = e.currentTarget;
    const confirmation = String(
      new FormData(form).get("confirmation") || "",
    ).trim();
    if (!confirmation || confirmation !== tenant.name.trim()) {
      setError(
        !confirmation
          ? "Retype the school name to confirm deletion."
          : "The school name does not match. Type the name shown above exactly.",
      );
      form.elements.namedItem("confirmation")?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/saas/owner/tenants/${tenant.school_id}`, {
        method: "DELETE",
        body: { confirmation },
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
      <form className="tenant-delete-form" onSubmit={remove} noValidate>
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
        <fieldset disabled={busy}>
          <label htmlFor="tenant-delete-confirmation">
            Retype the school name
          </label>
          <p id="tenant-delete-help" className="tenant-delete-help">
            Type <strong>{tenant.name}</strong> to confirm deletion.
          </p>
          <input
            id="tenant-delete-confirmation"
            name="confirmation"
            type="text"
            required
            maxLength={250}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            defaultValue=""
            aria-invalid={!!error}
            aria-describedby={`tenant-delete-help${error ? " tenant-delete-error" : ""}`}
            onChange={() => setError("")}
          />
          {error && (
            <p
              id="tenant-delete-error"
              className="tenant-delete-field-error"
              role="alert"
            >
              {error}
            </p>
          )}
        </fieldset>
        <div className="tenant-delete-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="btn tenant-delete-confirm"
            disabled={busy}
          >
            <Trash2 size={15} />
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
