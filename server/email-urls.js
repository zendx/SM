// Preserve paths, query strings and tokens when retiring SMPIS deployment domains.
export function canonicalEmailLinks(value) {
  return String(value ?? "").replace(
    /https?:\/\/(?:smpis\.vercel\.app|www\.smpis\.digital|smpis\.digital)(?=[:/?#\s<>"')]|$)(?::(?:80|443))?/gi,
    "https://smpis.digital",
  );
}

export function emailOrigin() {
  return canonicalEmailLinks(process.env.APP_URL || "https://smpis.digital");
}

export function emailFooter({ key, recipientName, recipientEmail } = {}) {
  const recipient = recipientName || recipientEmail;
  const reason =
    key === "promotional_newsletter"
      ? "You received this email because you opted in to SMPIS promotional updates."
      : key === "school_notification"
        ? "You received this email because your school uses SMPIS to share updates with you."
        : key === "verification"
          ? "You received this email because this address was used to create a SMPIS account."
          : key === "password_reset"
            ? "You received this email because a password reset was requested for your SMPIS account."
            : "You received this email because you have a SMPIS account. We use email to share account, school and service updates.";
  return {
    recipient: recipient
      ? `This email was sent to ${recipient}.`
      : "This is an automated email from SMPIS.",
    reason,
    contact: "mailto:info@smpis.digital",
    privacy: new URL("/privacy", emailOrigin()).href,
  };
}
