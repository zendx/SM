import React, { useEffect, useState } from "react";
import {
  Building2,
  ChevronDown,
  Search,
  Users,
  ShieldCheck,
  Download,
  ArrowUpRight,
} from "lucide-react";
import { useData } from "../hooks";
import { api } from "../api";
import { Badge, Button, Loading, Modal, human } from "../components";
import "./owner-school-accounts.css";

function SchoolUsers({ school, revision, onManage, onRetained }) {
  const [search, setSearch] = useState(""),
    [role, setRole] = useState(""),
    [state, setState] = useState("current"),
    [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const q = useData(
    `/saas/owner/users?school_id=${school.id}&search=${encodeURIComponent(query)}&role=${role}&state=${state}&page=${page}&revision=${revision}`,
    null,
  );
  return (
    <section
      className="school-account-users"
      aria-label={`${school.name} accounts`}
    >
      <div
        className="school-user-tabs"
        role="group"
        aria-label="Account records"
      >
        <button
          type="button"
          aria-pressed={state === "current"}
          className={state === "current" ? "active" : ""}
          onClick={() => {
            setState("current");
            setPage(1);
          }}
        >
          Current accounts <span>{school.user_count}</span>
        </button>
        <button
          type="button"
          aria-pressed={state === "retained"}
          className={state === "retained" ? "active" : ""}
          onClick={() => {
            setState("retained");
            setPage(1);
          }}
        >
          Retained accounts <ShieldCheck size={14} />
          <span>{school.retained_count}</span>
        </button>
        <a href={`/${school.portal_slug}/`} target="_blank" rel="noreferrer">
          Open school portal <ArrowUpRight size={13} />
        </a>
      </div>
      {state === "retained" && (
        <p className="school-retained-note">
          <ShieldCheck size={16} /> Removed from the school. Records remain
          available to the full owner.
        </p>
      )}
      <div className="school-user-filters">
        <label className="school-account-search">
          <Search size={16} />
          <span className="school-account-sr">
            Search users in {school.name}
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a person by name or email"
          />
        </label>
        <label>
          <span className="school-account-sr">
            Filter role in {school.name}
          </span>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {(q.data?.roles || []).map((r) => (
              <option key={r} value={r}>
                {human(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {q.error && (
        <p className="form-error" role="alert">
          {q.error}
        </p>
      )}
      {q.loading && !q.data ? (
        <Loading />
      ) : (
        q.data && (
          <>
            <div className="school-user-list" aria-busy={q.loading}>
              {q.data.users.map((u) => (
                <div className="school-user-row" key={u.id}>
                  <span
                    className={`school-user-avatar ${u.archived_at ? "is-archived" : ""}`}
                    aria-hidden="true"
                  >
                    {u.name
                      .split(/\s+/)
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="school-user-identity">
                    <strong>{u.name}</strong>
                    <span>{u.email}</span>
                    <small>
                      {u.archived_at
                        ? `Removed ${new Date(u.archived_at).toLocaleDateString()}`
                        : u.mfa_enabled
                          ? "Two-step verification enabled"
                          : "Two-step verification not enabled"}
                    </small>
                  </div>
                  <span className="school-user-role">{human(u.role)}</span>
                  <Badge value={u.archived_at ? "ARCHIVED" : u.status} />
                  <Button
                    small
                    secondary
                    onClick={() =>
                      u.archived_at ? onRetained(u) : onManage(u, q.data.roles)
                    }
                  >
                    {u.archived_at ? "View retained record" : "Manage account"}
                  </Button>
                </div>
              ))}
              {!q.data.users.length && (
                <div className="school-account-empty">
                  <Users size={24} />
                  <strong>
                    {state === "retained"
                      ? "No matching retained accounts"
                      : "No matching accounts"}
                  </strong>
                  <p>
                    {search || role
                      ? "Try a different name or role."
                      : state === "retained"
                        ? "Accounts deleted by this school will appear here."
                        : "This school has no current user accounts."}
                  </p>
                </div>
              )}
            </div>
            <div className="school-user-pagination">
              <span>
                {q.data.total}{" "}
                {state === "retained" ? "retained records" : "accounts"}
              </span>
              {q.data.total > 50 && (
                <>
                  <Button
                    secondary
                    small
                    disabled={page === 1 || q.loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous users
                  </Button>
                  <span>
                    {page} / {Math.ceil(q.data.total / 50)}
                  </span>
                  <Button
                    secondary
                    small
                    disabled={page * 50 >= q.data.total || q.loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next users
                  </Button>
                </>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
export function OwnerSchoolAccounts({ revision, onManage, onRetained }) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState(null);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
      setExpanded(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const q = useData(
    `/saas/owner/account-schools?search=${encodeURIComponent(query)}&page=${page}&revision=${revision}`,
    null,
  );
  return (
    <div className="school-account-browser">
      <div className="school-account-toolbar">
        <label className="school-account-search">
          <Search size={17} />
          <span className="school-account-sr">Search customer schools</span>
          <input
            placeholder="Search a school, administrator or user"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span>{q.data?.total ?? "…"} schools</span>
      </div>
      {q.error && (
        <p className="form-error" role="alert">
          {q.error}
        </p>
      )}
      {q.loading && !q.data ? (
        <Loading />
      ) : (
        q.data && (
          <>
            <div className="school-account-cards" aria-busy={q.loading}>
              {q.data.schools.map((s) => (
                <article
                  className={`school-account-card ${expanded === s.id ? "is-expanded" : ""}`}
                  key={s.id}
                >
                  <button
                    className="school-account-heading"
                    type="button"
                    aria-expanded={expanded === s.id}
                    aria-controls={`school-accounts-${s.id}`}
                    onClick={() =>
                      setExpanded((current) => (current === s.id ? null : s.id))
                    }
                  >
                    <span className="school-account-mark">
                      <Building2 size={21} />
                    </span>
                    <span className="school-account-identity">
                      <strong>{s.name}</strong>
                      <span>
                        {s.administrator?.name || "No administrator assigned"}
                      </span>
                      <small>
                        {s.administrator?.email || `/${s.portal_slug}/`}
                      </small>
                    </span>
                    <span className="school-account-overview">
                      <span className="school-account-count">
                        <Users size={15} />
                        {s.user_count} accounts
                        {s.retained_count > 0 && (
                          <small> · {s.retained_count} retained</small>
                        )}
                      </span>
                      <span className="school-account-role-counts">
                        {Object.entries(s.role_counts)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 3)
                          .map(([role, count]) => (
                            <span key={role}>
                              {count} {human(role)}
                            </span>
                          ))}
                      </span>
                    </span>
                    <Badge
                      value={s.closed_at ? "DELETED" : s.status || "ACTIVE"}
                    />
                    <ChevronDown className="school-account-caret" size={18} />
                  </button>
                  {expanded === s.id && (
                    <div id={`school-accounts-${s.id}`}>
                      <SchoolUsers
                        school={s}
                        revision={revision}
                        onManage={onManage}
                        onRetained={onRetained}
                      />
                    </div>
                  )}
                </article>
              ))}
              {!q.data.schools.length && (
                <div className="school-account-empty">
                  <Building2 size={28} />
                  <strong>No matching schools</strong>
                  <p>
                    Search by school name, administrator or a user's email
                    address.
                  </p>
                </div>
              )}
            </div>
            <div className="school-account-pagination">
              <span>
                Page {page} of {Math.max(1, Math.ceil(q.data.total / 20))}
              </span>
              <Button
                small
                secondary
                disabled={page === 1 || q.loading}
                onClick={() => {
                  setPage((p) => p - 1);
                  setExpanded(null);
                }}
              >
                Previous
              </Button>
              <Button
                small
                secondary
                disabled={page * 20 >= q.data.total || q.loading}
                onClick={() => {
                  setPage((p) => p + 1);
                  setExpanded(null);
                }}
              >
                Next
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
export function RetainedAccountRecord({ user, onClose }) {
  const q = useData(`/saas/owner/users/${user.id}/retained-record`, null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const record = await api(
        `/saas/owner/users/${user.id}/retained-record?download=1`,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(record, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `retained-account-${user.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function downloadDocument(doc) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/saas/owner/users/${user.id}/retained-documents/${doc.id}`,
      );
      if (!response.ok)
        throw new Error("Unable to download this document. Please try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const d = q.data;
  return (
    <Modal title="Retained account record" onClose={onClose}>
      {q.error && <p className="form-error">{q.error}</p>}
      {!d && !q.error && <Loading />}
      {d && (
        <div className="retained-account-record">
          <div className="retained-record-identity">
            <ShieldCheck size={24} />
            <div>
              <strong>{d.user.name}</strong>
              <span>{d.user.school_name}</span>
              <small>{d.user.email}</small>
            </div>
            <Badge value="ARCHIVED" />
          </div>
          <section className="retained-record-section">
            <h3>Removal details</h3>
            <dl>
              <div>
                <dt>Removed on</dt>
                <dd>{new Date(d.user.archived_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Removed by</dt>
                <dd>{d.user.archived_by_name || "School administrator"}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{d.user.archive_reason}</dd>
              </div>
            </dl>
          </section>
          <section className="retained-record-section">
            <h3>Account & employment details</h3>
            <dl>
              {[
                ["Phone", d.user.phone_number],
                ["Address", d.user.address],
                ["Staff number", d.staff?.staff_number],
                ["Department", d.staff?.department],
                ["Position", d.staff?.position],
                [
                  "Employment type",
                  d.staff?.employment_type
                    ? human(d.staff.employment_type)
                    : "",
                ],
                ["Hire date", d.staff?.hire_date],
                ["Qualifications", d.profile?.qualifications],
                ["Certifications", d.profile?.certifications],
                ["Employment history", d.profile?.employment_history],
                ["Contract notes", d.profile?.contract_notes],
                ["Training", d.profile?.training],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          </section>
          <div className="retained-record-counts">
            {[
              ["Attendance entries", d.counts.attendance],
              ["Leave requests", d.counts.leave_requests],
              ["Performance reviews", d.counts.reviews],
              ["Document records", d.counts.documents],
            ].map(([label, count]) => (
              <div key={label}>
                <strong>{count}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {d.linked_students?.length > 0 && (
            <section className="retained-record-section">
              <h3>Linked students at deletion</h3>
              {d.linked_students.map((child) => (
                <p key={child.id}>
                  {child.first_name} {child.last_name}
                  <small>
                    {child.student_number || "Student"}
                    {child.class_name ? ` ? ${child.class_name}` : ""}
                  </small>
                </p>
              ))}
            </section>
          )}
          {d.assignments.length > 0 && (
            <section className="retained-record-section">
              <h3>Teaching assignments</h3>
              {d.assignments.map((a) => (
                <p key={a.id}>
                  {a.class_name} · {a.subject_name}
                  <small>{a.academic_year}</small>
                </p>
              ))}
            </section>
          )}
          {d.documents.length > 0 && (
            <section className="retained-record-section">
              <h3>Original documents</h3>
              <div className="retained-record-documents">
                {d.documents.map((doc) => (
                  <div key={doc.id}>
                    <span>
                      <strong>{doc.name}</strong>
                      <small>
                        {human(doc.category)} ?{" "}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </small>
                    </span>
                    <Button
                      small
                      secondary
                      disabled={busy}
                      onClick={() => downloadDocument(doc)}
                    >
                      Download document
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="retained-record-help">
            This record preserves the information saved when the account was
            deleted. It is read-only and hidden from the school. The download
            includes retained attendance, leave and review records, plus
            document metadata. Original uploaded documents remain stored.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="retained-record-actions">
            <Button secondary onClick={onClose}>
              Close
            </Button>
            <Button disabled={busy} onClick={download}>
              <Download size={15} />
              {busy ? "Preparing…" : "Download retained record"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
