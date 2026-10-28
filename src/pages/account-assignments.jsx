import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { SCHOOL_ROLE_OPTIONS } from "../../shared/school-roles.js";
import { useData } from "../hooks";
import { patch } from "../api";
import { Button, Form, Modal } from "../components";
import "./account-assignments.css";

function AssignmentPicker({
  role,
  value,
  onChange,
  accountId,
  disabled,
  onLoaded,
}) {
  const q = useData(
    `/users/assignment-options?role=${role}${accountId ? `&account_id=${accountId}` : ""}`,
    null,
  );
  const [search, setSearch] = useState("");
  const seeded = useRef(false),
    prefix = useId();
  const teacher = role === "TEACHER",
    noun = teacher ? "classes" : "children";
  useEffect(() => {
    if (accountId && q.data && !seeded.current) {
      seeded.current = true;
      onChange(q.data.selected_ids);
      onLoaded?.();
    }
  }, [q.data, accountId, onChange, onLoaded]);
  const options = q.data?.options || [];
  const chosen = new Set(value);
  const filtered = options.filter((o) =>
    `${o.label} ${o.detail} ${o.assigned_name || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const visible = filtered.slice(0, 100);
  const toggle = (id) =>
    onChange(chosen.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset className="assignment-picker" disabled={disabled}>
      <legend>
        {teacher ? "Assign classes" : "Link children"} <span>(optional)</span>
      </legend>
      <p>
        Select as many {noun} as needed, or leave this empty. You can manage
        these links later from User accounts.
      </p>
      <div className="assignment-summary">
        <strong role="status" aria-live="polite">
          {value.length} selected
        </strong>
        {q.data && !q.loading && (
          <button type="button" className="text-button" onClick={q.reload}>
            Refresh list
          </button>
        )}
        {value.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange([])}
          >
            Clear selection
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="assignment-chips" aria-label={`Selected ${noun}`}>
          {options
            .filter((o) => chosen.has(o.id))
            .map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => toggle(o.id)}
                aria-label={`Remove ${o.label} ${o.detail || ""}`}
                title={o.detail}
              >
                {o.label}
                <X size={14} aria-hidden="true" />
              </button>
            ))}
        </div>
      )}
      <label className="assignment-search" htmlFor={`${prefix}-search`}>
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">Search {noun}</span>
        <input
          id={`${prefix}-search`}
          type="search"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            teacher
              ? "Search class or academic year"
              : "Search child, student number or class"
          }
        />
      </label>
      {q.loading && <p role="status">Loading {noun}…</p>}
      {q.error && (
        <div role="alert">
          <p className="form-error">{q.error}</p>
          <Button type="button" secondary small onClick={q.reload}>
            Try again
          </Button>
        </div>
      )}
      {!q.error && !q.loading && (
        <>
          <div
            className="assignment-options"
            role="group"
            aria-label={`Choose ${noun}`}
          >
            {visible.map((o) => {
              const unavailable =
                o.assigned_to != null && o.assigned_to !== accountId;
              return (
                <label
                  key={o.id}
                  className={`assignment-option ${unavailable ? "is-unavailable" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(o.id)}
                    disabled={unavailable}
                    onChange={() => toggle(o.id)}
                  />
                  <span>
                    <strong>{o.label}</strong>
                    <small>{o.detail}</small>
                    {unavailable && (
                      <small>
                        {teacher ? "Assigned" : "Linked"} to{" "}
                        {o.assigned_name || "another account"}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
            {!visible.length && (
              <p className="assignment-empty">
                {options.length
                  ? "No matches. Try another name or class."
                  : `No ${noun} yet. You can add these links later.`}
              </p>
            )}
          </div>
          {filtered.length > 100 && (
            <p>
              Showing the first 100 matches. Use search to find more {noun}.
            </p>
          )}
          {options.some(
            (o) => o.assigned_to != null && o.assigned_to !== accountId,
          ) && (
            <p className="assignment-help">
              To change a link belonging to someone else, use the{" "}
              {teacher ? "class" : "student"} record first.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

export function CreateSchoolAccount({ onSubmit }) {
  const [role, setRole] = useState(""),
    [selected, setSelected] = useState([]),
    [busy, setBusy] = useState(false);
  const currentRole = useRef(""),
    saving = useRef(false);
  const changed = useCallback((values) => {
    if (currentRole.current !== values.role) {
      currentRole.current = values.role;
      setRole(values.role);
      setSelected([]);
    }
  }, []);
  return (
    <Form
      submit="Create account"
      fields={[
        { name: "name", label: "Full name", wide: true, maxLength: 250 },
        { name: "email", label: "Email address", type: "email", wide: true },
        {
          name: "role",
          label: "Role",
          options: SCHOOL_ROLE_OPTIONS,
          wide: true,
        },
      ]}
      onValuesChange={changed}
      onSubmit={async (values) => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
          await onSubmit({
            ...values,
            ...(values.role === "TEACHER"
              ? { class_ids: selected }
              : values.role === "PARENT"
                ? { student_ids: selected }
                : {}),
          });
        } finally {
          saving.current = false;
          setBusy(false);
        }
      }}
    >
      {["TEACHER", "PARENT"].includes(role) && (
        <AssignmentPicker
          key={role}
          role={role}
          value={selected}
          onChange={setSelected}
          disabled={busy}
        />
      )}
    </Form>
  );
}

export function AccountAssignmentsEditor({ account, onClose, onSaved }) {
  const [selected, setSelected] = useState([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    loaded = useCallback(() => setReady(true), []);
  const teacher = account.role === "TEACHER";
  return (
    <Modal
      title={`${teacher ? "Assign classes" : "Link children"} — ${account.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || saving.current) return;
          saving.current = true;
          setBusy(true);
          setError("");
          try {
            await patch(
              `/users/${account.id}/assignments`,
              teacher ? { class_ids: selected } : { student_ids: selected },
            );
            await onSaved();
          } catch (e) {
            setError(e.message);
          } finally {
            saving.current = false;
            setBusy(false);
          }
        }}
      >
        <AssignmentPicker
          role={account.role}
          accountId={account.id}
          value={selected}
          onChange={setSelected}
          disabled={busy}
          onLoaded={loaded}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="assignment-footer">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? "Saving…" : "Save assignments"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
