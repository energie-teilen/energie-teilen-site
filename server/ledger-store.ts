/**
 * server/ledger-store.ts
 *
 * Persistence for the order ledger. Thin on purpose: Redis hash + a sorted
 * index, no ORM, no migrations, no new infrastructure.
 *
 * Two design decisions worth stating:
 *
 *   1. The reference (ET-XXXXXXXX) is the key, not the Stripe session id. It
 *      is what the customer quotes, what the confirmation email carries and
 *      what the operator types. A ledger keyed on something nobody can read
 *      aloud is a ledger nobody uses.
 *
 *   2. When there is no durable store, writes DO NOT silently succeed. They
 *      return { durable: false } and the caller is expected to escalate. The
 *      previous behaviour — persistRecord() returning void whether or not it
 *      stored anything — is how a paid order became invisible.
 */

import {
  OrderLedgerRecordSchema,
  type LedgerStage,
  type OrderLedgerRecord,
} from "../shared/ledger.js";
import { getKv, isKvConfigured } from "./kv.js";

const RECORD_KEY = (reference: string) => `ledger:order:${reference}`;
/** Sorted set: score = createdAt epoch ms, member = reference. */
const INDEX_KEY = "ledger:order:index";
/** Secondary lookup so a Stripe session id still resolves. */
const SESSION_KEY = (sessionId: string) => `ledger:session:${sessionId}`;

const MAX_LIST = 500;

export type WriteResult = { durable: boolean; record: OrderLedgerRecord };

function parse(raw: unknown): OrderLedgerRecord | null {
  if (raw === null || raw === undefined) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = OrderLedgerRecordSchema.safeParse(obj);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Write (create or replace) a ledger record.
 *
 * Returns durable:false when there is no store. The record is still returned
 * so the caller can put it in an email — the inbox stays the fallback of last
 * resort, but now it is an explicit fallback rather than an accident.
 */
export async function putOrder(record: OrderLedgerRecord): Promise<WriteResult> {
  const kv = await getKv();
  if (!kv) {
    console.error(
      `[ledger] NO DURABLE STORE — order ${record.reference} exists only in Stripe and email. ` +
        `Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.`,
    );
    return { durable: false, record: { ...record, durable: false } };
  }
  const durableRecord = { ...record, durable: true };
  try {
    await kv.set(RECORD_KEY(record.reference), JSON.stringify(durableRecord));
    await kv.zadd(INDEX_KEY, {
      score: Date.parse(record.createdAt) || Date.now(),
      member: record.reference,
    });
    await kv.set(SESSION_KEY(record.sessionId), record.reference);
    return { durable: true, record: durableRecord };
  } catch (err) {
    console.error(`[ledger] write failed for ${record.reference}`, err);
    return { durable: false, record: { ...record, durable: false } };
  }
}

export async function getOrder(reference: string): Promise<OrderLedgerRecord | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    return parse(await kv.get(RECORD_KEY(reference)));
  } catch (err) {
    console.error(`[ledger] read failed for ${reference}`, err);
    return null;
  }
}

export async function getOrderBySession(sessionId: string): Promise<OrderLedgerRecord | null> {
  const kv = await getKv();
  if (!kv) return null;
  try {
    const reference = await kv.get(SESSION_KEY(sessionId));
    return typeof reference === "string" ? getOrder(reference) : null;
  } catch (err) {
    console.error(`[ledger] session lookup failed for ${sessionId}`, err);
    return null;
  }
}

/** Newest first. Capped — this is a worklist, not an export. */
export async function listOrders(limit = 100): Promise<OrderLedgerRecord[]> {
  const kv = await getKv();
  if (!kv) return [];
  const capped = Math.min(Math.max(1, limit), MAX_LIST);
  try {
    const refs: string[] = await kv.zrange(INDEX_KEY, 0, capped - 1, { rev: true });
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const raws = await kv.mget(...refs.map(RECORD_KEY));
    return (Array.isArray(raws) ? raws : [])
      .map(parse)
      .filter((r): r is OrderLedgerRecord => r !== null);
  } catch (err) {
    console.error("[ledger] list failed", err);
    return [];
  }
}

/**
 * Apply a stage change that the caller has already validated with
 * advanceStage(). Kept separate so the state machine stays in shared/ and
 * this file stays dumb.
 */
export async function saveStageChange(
  record: OrderLedgerRecord,
): Promise<WriteResult> {
  return putOrder(record);
}

export function ledgerAvailable(): boolean {
  return isKvConfigured();
}

export type { LedgerStage };
