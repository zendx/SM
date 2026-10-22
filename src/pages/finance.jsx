import { SchoolPayments } from "./school-payments";
import React, { useState, useEffect } from "react";
import {
  Plus,
  Wallet,
  Download,
  Receipt,
  Percent,
  ArrowUpRight,
} from "lucide-react";
import { get, post, patch } from "../api";
import { useData } from "../hooks";
import {
  PageHead,
  Button,
  Panel,
  Table,
  Person,
  Badge,
  Modal,
  Form,
  Metric,
  human,
  Empty,
  Loading,
} from "../components";
export function Finance({ can, term, config, money, notify }) {
  const gateway = useData("/payments/config", null),
    transactions = useData("/payments/transactions"),
    [batchResult, setBatchResult] = useState(null),
    [paymentStatus, setPaymentStatus] = useState("");
  async function verifyGateway(reference) {
    try {
      const result = await post("/payments/paystack/verify", { reference });
      setPaymentStatus(
        result.status === "PAID"
          ? "Payment verified and credited to your invoice."
          : result.status === "TEST_CONFIRMED"
            ? "Test payment confirmed. No real invoice balance was changed."
            : result.status === "REVIEW"
              ? result.review_note
              : "Payment is awaiting confirmation. You can check again shortly.",
      );
      q.reload();
      transactions.reload();
    } catch (e) {
      setPaymentStatus(e.message);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search),
      reference = params.get("payment_reference");
    if (reference) {
      verifyGateway(reference);
      params.delete("payment_reference");
      params.delete("reference");
      params.delete("trxref");
      history.replaceState(
        null,
        "",
        location.pathname + (params.size ? "?" + params : "") + location.hash,
      );
    }
  }, []);
  const q = useData(`/finance/invoices?term_id=${term}`),
    students = useData(can("finance.read") ? "/finance/students" : null),
    fees = useData(can("finance.read") ? "/finance/fee-structures" : null),
    classes = useData(can("finance.read") ? "/classes" : null);
  const [tab, setTab] = useState("invoices"),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState(""),
    [feeClassId, setFeeClassId] = useState(""),
    [feeTermId, setFeeTermId] = useState("");
  const feeClass = classes.data.find((c) => String(c.id) === feeClassId);
  const feeTerms = config.terms.filter((t) => t.academic_year_id === feeClass?.academic_year_id);
  const classFees = fees.data
    .filter((f) => String(f.class_id) === feeClassId && (!feeTermId || String(f.term_id) === feeTermId))
    .sort((a, b) => {
      const termA = config.terms.find((t) => t.id === a.term_id);
      const termB = config.terms.find((t) => t.id === b.term_id);
      return String(termA?.start_date || "").localeCompare(String(termB?.start_date || "")) || a.fee_category.localeCompare(b.fee_category);
    });
  const classLabel = (c) => `${c.name} / ${config.years.find((y) => y.id === c.academic_year_id)?.name || "Academic year"}`;
  function openFee(row = null) {
    const defaultTerm = feeTermId || String(feeTerms.find((t) => String(t.id) === String(term))?.id || feeTerms[0]?.id || term || "");
    setModal({ type: "fee", row: row || { class_id: feeClassId, term_id: defaultTerm } });
  }
  const options = students.data.map((s) => ({
    value: s.id,
    label: `${s.first_name} ${s.last_name}${s.student_number ? ` · ${s.student_number}` : ""}`,
  }));
  const billed = q.data.reduce(
      (a, i) => a + (i.waived ? 0 : Number(i.total_cents)),
      0,
    ),
    paid = q.data.reduce((a, i) => a + Number(i.paid_cents), 0),
    outstanding = q.data.reduce((a, i) => a + Number(i.balance_cents), 0);
  async function save(path, v, method = post) {
    const result = await method(path, v);
    q.reload();
    fees.reload();
    students.reload();
    setModal(null);
    if (selected) setSelected(await get(`/finance/invoices/${selected.id}`));
    notify(result.message || "Finance records updated.");
  }
  async function view(i) {
    try {
      setSelected(await get(`/finance/invoices/${i.id}`));
    } catch (e) {
      notify(e.message);
    }
  }
  const invoiceOptions = q.data
    .filter((i) => i.balance_cents > 0)
    .map((i) => ({
      value: i.id,
      label: `${i.invoice_number} · ${i.first_name} ${i.last_name}`,
    }));
  return (
    <>
      <PageHead
        title="Finance"
        description="Set school fees, issue invoices, record payments and see what is still owed."
      >
        {can("finance.write") && (
          <>
            <Button secondary onClick={() => setModal({ type: "batch" })}>
              Batch invoices
            </Button>
            <Button secondary onClick={() => setModal({ type: "invoice" })}>
              <Plus size={17} />
              Generate invoice
            </Button>
            <Button
              onClick={() =>
                setModal({ type: "payment", key: crypto.randomUUID() })
              }
            >
              <Plus size={17} />
              Record payment
            </Button>
          </>
        )}
      </PageHead>
      {paymentStatus && (
        <div className="notice" role="status">
          {paymentStatus}
        </div>
      )}
      <SchoolPayments
        invoices={invoiceOptions}
        money={money}
        can={can}
        notify={notify}
        onPaid={() => {
          q.reload();
          transactions.reload();
        }}
      />
      {transactions.data.length > 0 && (
        <Panel title="Online payment tracking">
          <Table
            rows={transactions.data}
            columns={[
              { label: "Reference", key: "reference" },
              { label: "Amount", render: (r) => money(r.amount_cents) },
              { label: "Mode", key: "mode" },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              {
                label: "Note",
                render: (r) => <span className="wrap">{r.review_note}</span>,
              },
              {
                label: "",
                render: (r) =>
                  !["PAID", "TEST_CONFIRMED", "REVIEW"].includes(r.status) && (
                    <button
                      className="text-button"
                      onClick={() => verifyGateway(r.reference)}
                    >
                      Check payment
                    </button>
                  ),
              },
            ]}
          />
        </Panel>
      )}
      {batchResult && (
        <Panel
          title="Batch billing results"
          action={
            <Button small secondary onClick={() => setBatchResult(null)}>
              Dismiss
            </Button>
          }
        >
          <Table
            rows={batchResult}
            columns={[
              { label: "Student ID", key: "student_id" },
              { label: "Invoice ID", key: "invoice_id" },
              { label: "Issue", render: (r) => r.error || "Invoice ready" },
            ]}
          />
        </Panel>
      )}
      <div className="metrics-grid">
        <Metric
          label="Total billed"
          value={money(billed)}
          detail="Selected term · excludes waivers"
          icon={Receipt}
        />
        <Metric
          label="Collected"
          value={money(paid)}
          detail="Recorded payments"
          icon={Wallet}
          tone="accent"
        />
        <Metric
          label="Outstanding"
          value={money(outstanding)}
          detail={`${q.data.filter((i) => i.status === "OVERDUE").length} overdue invoices`}
          icon={ArrowUpRight}
        />
        <Metric
          label="Collection rate"
          value={`${billed ? Math.round((paid / billed) * 100) : 0}%`}
          detail="Of the total amount billed"
          icon={Percent}
        />
      </div>
      {can("finance.read") && (
        <div className="tabs">
          {["invoices", "fee structures", "concessions"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {human(t)}
            </button>
          ))}
        </div>
      )}
      {q.error && <div className="form-error">{q.error}</div>}
      <Panel
        title={human(tab)}
        action={
          tab === "fee structures" && can("finance.write") ? (
            <Button small onClick={() => openFee()}>
              <Plus size={15} />
              Set fee
            </Button>
          ) : tab === "invoices" ? (
            <select
              aria-label="Invoice status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {["UNPAID", "PARTIAL", "PAID", "OVERDUE", "WAIVED"].map((s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        {tab === "invoices" ? (
          <Table
            rows={q.data.filter((i) => !filter || i.status === filter)}
            columns={[
              {
                label: "Student / invoice",
                render: (r) => (
                  <Person
                    first={r.first_name}
                    last={r.last_name}
                    sub={r.invoice_number}
                  />
                ),
              },
              { label: "Billed", render: (r) => money(r.total_cents) },
              { label: "Paid", render: (r) => money(r.paid_cents) },
              {
                label: "Balance",
                render: (r) => <strong>{money(r.balance_cents)}</strong>,
              },
              { label: "Due date", key: "due_date" },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              {
                label: "Details",
                render: (r) => (
                  <button className="text-button" onClick={() => view(r)}>
                    View invoice →
                  </button>
                ),
              },
            ]}
            empty={{
              title: "A clearer picture of school fees",
              description:
                "Set up class fees, then generate an invoice for a student.",
            }}
          />
        ) : tab === "fee structures" ? (
          <>
            <div className="table-toolbar">
              <label className="inline-field">
                Class
                <select aria-label="Class" value={feeClassId} onChange={(e) => { setFeeClassId(e.target.value); setFeeTermId(""); }}>
                  <option value="">Select a class</option>
                  {classes.data.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
                </select>
              </label>
              {feeClass && <label className="inline-field">
                Term
                <select aria-label="Term" value={feeTermId} onChange={(e) => setFeeTermId(e.target.value)}>
                  <option value="">All terms</option>
                  {feeTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>}
            </div>
            {fees.error || classes.error ? <p className="form-error" role="alert">{fees.error || classes.error}</p> : fees.loading || classes.loading ? <Loading /> : !feeClass ? (
              <Empty title="Choose a class to view its fees" description="See fee categories, terms and amounts together for one class." />
            ) : (
              <>
                <h3>{feeClass.name}</h3>
                <p className="muted">{config.years.find((y) => y.id === feeClass.academic_year_id)?.name} / {classFees.length} fee {classFees.length === 1 ? "entry" : "entries"}</p>
                {classFees.length > 0 && <div className="mini-stats">
                  {feeTerms.filter((t) => classFees.some((f) => f.term_id === t.id)).map((t) => (
                    <div key={t.id}><span>{t.name} total</span><strong>{money(classFees.filter((f) => f.term_id === t.id).reduce((sum, f) => sum + Number(f.amount_cents), 0))}</strong></div>
                  ))}
                </div>}
                <Table
                  rows={classFees}
                  columns={[
                    { label: "Category", render: (r) => human(r.fee_category) },
                    { label: "Term", key: "term_name" },
                    { label: "Amount", render: (r) => money(r.amount_cents) },
                    ...(can("finance.write") ? [{ label: "Action", render: (r) => <button className="text-button" onClick={() => openFee(r)}>Edit fee</button> }] : []),
                  ]}
                  empty={{ title: "No fees set yet", description: "Use Set fee to add a category and amount for this class and term." }}
                />
              </>
            )}
          </>
        ) : (
          <>
            <div className="notice">
              Concessions apply to future invoices. Scholarship is calculated
              after the discount.
            </div>
            <Table
              rows={students.data}
              columns={[
                {
                  label: "Student",
                  render: (r) => (
                    <Person first={r.first_name} last={r.last_name} />
                  ),
                },
                { label: "Discount", render: (r) => `${r.discount_percent}%` },
                {
                  label: "Scholarship",
                  render: (r) => `${r.scholarship_percent}%`,
                },
                {
                  label: "Action",
                  render: (r) =>
                    can("finance.write") && (
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "concession", row: r })}
                      >
                        Edit concessions
                      </button>
                    ),
                },
              ]}
            />
          </>
        )}
      </Panel>
      {selected && !modal && (
        <Modal
          title={`Invoice ${selected.invoice_number}`}
          onClose={() => setSelected(null)}
        >
          <Table
            rows={selected.items}
            columns={[
              { label: "Description", key: "description" },
              { label: "Amount", render: (r) => money(r.amount_cents) },
            ]}
          />
          <div className="invoice-total">
            <span>Total {money(selected.total_cents)}</span>
            <strong>
              Balance{" "}
              {money(
                selected.waived
                  ? 0
                  : Number(selected.total_cents) - Number(selected.paid_cents),
              )}
            </strong>
          </div>
          {can("finance.write") &&
            !selected.waived &&
            Number(selected.total_cents) > Number(selected.paid_cents) && (
              <div className="row-actions">
                <Button
                  onClick={() =>
                    setModal({
                      type: "payment",
                      invoice_id: selected.id,
                      key: crypto.randomUUID(),
                    })
                  }
                >
                  Record payment
                </Button>
                <Button
                  secondary
                  onClick={async () => {
                    try {
                      await save(
                        `/finance/invoices/${selected.id}/reminder`,
                        {},
                      );
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  Send reminder
                </Button>
                <Button secondary onClick={() => setModal({ type: "plan" })}>
                  Add installment plan
                </Button>
                {Number(selected.paid_cents) === 0 && (
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: "waive" })}
                  >
                    Waive invoice
                  </button>
                )}
              </div>
            )}
          <h3 className="section-title">Payment history</h3>
          <Table
            rows={selected.payments}
            columns={[
              { label: "Receipt", key: "receipt_number" },
              { label: "Amount", render: (r) => money(r.amount_cents) },
              { label: "Method", render: (r) => human(r.payment_method) },
              {
                label: "Download",
                render: (r) => (
                  <a
                    className="text-button"
                    href={`/api/v1/finance/payments/${r.id}/receipt`}
                  >
                    <Download size={14} />
                    Receipt
                  </a>
                ),
              },
            ]}
            empty={{ title: "No payments recorded" }}
          />
          <h3 className="section-title">Payment promises / installments</h3>
          <Table
            rows={selected.plans}
            columns={[
              { label: "Due date", key: "due_date" },
              { label: "Amount", render: (r) => money(r.amount_cents) },
              { label: "Notes", key: "note" },
            ]}
            empty={{ title: "No installments planned" }}
          />
        </Modal>
      )}
      {modal && (
        <Modal
          title={
            {
              invoice: "Generate student invoice",
              payment: "Record a payment",
              fee: modal.row?.id ? "Edit class fee" : "Set class fee",
              concession: "Student concessions",
              plan: "Plan an installment",
              waive: "Waive invoice",
              batch: "Generate class invoices",
              online: "Pay school fees with Paystack",
            }[modal.type]
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "batch" && (
            <Form
              fields={[
                {
                  name: "class_id",
                  label: "Class",
                  options: classes.data.map((c) => ({
                    value: c.id,
                    label: c.name,
                  })),
                },
                {
                  name: "due_date",
                  label: "Due date",
                  type: "date",
                  default: config.today,
                },
              ]}
              onSubmit={async (v) => {
                setBatchResult(
                  await post("/finance/invoices/batch", {
                    ...v,
                    term_id: term,
                  }),
                );
                setModal(null);
                q.reload();
              }}
              submit="Generate class invoices"
            >
              <p className="muted">
                Uses the selected term. Existing invoices are reused. Any
                student-specific failures are shown for correction.
              </p>
            </Form>
          )}
          {modal.type === "online" && (
            <Form
              fields={[
                {
                  name: "invoice_id",
                  label: "Invoice",
                  options: invoiceOptions,
                  wide: true,
                },
                {
                  name: "amount",
                  label: `Amount (${config.school.currency_code})`,
                  type: "number",
                  min: 0.01,
                  step: 0.01,
                  wide: true,
                },
              ]}
              onSubmit={async (v) => {
                const result = await post("/payments/paystack/initialize", v);
                location.assign(result.authorization_url);
              }}
              submit={
                gateway.data?.mode === "TEST"
                  ? "Continue to test checkout"
                  : "Continue to Paystack"
              }
            >
              <p className="muted">
                You will complete payment on Paystack’s secure checkout. Your
                invoice is updated after server verification.
              </p>
            </Form>
          )}
          {modal.type === "invoice" && (
            <Form
              fields={[
                { name: "student_id", label: "Student", options, wide: true },
                {
                  name: "due_date",
                  label: "Due date",
                  type: "date",
                  default: config.today,
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                save("/finance/invoices/generate", { ...v, term_id: term })
              }
              submit="Generate invoice"
            >
              <p className="muted">
                Uses the selected term’s fees. Repeating this action returns the
                existing invoice.
              </p>
            </Form>
          )}
          {modal.type === "payment" && (
            <Form
              initial={{ invoice_id: modal.invoice_id || "" }}
              fields={[
                {
                  name: "invoice_id",
                  label: "Invoice",
                  options: invoiceOptions,
                  wide: true,
                },
                {
                  name: "amount",
                  label: `Amount (${config.school.currency_code})`,
                  type: "number",
                  min: 0.01,
                  step: 0.01,
                },
                {
                  name: "payment_method",
                  label: "Payment method",
                  options: ["CASH", "BANK_TRANSFER", "CARD", "INSTALLMENT"],
                },
                {
                  name: "reference_number",
                  label: "Payment reference",
                  required: false,
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                save("/finance/payments", { ...v, idempotency_key: modal.key })
              }
              submit="Save payment & issue receipt"
            />
          )}
          {modal.type === "fee" && (
            <Form
              initial={{ ...modal.row, amount: modal.row?.amount_cents == null ? "" : Number(modal.row.amount_cents) / 100 }}
              fields={[
                {
                  name: "class_id",
                  label: "Class",
                  options: classes.data.filter((c) => !modal.row?.id || c.id === modal.row.class_id).map((c) => ({
                    value: c.id,
                    label: classLabel(c),
                  })),
                },
                {
                  name: "term_id",
                  label: "Term",
                  options: config.terms.filter((t) => !modal.row?.id || t.id === modal.row.term_id).map((t) => ({ value: t.id, label: `${t.name} / ${config.years.find((y) => y.id === t.academic_year_id)?.name || ""}` })),
                },
                {
                  name: "fee_category",
                  label: "Fee category",
                  options: [
                    "TUITION",
                    "BOARDING",
                    "TRANSPORT",
                    "EXAM",
                    "BOOKS",
                    "UNIFORM",
                    "MEALS",
                    "ACTIVITY",
                    "OTHER",
                  ].filter((category) => !modal.row?.id || category === modal.row.fee_category),
                },
                {
                  name: "amount",
                  label: `Amount (${config.school.currency_code})`,
                  type: "number",
                  min: 0.01,
                  step: 0.01,
                  wide: true,
                },
              ]}
              onSubmit={async (v) => {
                await save("/finance/fee-structures", v);
                setFeeClassId(String(v.class_id));
                setFeeTermId(String(v.term_id));
              }}
            >
              <p className="muted">
                Applies to the chosen class and term. Existing invoices keep their
                original charges.
              </p>
            </Form>
          )}
          {modal.type === "concession" && (
            <Form
              initial={modal.row}
              fields={[
                {
                  name: "discount_percent",
                  label: "Discount (%)",
                  type: "number",
                  min: 0,
                  max: 100,
                  step: 0.01,
                },
                {
                  name: "scholarship_percent",
                  label: "Scholarship (%)",
                  type: "number",
                  min: 0,
                  max: 100,
                  step: 0.01,
                },
              ]}
              onSubmit={(v) =>
                save(`/finance/students/${modal.row.id}/concessions`, v, patch)
              }
            />
          )}{" "}
          {modal.type === "plan" && (
            <Form
              fields={[
                { name: "due_date", label: "Due date", type: "date" },
                {
                  name: "amount",
                  label: "Installment amount",
                  type: "number",
                  min: 0.01,
                  step: 0.01,
                },
                {
                  name: "note",
                  label: "Payment promise / notes",
                  type: "textarea",
                  wide: true,
                  required: false,
                },
              ]}
              onSubmit={(v) =>
                save(`/finance/invoices/${selected.id}/plans`, v)
              }
            />
          )}{" "}
          {modal.type === "waive" && (
            <Form
              fields={[
                {
                  name: "reason",
                  label: "Reason for waiver",
                  type: "textarea",
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                save(`/finance/invoices/${selected.id}/waive`, v)
              }
              submit="Waive invoice"
            />
          )}
        </Modal>
      )}
    </>
  );
}
