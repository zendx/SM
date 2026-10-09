import React, { useEffect, useId, useRef, useState } from "react";
import {
  X,
  Eye,
  EyeOff,
  ChevronRight,
  Search,
  Plus,
  Download,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
export const human = (value) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Usd|Ngn)\b/g, (c) => c.toUpperCase());
export function Badge({ value }) {
  return (
    <span
      className={`badge ${["ENROLLED", "PAID", "PRESENT", "ACTIVE", "SENT"].includes(value) ? "green" : ["ABSENT", "OVERDUE", "REJECTED", "SUSPENDED", "FAILED"].includes(value) ? "red" : ["LATE", "PARTIAL", "FEES_PENDING"].includes(value) ? "amber" : ""}`}
    >
      {human(value)}
    </span>
  );
}
export function Button({
  children,
  secondary = false,
  small = false,
  ...props
}) {
  return (
    <button
      className={`btn ${secondary ? "secondary" : ""} ${small ? "small" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function PageHead({
  eyebrow = "WORKSPACE",
  title,
  description,
  children,
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="head-actions">{children}</div>
    </div>
  );
}
export function Empty({
  title = "Nothing here yet",
  description = "Records will appear here as your school gets started.",
  children,
}) {
  return (
    <div className="empty">
      <div className="empty-mark">◇</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon: Icon,
  onClick,
  tone = "",
}) {
  return (
    <button className={`metric ${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="metric-top">
        {label}
        {Icon && <Icon size={19} />}
      </span>
      <strong>{value}</strong>
      <span className="metric-detail">
        {detail}
        {onClick && <ArrowUpRight size={15} />}
      </span>
    </button>
  );
}
export function Table({ columns, rows, keyField = "id", empty }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[keyField] ?? i}>
              {columns.map((c) => (
                <td key={c.label}>
                  {c.render ? c.render(r) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty {...empty} />
  );
}
export function Person({ first, last, sub, onClick }) {
  return (
    <div className="person">
      <span className="avatar">
        {first?.[0]}
        {last?.[0]}
      </span>
      <div>
        {onClick ? (
          <button className="text-button" onClick={onClick}>
            {first} {last}
          </button>
        ) : (
          <strong>
            {first} {last}
          </strong>
        )}
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Form({
  fields,
  initial = {},
  onSubmit,
  submit = "Save",
  children,
}) {
  const idPrefix = useId();
  const [values, setValues] = useState(() =>
      Object.fromEntries(
        fields.map((f) => [
          f.name,
          initial[f.name] ?? f.default ?? (f.type === "checkbox" ? false : ""),
        ]),
      ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visiblePasswords, setVisiblePasswords] = useState({});
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      for (const field of fields)
        if (field.matches && values[field.name] !== values[field.matches])
          throw new Error(
            "Passwords do not match. Please enter the same password in both fields.",
          );
      await onSubmit(
        Object.fromEntries(
          Object.entries(values).filter(
            ([name]) =>
              !fields.find((field) => field.name === name)?.clientOnly,
          ),
        ),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="form-grid">
        {fields.map((f) =>
          f.type === "password" ? (
            <div className={`field ${f.wide ? "wide" : ""}`} key={f.name}>
              <label htmlFor={`${idPrefix}-${f.name}`}>
                {f.label}
                {f.required !== false && <b> *</b>}
              </label>
              <div className="password-input-wrap">
                <input
                  id={`${idPrefix}-${f.name}`}
                  type={visiblePasswords[f.name] ? "text" : "password"}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                  required={f.required !== false}
                  minLength={f.minLength}
                  maxLength={f.maxLength}
                  placeholder={f.placeholder}
                  autoComplete={f.autoComplete}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={
                    visiblePasswords[f.name] ? "Hide password" : "Show password"
                  }
                  aria-pressed={!!visiblePasswords[f.name]}
                  aria-controls={`${idPrefix}-${f.name}`}
                  title={
                    visiblePasswords[f.name] ? "Hide password" : "Show password"
                  }
                  onClick={() =>
                    setVisiblePasswords((shown) => ({
                      ...shown,
                      [f.name]: !shown[f.name],
                    }))
                  }
                >
                  {visiblePasswords[f.name] ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
              {f.hint && <small>{f.hint}</small>}
            </div>
          ) : (
            <label
              className={`field ${f.wide ? "wide" : ""} ${f.type === "checkbox" ? "check-field" : ""}`}
              key={f.name}
            >
              <span>
                {f.label}
                {(f.type === "checkbox" ? f.required === true : f.required !== false) && <b> *</b>}
              </span>
              {f.options ? (
                <select
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                  required={f.required !== false}
                >
                  <option value="">Select {f.label.toLowerCase()}</option>
                  {f.options.map((o) => (
                    <option
                      key={typeof o === "object" ? o.value : o}
                      value={typeof o === "object" ? o.value : o}
                    >
                      {typeof o === "object" ? o.label : human(o)}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                  required={f.required !== false}
                />
              ) : (
                <input
                  type={f.type || "text"}
                  value={f.type === "checkbox" ? undefined : values[f.name]}
                  checked={f.type === "checkbox" ? !!values[f.name] : undefined}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [f.name]:
                        f.type === "checkbox"
                          ? e.target.checked
                          : e.target.value,
                    })
                  }
                  required={
                    f.type === "checkbox"
                      ? f.required === true
                      : f.required !== false
                  }
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  minLength={f.minLength}
                  maxLength={f.maxLength}
                  placeholder={f.placeholder}
                  autoComplete={f.autoComplete}
                />
              )}{" "}
              {f.hint && <small>{f.hint}</small>}
            </label>
          ),
        )}
      </div>
      {children}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-footer">
        <Button disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={16} />
              Saving…
            </>
          ) : (
            submit
          )}
        </Button>
      </div>
    </form>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" /> Loading your workspace…
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search records…",
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
export function Trend({ data, currency = false, money }) {
  if (!data.length)
    return (
      <div className="chart-empty">
        <span>No trend data yet</span>
        <small>Activity recorded during this term will appear here.</small>
      </div>
    );
  const max = Math.max(...data.map((d) => Number(d.value)), currency ? 1 : 100);
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div className="bar-item" key={d.date}>
          <span className="bar-value">
            {currency ? money(d.value) : `${d.value}%`}
          </span>
          <div className="bar-track">
            <div
              className="bar"
              style={{
                height: `${Math.max(2, (Number(d.value) / max) * 100)}%`,
              }}
            />
          </div>
          <small>{String(d.date).slice(5)}</small>
        </div>
      ))}
    </div>
  );
}
