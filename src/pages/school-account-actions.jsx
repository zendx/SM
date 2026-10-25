import { SCHOOL_ROLE_OPTIONS } from "../../shared/school-roles.js";
import React, { useId, useRef, useState } from "react";
import { LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { patch } from "../api";
import { Button, Modal, human } from "../components";
import "../account-menu.css";
import "./school-account-actions.css";

export function SchoolAccountEditor({ account, onClose, onSaved }) {
  const prefix = useId();
  const [values, setValues] = useState({
    name: account.name,
    phone_number: account.phone_number || "",
    address: account.address || "",
    role: account.role,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  function change(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }
  async function save(e) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await patch(`/users/${account.id}`, values);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Edit school account"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="account-profile" onSubmit={save}>
        <div className="school-account-action-summary">
          <UserRound size={23} />
          <div>
            <strong>{account.name}</strong>
            <span>{human(account.role)}</span>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="account-profile-fields" disabled={busy}>
          <legend className="account-sr-only">Account details</legend>
          <div className="account-field">
            <label htmlFor={`${prefix}-name`}>Full name</label>
            <input
              id={`${prefix}-name`}
              required
              maxLength={200}
              value={values.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </div>
          <div className="account-field">
            <label htmlFor={`${prefix}-phone`}>Phone number</label>
            <input
              id={`${prefix}-phone`}
              type="tel"
              maxLength={32}
              value={values.phone_number}
              placeholder="e.g. +234 801 234 5678"
              onChange={(e) => change("phone_number", e.target.value)}
            />
          </div>
          <div className="account-field account-field-wide">
            <label htmlFor={`${prefix}-email`}>
              Email address <LockKeyhole size={13} />
            </label>
            <input
              id={`${prefix}-email`}
              value={account.email}
              readOnly
              type="email"
            />
            <small>
              The sign-in email is fixed and cannot be changed here.
            </small>
          </div>
          <div className="account-field account-field-wide">
            <label htmlFor={`${prefix}-address`}>Address</label>
            <textarea
              id={`${prefix}-address`}
              rows={3}
              maxLength={500}
              value={values.address}
              onChange={(e) => change("address", e.target.value)}
            />
          </div>
          <div className="account-field account-field-wide">
            <label htmlFor={`${prefix}-role`}>Role</label>
            <select
              id={`${prefix}-role`}
              value={values.role}
              onChange={(e) => change("role", e.target.value)}
            >
              {SCHOOL_ROLE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <small>
              Role changes update this person's permissions. Saving ends
              existing sign-in sessions.
            </small>
          </div>
        </fieldset>
        <div className="account-profile-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !values.name.trim()}>
            {busy ? "Saving…" : "Save account changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function AccountStatusChange({ account, onClose, onChanged }) {
  const restore = account.status === "SUSPENDED";
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  const prefix = useId();
  async function save(e) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await patch(`/users/${account.id}`, {
        status: restore ? "ACTIVE" : "SUSPENDED",
        reason,
      });
      onChanged(
        restore
          ? "Account access restored."
          : "Account suspended. Existing sign-in sessions have ended.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={restore ? "Restore account access" : "Suspend account"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="school-account-status" onSubmit={save}>
        <div className="school-account-action-summary">
          <ShieldCheck size={23} />
          <div>
            <strong>{account.name}</strong>
            <span>{account.email}</span>
            <small>{human(account.role)}</small>
          </div>
        </div>
        <p>
          {restore
            ? "This person will be able to sign in again using their existing account."
            : "This person will be signed out immediately and unable to sign in. Their account and school records will stay in your user list."}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-field">
          <label htmlFor={`${prefix}-reason`}>
            Reason for {restore ? "restoration" : "suspension"}
          </label>
          <textarea
            id={`${prefix}-reason`}
            required
            maxLength={1000}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="account-profile-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !reason.trim()}>
            {busy ? "Saving…" : restore ? "Restore account" : "Suspend account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
