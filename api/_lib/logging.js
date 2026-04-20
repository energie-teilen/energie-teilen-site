const REDACTED_TOKEN = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|signature|secret|token|key|password)/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Error) && !Buffer.isBuffer(value);
}

function redactValue(key, value) {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) {
    return REDACTED_TOKEN;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(`${key}[${index}]`, entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childKey, childValue)]));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.NODE_ENV === "production" ? undefined : value.stack,
    };
  }

  return value;
}

export function redactSecrets(payload = {}) {
  if (!isPlainObject(payload)) {
    return redactValue("value", payload);
  }

  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, redactValue(key, value)]));
}

function log(level, message, context = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redactSecrets(context),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function logInfo(message, context = {}) {
  log("info", message, context);
}

export function logWarn(message, context = {}) {
  log("warn", message, context);
}

export function logError(message, context = {}) {
  log("error", message, context);
}

export function createRequestContext(req) {
  return redactSecrets({
    method: req?.method,
    path: req?.url,
    requestId: req?.headers?.["x-vercel-id"] || req?.headers?.["x-request-id"] || null,
    userAgent: req?.headers?.["user-agent"] || null,
  });
}

export function serializeError(error) {
  return redactValue("error", error);
}
