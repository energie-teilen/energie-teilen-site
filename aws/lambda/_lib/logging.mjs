const REDACTED = "[REDACTED]";
const SECRET_PATTERN = /(authorization|cookie|signature|secret|token|key|password)/i;

function scrub(key, value) {
  if (SECRET_PATTERN.test(String(key))) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => scrub(`${key}[${index}]`, entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrub(childKey, childValue)]));
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

function write(level, message, context = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...scrub("context", context),
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
  write("info", message, context);
}

export function logWarn(message, context = {}) {
  write("warn", message, context);
}

export function logError(message, context = {}) {
  write("error", message, context);
}
