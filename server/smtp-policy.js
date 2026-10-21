import dns from "node:dns/promises";
import { isIP } from "node:net";
import { fail } from "./security.js";
export const smtpDns = { lookup: (...args) => dns.lookup(...args) };
export function allowedSmtpHost(host) {
  const allowed = (process.env.SMTP_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    !host ||
    isIP(host) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) ||
    !allowed.includes(host.toLowerCase())
  )
    fail(422, "SMTP hostname must be approved by the platform administrator.");
}
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 88, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Accept only native global unicast IPv6; exclude documentation and mapped addresses.
  return (
    isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !/^2001:db8:/i.test(address) &&
    !/^2002:/i.test(address) &&
    !(
      address.toLowerCase().startsWith("2001:") &&
      parseInt(address.split(":")[1] || "0", 16) < 0x200
    )
  );
}
export async function smtpDestination(host) {
  allowedSmtpHost(host);
  let records;
  try {
    records = await smtpDns.lookup(host, { all: true, verbatim: true });
  } catch {
    fail(503, "Approved SMTP hostname could not be resolved.");
  }
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    fail(
      422,
      "SMTP connections to private or reserved networks are not allowed.",
    );
  // Pin the resolved address in the actual transport, preserving hostname TLS verification.
  return records[0].address;
}
