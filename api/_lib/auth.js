import { timingSafeEqual } from "node:crypto";
import { errorResponse, getHeader } from "./http.js";

function getRequiredAdminToken() {
  const value = process.env.ADMIN_API_TOKEN;
  if (!value) {
    throw new Error("Missing required environment variable: ADMIN_API_TOKEN");
  }
  return value;
}

function getSuppliedAdminToken(req) {
  const authorization = getHeader(req, "authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const headerToken = getHeader(req, "x-admin-token");
  if (headerToken) {
    return headerToken.trim();
  }

  return "";
}

function secureCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminRequest(req) {
  const expected = getRequiredAdminToken();
  const supplied = getSuppliedAdminToken(req);
  if (!supplied) {
    return false;
  }

  return secureCompare(supplied, expected);
}

export function requireAdminRequest(req, res) {
  try {
    if (isAdminRequest(req)) {
      return true;
    }

    errorResponse(res, 401, "unauthorized", "This endpoint requires admin authentication.");
    return false;
  } catch (error) {
    errorResponse(res, 500, "backend_misconfigured", error instanceof Error ? error.message : String(error));
    return false;
  }
}
