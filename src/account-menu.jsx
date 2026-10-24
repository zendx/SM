import React, { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  UserRound,
  LogOut,
  ShieldCheck,
  LockKeyhole,
  CheckCircle2,
} from "lucide-react";
import { patch } from "./api";
import { Button, Modal, human } from "./components";
import "./account-menu.css";

const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
function AccountProfile({ user, onClose, onSaved }) {
  const [values, setValues] = useState({
    name: user.name,
    phone_number: user.phone_number || "",
    address: user.address || "",
  });
  const [baseline, setBaseline] = useState(values);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const prefix = useId();
  const dirty = Object.keys(values).some(
    (key) => values[key] !== baseline[key],
  );
  function change(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  }
  async function save(e) {
    e.preventDefault();
    if (saving.current || !dirty) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await patch("/auth/profile", values);
      const next = {
        name: result.name,
        phone_number: result.phone_number,
        address: result.address,
      };
      setValues(next);
      setBaseline(next);
      await onSaved(result);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Account management"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="account-profile" onSubmit={save}>
        <div className="account-profile-summary">
          <span className="account-avatar" aria-hidden="true">
            {initials(values.name || user.name)}
          </span>
          <div>
            <strong>{values.name || user.name}</strong>
            <span>
              {user.console_access ? "Owner console" : human(user.role)}
            </span>
          </div>
        </div>
        <div className="account-profile-intro">
          <h3>Personal information</h3>
          <p>
            Keep your contact details up to date. These details belong to your
            account.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <div className="account-saved" role="status">
            <CheckCircle2 size={18} /> Your account details have been saved.
          </div>
        )}
        <fieldset className="account-profile-fields" disabled={busy}>
          <legend className="account-sr-only">Personal information</legend>
          <div className="account-field">
            <label htmlFor={`${prefix}-name`}>
              Full name <span aria-hidden="true">*</span>
            </label>
            <input
              id={`${prefix}-name`}
              autoComplete="name"
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
              autoComplete="tel"
              maxLength={32}
              value={values.phone_number}
              onChange={(e) => change("phone_number", e.target.value)}
              placeholder="e.g. +234 801 234 5678"
              aria-describedby={`${prefix}-phone-help`}
            />
            <small id={`${prefix}-phone-help`}>
              Include your country code.
            </small>
          </div>
          <div className="account-field account-field-wide">
            <label htmlFor={`${prefix}-email`}>
              Email address <LockKeyhole size={13} aria-hidden="true" />
            </label>
            <input
              id={`${prefix}-email`}
              type="email"
              autoComplete="email"
              value={user.email}
              readOnly
              aria-describedby={`${prefix}-email-help`}
            />
            <small id={`${prefix}-email-help`}>
              This is your sign-in email and cannot be changed here.
            </small>
          </div>
          <div className="account-field account-field-wide">
            <label htmlFor={`${prefix}-address`}>Address</label>
            <textarea
              id={`${prefix}-address`}
              autoComplete="street-address"
              rows={3}
              maxLength={500}
              value={values.address}
              onChange={(e) => change("address", e.target.value)}
              placeholder="Street address, city, state and country"
            />
            <small>{values.address.length} / 500 characters</small>
          </div>
        </fieldset>
        <div className="account-profile-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            {dirty ? "Cancel" : "Done"}
          </Button>
          <Button
            type="submit"
            disabled={busy || !dirty || !values.name.trim()}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function AccountMenu({ user, onSaved, onLogout, onSecurity }) {
  const [open, setOpen] = useState(false),
    [profile, setProfile] = useState(false),
    [error, setError] = useState(""),
    [loggingOut, setLoggingOut] = useState(false);
  const root = useRef(null),
    trigger = useRef(null),
    menu = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("button")?.focus();
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function menuKeys(e) {
    const items = [...menu.current.querySelectorAll("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    const next = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      items[next]?.focus();
    }
  }
  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await onLogout();
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <>
      <div
        className="account-menu"
        ref={root}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <button
          ref={trigger}
          type="button"
          className={`account-trigger ${open ? "is-open" : ""}`}
          aria-label={`Account menu for ${user.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="account-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="account-trigger-copy">
            <strong>{user.name}</strong>
            <small>
              {user.console_access
                ? user.platform_operator
                  ? "Platform owner"
                  : "Console team"
                : human(user.role)}
            </small>
          </span>
          <ChevronDown
            className="account-chevron"
            size={15}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div
            ref={menu}
            id={menuId}
            className="account-dropdown"
            role="menu"
            aria-label="Your account"
            onKeyDown={menuKeys}
          >
            <div className="account-dropdown-identity" role="presentation">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setProfile(true);
                setError("");
              }}
            >
              <UserRound size={17} aria-hidden="true" />
              <span>
                Account management<small>Name and contact details</small>
              </span>
            </button>
            {onSecurity && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSecurity();
                }}
              >
                <ShieldCheck size={17} aria-hidden="true" />
                <span>
                  Account security
                  <small>Password and two-step verification</small>
                </span>
              </button>
            )}
            <div className="account-dropdown-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="account-logout"
              disabled={loggingOut}
              onClick={logout}
            >
              <LogOut size={17} aria-hidden="true" />
              <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
            </button>
            {error && (
              <p className="account-menu-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      {profile && (
        <AccountProfile
          user={user}
          onSaved={onSaved}
          onClose={() => {
            setProfile(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
