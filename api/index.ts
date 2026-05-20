// api/index.ts
import type { IncomingMessage, ServerResponse } from "http";
import { buildApp } from "../server/index";

let appPromise: Promise<any> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = buildApp();
  const app = await appPromise;
  return app(req, res);
}
