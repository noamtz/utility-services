const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const MAX_DEPTH_REACHED = "[MAX_DEPTH]";
const NON_PLAIN_OBJECT = "[NON_PLAIN_OBJECT]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "xapikey",
  "apikey",
  "projectapikey",
  "secrethash",
  "credential",
  "token",
  "secret",
  "password",
  "presignedurl",
  "uploadurl",
  "downloadurl",
  "transferurl",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function redactUrl(value: string): string {
  if (value.startsWith("?") || value.startsWith("#")) {
    return REDACTED;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return value;
    }

    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

export function redactSensitiveValues(value: unknown, maxDepth = 8): unknown {
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number): unknown {
    if (typeof current === "string") {
      return redactUrl(current);
    }

    if (current === null || typeof current !== "object") {
      return current;
    }

    if (seen.has(current)) {
      return CIRCULAR;
    }

    if (depth >= maxDepth) {
      return MAX_DEPTH_REACHED;
    }

    if (!Array.isArray(current) && !isPlainObject(current)) {
      return NON_PLAIN_OBJECT;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      return current.map((item) => visit(item, depth + 1));
    }

    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      copy[key] = isSensitiveKey(key) ? REDACTED : visit(item, depth + 1);
    }
    return copy;
  }

  return visit(value, 0);
}
