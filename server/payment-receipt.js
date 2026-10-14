// Keep receipt layout independent of HTTP so generated PDFs can be previewed.
export function drawPaymentReceipt(doc, { school, payment, invoice, student }) {
  const left = 50;
  const width = doc.page.width - 100;
  const ink = "#172B46";
  const muted = "#617084";
  const money = (amount) => `${school.currency_code} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) / 100)}`;
  const label = (text, x, y, w = width) => doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text(text, x, y, { width: w });
  const value = (text, x, y, w = width) => {
    doc.font("Helvetica").fontSize(11).fillColor(ink).text(String(text), x, y, { width: w });
    return doc.y;
  };

  doc.rect(0, 0, doc.page.width, 9).fill(ink);
  doc.font("Helvetica-Bold").fontSize(25).fillColor(ink)
    .text(school.name, left, 45, { width, align: "center" });
  const headerBottom = doc.y + 12;
  doc.font("Helvetica").fontSize(9).fillColor(muted)
    .text("SCHOOL FINANCE OFFICE", left, headerBottom, { width, align: "center", characterSpacing: 1.5 });
  const titleY = doc.y + 27;
  doc.moveTo(left, titleY - 12).lineTo(left + width, titleY - 12).strokeColor("#DCE3EB").stroke();
  doc.font("Helvetica-Bold").fontSize(18).fillColor(ink).text("PAYMENT RECEIPT", left, titleY, { width });
  let y = doc.y + 20;
  label("RECEIPT NUMBER", left, y);
  y = value(payment.receipt_number, left, y + 14) + 17;
  label("PAYMENT DATE", left, y);
  y = value(new Date(payment.paid_at).toLocaleString("en-GB", { timeZone: school.timezone }), left, y + 14) + 22;

  const amount = money(payment.amount_cents);
  doc.font("Helvetica-Bold").fontSize(25);
  const amountHeight = doc.heightOfString(amount, { width: width - 36 });
  doc.roundedRect(left, y, width, amountHeight + 62, 8).fill("#EEF3F8");
  label("AMOUNT RECEIVED", left + 18, y + 15, width - 36);
  doc.font("Helvetica-Bold").fontSize(25).fillColor(ink).text(amount, left + 18, y + 35, { width: width - 36 });
  y += amountHeight + 85;

  label("RECEIVED FOR", left, y);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(ink)
    .text(`${student.first_name} ${student.last_name}`, left, y + 16, { width });
  y = doc.y + 8;
  y = value(`Student number: ${student.student_number || "Not assigned"}`, left, y) + 24;

  const details = [
    ["Invoice number", invoice.invoice_number],
    ["Payment method", String(payment.payment_method).replace(/_/g, " ")],
    ["Transaction reference", payment.reference_number || "Not provided"],
  ];
  for (const [heading, detail] of details) {
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor("#E1E7EE").stroke();
    label(heading.toUpperCase(), left, y + 13, 155);
    y = Math.max(y + 39, value(detail, left + 165, y + 11, width - 165) + 13);
  }
  y += 22;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ink)
    .text(`Thank you for your payment to ${school.name}.`, left, y, { width });
  doc.moveDown(0.6).font("Helvetica").fontSize(9).fillColor(muted)
    .text("Please retain this receipt as confirmation of the payment recorded above.", { width });
  doc.fontSize(8).fillColor(muted).text("Electronically generated payment receipt", left, doc.page.height - 65, { width, align: "center" });
}
