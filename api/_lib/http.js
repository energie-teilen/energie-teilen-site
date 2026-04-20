const DEFAULT_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function json(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;

  for (const [headerName, headerValue] of Object.entries({ ...DEFAULT_HEADERS, ...extraHeaders })) {
    res.setHeader(headerName, headerValue);
  }

  res.end(JSON.stringify(payload));
}

export function ok(res, payload) {
  return json(res, 200, payload);
}

export function errorResponse(res, statusCode, code, message, details = undefined) {
  return json(res, statusCode, {
    ok: false,
    error: {
      code,
      message,
      details: details ?? null,
    },
  });
}

export function methodNotAllowed(res, allowedMethods) {
  res.setHeader("Allow", allowedMethods.join(", "));
  return errorResponse(res, 405, "method_not_allowed", `Method not allowed. Use ${allowedMethods.join(", ")}.`);
}

export function getHeader(req, name) {
  const direct = req?.headers?.[name];
  if (typeof direct === "string") {
    return direct;
  }

  const normalized = req?.headers?.[name.toLowerCase()];
  return typeof normalized === "string" ? normalized : undefined;
}

export async function readRawBody(req, { maxBytes = 1_000_000 } = {}) {
  if (Buffer.isBuffer(req?.rawBody)) {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req?.body)) {
    return req.body;
  }

  if (typeof req?.body === "string") {
    return Buffer.from(req.body);
  }

  if (req?.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

export async function readJsonBody(req, { maxBytes = 1_000_000 } = {}) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = await readRawBody(req, { maxBytes });
  if (!raw.length) {
    return {};
  }

  try {
    return JSON.parse(raw.toString("utf-8"));
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function getQueryParam(req, key) {
  if (req?.query && typeof req.query[key] === "string") {
    return req.query[key];
  }

  const requestUrl = req?.url || "/";
  const parsed = new URL(requestUrl, "http://localhost");
  return parsed.searchParams.get(key) ?? undefined;
}

export function asTrimmedString(value, { maxLength = 500, defaultValue = "" } = {}) {
  if (typeof value !== "string") {
    return defaultValue;
  }

  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function requireNonEmptyString(value, fieldName, { maxLength = 500 } = {}) {
  const normalized = asTrimmedString(value, { maxLength });
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

export function normalizeEmail(value) {
  const normalized = asTrimmedString(value, { maxLength: 320 }).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!normalized || !emailPattern.test(normalized)) {
    throw new Error("A valid email address is required.");
  }

  return normalized;
}

export function normalizePhone(value) {
  const normalized = asTrimmedString(value, { maxLength: 32 });
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[^\d+()\-\s]/g, "");
}

export function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(lowered)) {
      return false;
    }
  }

  return false;
}

export function requireMethod(req, res, allowedMethods) {
  if (!allowedMethods.includes(req.method)) {
    methodNotAllowed(res, allowedMethods);
    return false;
  }

  return true;
}
