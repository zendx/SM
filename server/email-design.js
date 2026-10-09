import { readFile } from "node:fs/promises";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

export function emailLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const actions = {
  onboarding_welcome: [
    "Welcome to your school portal",
    "Open your school portal",
  ],
  onboarding_tour: ["Find your way around SMPIS", "Explore your school portal"],
  verification: [
    "Welcome to your school’s next chapter",
    "Verify email address",
    "This verification link expires in 24 hours. If you didn’t create an account, you can ignore this email.",
  ],
  password_reset: [
    "Let’s get you back into your account",
    "Reset password",
    "This password reset link expires in 30 minutes. If you didn’t request it, you can ignore this email.",
  ],
  support_reply: ["An update from the SMPIS team", "View support reply"],
  support_received: ["A school needs your support", "Open support ticket"],
  subscription_reminder: ["Keep your school connected", "Manage subscription"],
  mfa_reminder: [
    "A small step for a safer account",
    "Enable two-factor authentication",
  ],
  notification: ["Your school, thoughtfully connected", "Open SMPIS"],
  school_notification: ["An update from your school", "Open school portal"],
  promotional_newsletter: ["What’s new at SMPIS", "Explore SMPIS"],
};

export function brandedEmail({ subject, text, link, key, unsubscribeLink }) {
  const [heading, action, note] = actions[key] || actions.notification;
  const href = emailLink(link);
  // Keep template content as text; never execute owner or tenant supplied HTML.
  const content = text
    .split(/\n\s*\n/)
    .map((paragraph) => {
      // The main action and security note have their own dedicated layout below.
      if (
        (href && paragraph.trim() === link) ||
        (note && paragraph.trim() === note)
      )
        return "";
      const formatted = paragraph
        .split(/(https?:\/\/[^\s<>]+)/g)
        .map((part) => {
          const url = emailLink(part.replace(/[.,;)]+$/, ""));
          return /^https?:\/\//.test(part) && url
            ? `<a href="${escape(url)}" style="color:#226653;word-break:break-all">${escape(part)}</a>`
            : escape(part).replace(/\n/g, "<br>");
        })
        .join("");
      return `<p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#354d44">${formatted}</p>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f0e7;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escape(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e7"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#143e35;padding:28px 32px;border-bottom:4px solid #d9b46e">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:14px"><img src="cid:smpis-brand" width="52" height="52" alt="SMPIS graduation cap logo" style="display:block;border:0"></td><td><span style="font-size:25px;letter-spacing:2px;font-weight:bold;color:#ffffff">SMPIS</span><br><span style="font-size:10px;letter-spacing:1.5px;color:#d6e6d9">SCHOOL INTELLIGENCE</span></td></tr></table>
</td></tr><tr><td style="padding:34px 32px 12px">
<p style="margin:0 0 12px;color:#57866c;font-size:11px;letter-spacing:1.8px;font-weight:bold">CLARITY FOR EVERY SCHOOL DAY</p>
<h1 style="margin:0 0 26px;color:#143e35;font-size:27px;line-height:1.25">${escape(heading)}</h1>${content}
${
  href
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px"><tr><td bgcolor="#226653" style="border-radius:8px"><a href="${escape(href)}" style="display:inline-block;padding:16px 24px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border:1px solid #226653;border-radius:8px">${escape(action)}</a></td></tr></table>
<p style="font-size:12px;line-height:1.6;color:#6b7f69">If the button doesn’t open, copy this address into your browser:<br><a href="${escape(href)}" style="color:#226653;word-break:break-all">${escape(href)}</a></p>`
    : ""
}
${note ? `<p style="background:#edf3e9;padding:16px;border-radius:8px;font-size:13px;line-height:1.6;color:#53685e">${escape(note)}</p>` : ""}
</td></tr><tr><td style="padding:22px 32px;border-top:1px solid #e6ece8;background:#fafbf8"><p style="margin:0;color:#6b7f69;font-size:12px;line-height:1.6">SMPIS · School Management, Performance &amp; Intelligence System<br>A connected school starts here.</p>${emailLink(unsubscribeLink) ? `<p style="margin:14px 0 0;color:#6b7f69;font-size:12px;line-height:1.6">You chose to receive SMPIS promotional emails. <a href="${escape(emailLink(unsubscribeLink))}" style="color:#226653">Unsubscribe from promotional emails</a>.</p>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

let logo;
export async function emailLogo() {
  logo ||= readFile(new URL("./email-assets/smpis-logo.png", import.meta.url));
  return {
    filename: "smpis-logo.png",
    content: await logo,
    cid: "smpis-brand",
    contentType: "image/png",
    contentDisposition: "inline",
  };
}
