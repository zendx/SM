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
    [filter, setFilter] = useState("");
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
        description="Clear balances. Confident decisions. Every payment accounted for."
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
      {gateway.data?.configured && (
        <div className="notice">
          Paystack{" "}
          {gateway.data.mode === "TEST"
            ? "test checkout is enabled. Test transactions do not credit real invoices."
            : "online payments are available."}{" "}
          <Button small onClick={() => setModal({ type: "online" })}>
            Pay online
          </Button>
        </div>
      )}
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
            <Button small onClick={() => setModal({ type: "fee" })}>
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
          <Table
            rows={fees.data}
            columns={[
              { label: "Class", key: "class_name" },
              { label: "Term", key: "term_name" },
              { label: "Category", render: (r) => human(r.fee_category) },
              { label: "Amount", render: (r) => money(r.amount_cents) },
            ]}
          />
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
              fee: "Set class fee",
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
                  ],
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
              onSubmit={(v) =>
                save("/finance/fee-structures", { ...v, term_id: term })
              }
            >
              <p className="muted">
                Applies to the selected term. Existing invoices keep their
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
