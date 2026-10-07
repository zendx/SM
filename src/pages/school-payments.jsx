import React, { useEffect, useState } from "react";
import { useData } from "../hooks";
import { post } from "../api";
import { Panel, Table, Badge, Button, Modal, Form } from "../components";
const labels = {
  manual: "Manual bank transfer",
  paypal: "PayPal",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  stripe: "Stripe",
};
export function SchoolPayments({ invoices, money, can, onPaid, notify }) {
  const methods = useData("/payments/school/methods"),
    tx = useData("/payments/school/transactions"),
    [open, setOpen] = useState(false),
    [provider, setProvider] = useState(""),
    [review, setReview] = useState(null);
  async function verify(reference, confirm_manual = false) {
    try {
      const p = await post("/payments/school/verify", {
        reference,
        confirm_manual,
      });
      notify(
        p.status === "PAID"
          ? "Payment verified and credited to the invoice."
          : p.status === "TEST_CONFIRMED"
            ? "Test payment confirmed; invoice balance is unchanged."
            : p.status === "REVIEW"
              ? p.review_note
              : "Payment is awaiting confirmation.",
      );
      tx.reload();
      onPaid();
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search),
      reference = params.get("school_payment_reference");
    if (reference) {
      verify(reference);
      for (const key of [
        "school_payment_reference",
        "token",
        "PayerID",
        "transaction_id",
        "tx_ref",
        "status",
      ])
        params.delete(key);
      history.replaceState(
        null,
        "",
        location.pathname + (params.size ? "?" + params : "") + location.hash,
      );
    }
  }, []);
  const available = Object.keys(methods.data || {}),
    chosen = provider || available[0];
  return (
    <>
      {methods.error && <p className="form-error">{methods.error}</p>}
      {available.length > 0 && (
        <Panel
          title="Pay school fees"
          description="Use a payment method made available by your school. Manual transfers are credited after school finance confirms receipt."
        >
          <Button onClick={() => setOpen(true)}>Make a fee payment</Button>
        </Panel>
      )}
      {(tx.data || []).length > 0 && (
        <Panel title="School payment tracking">
          <Table
            rows={tx.data}
            columns={[
              { label: "Reference", key: "reference" },
              { label: "Provider", render: (r) => labels[r.provider] },
              { label: "Amount", render: (r) => money(r.amount_cents) },
              { label: "Mode", key: "mode" },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              { label: "Transfer reference", key: "transfer_reference" },
              { label: "Note", key: "review_note" },
              {
                label: "Action",
                render: (r) =>
                  r.status === "PENDING" ? (
                    r.provider === "manual" ? (
                      can("finance.write") ? (
                        <Button small secondary onClick={() => setReview(r)}>
                          Confirm bank receipt
                        </Button>
                      ) : (
                        "Awaiting school finance"
                      )
                    ) : (
                      <Button
                        small
                        secondary
                        onClick={() => verify(r.reference)}
                      >
                        Check payment
                      </Button>
                    )
                  ) : null,
              },
            ]}
          />
        </Panel>
      )}
      {open && (
        <Modal title="Pay school fees" onClose={() => setOpen(false)}>
          <label className="field">
            <span>School payment method</span>
            <select
              value={chosen}
              onChange={(e) => setProvider(e.target.value)}
            >
              {available.map((p) => (
                <option key={p} value={p}>
                  {labels[p]}
                  {methods.data[p].mode === "TEST" ? " (test)" : ""}
                </option>
              ))}
            </select>
          </label>
          {chosen === "manual" && (
            <div className="notice">
              <p>
                {methods.data.manual.bank_name} ·{" "}
                {methods.data.manual.account_name} ·{" "}
                {methods.data.manual.account_number}
              </p>
              <p>{methods.data.manual.instructions}</p>
            </div>
          )}
          <Form
            key={chosen}
            fields={[
              {
                name: "invoice_id",
                label: "Invoice",
                options: invoices,
                wide: true,
              },
              {
                name: "amount",
                label: "Payment amount",
                type: "number",
                min: 0.01,
                step: 0.01,
                wide: true,
              },
              ...(chosen === "manual"
                ? [
                    {
                      name: "transfer_reference",
                      label: "Bank transfer reference",
                      wide: true,
                    },
                  ]
                : []),
            ]}
            submit={
              chosen === "manual"
                ? "Submit transfer for confirmation"
                : "Continue to checkout"
            }
            onSubmit={async (values) => {
              const result = await post(
                chosen === "paystack"
                  ? "/payments/paystack/initialize"
                  : "/payments/school/checkout",
                chosen === "paystack"
                  ? values
                  : { ...values, provider: chosen },
              );
              if (chosen === "manual") {
                notify(result.message);
                setOpen(false);
                tx.reload();
              } else location.assign(result.url || result.authorization_url);
            }}
          />
        </Modal>
      )}
      {review && (
        <Modal title="Confirm bank receipt" onClose={() => setReview(null)}>
          <p>
            Verify {money(review.amount_cents)} on your bank statement for
            transfer reference {review.transfer_reference} before crediting this
            invoice.
          </p>
          <Button
            onClick={async () => {
              await verify(review.reference, true);
              setReview(null);
            }}
          >
            Confirm funds received
          </Button>
        </Modal>
      )}
    </>
  );
}
