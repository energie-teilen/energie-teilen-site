/**
 * server/security-headers.ts
 *
 * Browser-hardening response headers.
 *
 * Without these the document has no defence in depth: it can be framed by any
 * site, its content type can be sniffed, its URL leaks to every outbound
 * request, and a single injected script has nothing standing in its way. They
 * cost one middleware and they are the ASVS baseline for a public surface.
 *
 * The policy is written for THIS application's actual dependencies. A copied
 * policy that has to be loosened until the site works again protects nothing,
 * so every allowance below names what needs it.
 */

import type { RequestHandler } from "express";

/** Hosts the built client legitimately reaches. Keep this list short. */
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],

  /*
   * 'unsafe-inline' is required for the styles Tailwind and the chart
   * libraries set on elements at runtime; a nonce cannot cover those. Scripts
   * do NOT get the same allowance.
   */
  "style-src": ["'self'", "'unsafe-inline'"],
  /* Fonts are served from this origin; no external font host is permitted. */
  "font-src": ["'self'", "data:"],

  /* Only our own bundles, plus the analytics script. No inline script. */
  "script-src": ["'self'", "https://plausible.io"],
  "script-src-elem": ["'self'", "https://plausible.io"],

  /* Analytics beacons, our own API, and Stripe's checkout redirect. */
  "connect-src": ["'self'", "https://plausible.io", "https://api.stripe.com"],

  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:"],

  /* Stripe Checkout is a top-level redirect, not a frame, so none is needed. */
  "frame-src": ["'none'"],
  "frame-ancestors": ["'none'"],

  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
};

export function contentSecurityPolicy(): string {
  const parts = Object.entries(CSP_DIRECTIVES).map(([k, v]) => `${k} ${v.join(" ")}`);
  // Blocks passive mixed content without breaking a plain-HTTP local run.
  parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Browser features this application never uses. */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=(self)",
  "usb=()",
  "xr-spatial-tracking=()",
  "interest-cohort=()",
].join(", ");

export type SecurityHeaderOptions = {
  /**
   * Send HSTS. Only meaningful over TLS, and harmful to a plain-HTTP local
   * run, so it follows NODE_ENV unless overridden.
   */
  hsts?: boolean;
  /** Report-only mode for rolling a policy out without breaking a page. */
  reportOnly?: boolean;
};

/**
 * The headers, as a plain record. Exported separately so a test can assert
 * the policy itself without standing up an HTTP server.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const hsts = options.hsts ?? process.env.NODE_ENV === "production";

  const headers: Record<string, string> = {
    [options.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"]:
      contentSecurityPolicy(),
    "X-Content-Type-Options": "nosniff",
    // Redundant with frame-ancestors for modern browsers, kept for older ones.
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
  };

  if (hsts) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}

/** Express middleware applying the headers to every response. */
export function securityHeadersMiddleware(options: SecurityHeaderOptions = {}): RequestHandler {
  const headers = securityHeaders(options);
  return (_req, res, next) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  };
}
