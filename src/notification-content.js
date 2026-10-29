import DOMPurify from "dompurify";

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

export function notificationHtml(body = "") {
  const value = String(body);
  const html = /<\/?[a-z][^>]*>/i.test(value)
    ? value
    : `<p>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</p>`;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "pre",
      "code",
      "div",
      "span",
    ],
    ALLOWED_ATTR: ["href", "title", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function notificationPreview(body = "") {
  const html = notificationHtml(body).replace(
    /<(br|\/p|\/div|\/li|\/h[1-4]|\/tr)\b[^>]*>/gi,
    " ",
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  const text = (document.body.textContent || "").replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  return characters.length > 250
    ? `${characters.slice(0, 249).join("")}…`
    : text;
}

export function notificationLink(link) {
  if (!link) return null;
  try {
    const url = new URL(link, location.href);
    return url.origin === location.origin &&
      ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
