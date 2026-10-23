function apiError(status, code = `BREVO_HTTP_${status}`) {
  return Object.assign(new Error("Brevo email request failed."), {
    code,
    responseCode: status,
    command: "HTTPS",
  });
}

// Nodemailer-compatible HTTPS transport: all existing mail flows share this adapter.
export function createBrevoTransport(
  apiKey,
  { request = globalThis.fetch } = {},
) {
  async function call(path, body) {
    let response;
    try {
      response = await request(`https://api.brevo.com/v3/${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "api-key": apiKey,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw apiError(undefined, "BREVO_NETWORK_ERROR");
    }
    if (!response.ok) throw apiError(response.status);
    try {
      return await response.json();
    } catch {
      throw apiError(response.status, "BREVO_INVALID_RESPONSE");
    }
  }
  return {
    name: "Brevo HTTPS",
    version: "1.0.0",
    verify(callback) {
      const promise = call("account").then(() => true);
      if (callback) {
        promise.then((value) => callback(null, value), callback);
        return;
      }
      return promise;
    },
    send(mail, callback) {
      (async () => {
        const data = mail.data,
          envelope = mail.message.getEnvelope();
        if (data.cc || data.bcc)
          throw apiError(undefined, "BREVO_UNSUPPORTED_RECIPIENTS");
        if (!envelope.from || !envelope.to?.length)
          throw apiError(undefined, "BREVO_INVALID_ADDRESS");
        const senderName =
          typeof data.from === "object"
            ? data.from.name
            : typeof data.from === "string"
              ? data.from.match(/^\s*"?([^<>]*?)"?\s*</)?.[1]?.trim()
              : undefined;
        let html = data.html,
          attachments = [];
        for (const attachment of data.attachments || []) {
          if (attachment.cid === "smpis-brand") {
            let origin;
            try {
              origin = new URL("/email-logo.png", process.env.APP_URL);
              if (origin.protocol !== "https:") throw Error();
            } catch {
              throw apiError(undefined, "BREVO_PUBLIC_URL_REQUIRED");
            }
            html = html?.replaceAll("cid:smpis-brand", origin.href);
          } else {
            if (attachment.cid || !attachment.content)
              throw apiError(undefined, "BREVO_UNSUPPORTED_ATTACHMENT");
            attachments.push({
              name: attachment.filename,
              content: Buffer.isBuffer(attachment.content)
                ? attachment.content.toString("base64")
                : Buffer.from(
                    attachment.content,
                    attachment.encoding || "utf8",
                  ).toString("base64"),
            });
          }
        }
        const payload = {
          sender: {
            email: envelope.from,
            ...(senderName ? { name: senderName } : {}),
          },
          to: envelope.to.map((email) => ({ email })),
          subject: data.subject,
          ...(html ? { htmlContent: html } : {}),
          ...(data.text ? { textContent: data.text } : {}),
          ...(attachments.length ? { attachment: attachments } : {}),
        };
        const result = await call("smtp/email", payload);
        if (typeof result.messageId !== "string" || !result.messageId)
          throw apiError(201, "BREVO_INVALID_RESPONSE");
        return {
          messageId: result.messageId,
          accepted: envelope.to,
          rejected: [],
          response: result.messageId,
        };
      })().then((result) => callback(null, result), callback);
    },
  };
}
