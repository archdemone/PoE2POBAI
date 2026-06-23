/**
 * Resolves any supported build-import payload to PoB2 XML.
 *
 * Handles four input shapes, in order:
 *   1. Raw PoB2 XML            → used as-is
 *   2. poe.ninja character URL → resolved via the poe2-mcp bridge (get_pob_code)
 *   3. Other build URL         → fetched (pobb.in /raw, pastebin /raw, generic)
 *   4. PoB export code         → base64 + zlib inflate
 *
 * Pure and side-effect free (no server state) so it can be unit-tested. The
 * poe2-mcp bridge and fetch are injected via options for testability.
 */
// PoB export codes are URL-safe base64 of zlib-compressed XML. Use the shared
// parser decoder, which tolerates codes that lost their trailing checksum byte
// in copy-paste (a common real-world failure) instead of rejecting them.
import { decodePobCode } from "@pobai/parser";

export { decodePobCode };

/** Thrown when a payload can't be resolved; message is user-facing. */
export class ImportError extends Error {}

export function looksLikePobXml(text) {
  return /^\s*</.test(text) && /PathOfBuilding/i.test(text);
}

function looksLikeUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

// Pull the longest decodable PoB code out of arbitrary text (e.g. an HTML page
// or a formatted poe2-mcp response).
export function extractEmbeddedPobXml(text) {
  const candidates = text.match(/[A-Za-z0-9\-_+/=]{120,}/g);
  if (!candidates) return null;
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      const xml = decodePobCode(candidate);
      if (looksLikePobXml(xml)) return xml;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// Map known build-share hosts to the endpoint that returns the raw PoB code.
function toRawBuildUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  if (host === "pobb.in" && !/\/raw$/.test(path)) {
    const id = path.replace(/^\/+/, "");
    if (id) return `https://pobb.in/${id}/raw`;
  }
  if (host === "pastebin.com") {
    const match = path.match(/^\/(?:raw\/)?([A-Za-z0-9]+)$/);
    if (match) return `https://pastebin.com/raw/${match[1]}`;
  }
  return parsed.toString();
}

export function isPoeNinjaUrl(url) {
  try {
    return /(^|\.)poe\.ninja$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// poe.ninja character URL → { account, character }. Mirrors the formats
// poe2-mcp itself accepts.
export function parseNinjaUrl(url) {
  const patterns = [
    /poe\.ninja\/poe2\/profile\/([^/]+)\/character\/([^/?\s]+)/i,
    /poe\.ninja\/poe2\/builds\/character\/([^/]+)\/([^/?\s]+)/i,
    /poe\.ninja\/builds\/character\/([^/]+)\/([^/?\s]+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { account: decodeURIComponent(m[1]), character: decodeURIComponent(m[2]) };
  }
  return null;
}

// poe2-mcp tools return formatted text (sometimes a structured field); pull a
// usable PoB XML out of whatever shape comes back.
export function xmlFromMcpResult(result) {
  if (!result) return null;
  for (const key of ["pob", "code", "build", "pob_code"]) {
    const value = result[key];
    if (typeof value === "string") {
      try {
        const xml = decodePobCode(value);
        if (looksLikePobXml(xml)) return xml;
      } catch { /* keep looking */ }
    }
  }
  const text = typeof result.text === "string" ? result.text
    : typeof result === "string" ? result
    : JSON.stringify(result);
  if (looksLikePobXml(text)) return text;
  return extractEmbeddedPobXml(text);
}

// Resolve a poe.ninja character URL to PoB XML via the poe2-mcp bridge.
async function resolveViaPoeNinja(url, mcp) {
  if (!mcp?.ready) return null;
  const who = parseNinjaUrl(url);
  if (!who) return null;
  try {
    const result = await mcp.callTool("get_pob_code", who);
    const xml = xmlFromMcpResult(result);
    if (xml) return { xml, note: `Imported ${who.character} from poe.ninja via poe2-mcp` };
  } catch { /* bridge/upstream error — caller surfaces a clear message */ }
  return null;
}

async function fetchBuildUrl(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "PoBAI/0.3", accept: "text/plain, application/xml, text/html, */*" },
    });
    if (!res.ok) throw new ImportError(`The build URL returned HTTP ${res.status}.`);
    return await res.text();
  } catch (err) {
    if (err instanceof ImportError) throw err;
    const reason = err?.name === "AbortError" ? "the request timed out" : err?.message ?? "unknown error";
    throw new ImportError(`Could not fetch the build URL (${reason}).`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve any supported import payload to PoB2 XML. Returns { xml, note? };
 * throws ImportError with a user-facing message when it can't be resolved.
 *
 * @param {string} rawPayload
 * @param {{ mcp?: {ready: boolean, callTool: Function}, fetchImpl?: Function }} [opts]
 */
export async function resolveToXml(rawPayload, opts = {}) {
  const { mcp, fetchImpl = globalThis.fetch } = opts;
  const payload = rawPayload.trim();

  // 1. Raw PoB2 XML — use as-is.
  if (looksLikePobXml(payload)) return { xml: payload };

  // 2. Build URL.
  if (looksLikeUrl(payload)) {
    // poe.ninja profiles are SPAs (no code in the HTML) — resolve via poe2-mcp's
    // hidden-API PoB export when the bridge is connected.
    if (isPoeNinjaUrl(payload)) {
      const viaNinja = await resolveViaPoeNinja(payload, mcp);
      if (viaNinja) return viaNinja;
      throw new ImportError(
        mcp?.ready
          ? "Couldn't fetch a Path of Building code for that poe.ninja character. Make sure the profile is public and the URL looks like https://poe.ninja/poe2/profile/Account/character/Name — or paste the PoB code from the character's page."
          : "Importing a poe.ninja link needs the poe2-mcp bridge, which isn't connected. Install it (pip install poe2-mcp) and restart, or paste the PoB code from the character's page."
      );
    }

    // Other hosts: fetch and resolve the contents.
    const fetchUrl = toRawBuildUrl(payload);
    const body = (await fetchBuildUrl(fetchUrl, fetchImpl)).trim();
    if (looksLikePobXml(body)) return { xml: body, note: `Imported XML from ${fetchUrl}` };
    if (!looksLikeUrl(body) && !body.startsWith("<")) {
      try {
        const xml = decodePobCode(body);
        if (looksLikePobXml(xml)) return { xml, note: `Imported PoB code from ${fetchUrl}` };
      } catch { /* fall through to embedded scan */ }
    }
    const embedded = extractEmbeddedPobXml(body);
    if (embedded) return { xml: embedded, note: `Extracted embedded PoB code from ${fetchUrl}` };
    throw new ImportError(
      "Fetched the URL but found no Path of Building code in it. " +
      "Direct pobb.in and pastebin links work, or paste the PoB export code itself."
    );
  }

  // 3. Opaque text — try to decompress it as a PoB export code.
  try {
    const xml = decodePobCode(payload);
    if (looksLikePobXml(xml)) return { xml };
  } catch { /* fall through */ }

  throw new ImportError(
    "This doesn't look like a PoB2 export code, XML, or a build URL. " +
    'In Path of Building 2 use Import/Export → "Generate" to copy an export code, then paste it here.'
  );
}
