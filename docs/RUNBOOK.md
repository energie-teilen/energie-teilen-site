# Runbook

## Verify before shipping

```bash
pnpm check          # both TypeScript projects
pnpm test           # deterministic suite
pnpm build          # production build
pnpm e2e            # browsers: reachability, funnel, a11y, security, budgets
```

`pnpm verify` runs the first three; `pnpm verify:full` runs all four.

## Deployment checklist

Work top to bottom. Everything above the line blocks a launch that takes money.

**Blocking**

1. `shared/legal-entity.ts` — fill every field, set `configured: true`.
   Verify: `RELEASE_CHECK=1 pnpm test -- client/src/lib/legal-entity.test.ts`
2. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
3. `STRIPE_PRICE_ET_ELIGIBILITY`, `STRIPE_PRICE_ET_STRUCTURING`,
   `STRIPE_PRICE_ET_MANDATE`
4. `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LEAD_NOTIFICATION_EMAIL`
5. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — without these a paid
   order is not durably enumerable.
6. `APP_URL` — used for Stripe return URLs.
7. `pnpm fonts:fetch` and commit the two `.woff2` files.

**Recommended**

8. `ADMIN_API_TOKEN` (≥ 16 chars) for the order list.
9. `ET_API_KEYS` for the v1 API — issue with `pnpm apikey:new <label>`.
10. `ET_PILOT_RESPONSE_WINDOW`, `ET_CUSTOMER_REPLY_TO`.

**Confirm after deploying**

```bash
curl -s https://<host>/api/health | jq '.status, .failing'
```

`"ok"` means every capability above is present. `"degraded"` lists exactly what
is missing and what it costs. A monitor should alert on `status != "ok"`.

## Issuing an API key

```bash
pnpm apikey:new stadtwerke-musterstadt
```

Prints the plaintext key once and the `label:hash` pair to append to
`ET_API_KEYS`. The plaintext is never stored; a leaked environment yields no
working key.

## Rotating a leaked key

1. Remove that `label:hash` entry from `ET_API_KEYS` and redeploy — the key
   stops working immediately.
2. Issue a replacement and give it to the client.

## Stripe webhook is failing

Symptoms: payments succeed but no confirmation, orders missing from the ledger.

1. `curl -s https://<host>/api/health | jq '.config.stripeWebhook'` — false
   means the secret is not set, and the endpoint answers **503** (not 200), so
   Stripe will retry once it is.
2. Check the Stripe dashboard's webhook attempts for the response status.
3. 400 means signature verification failed: the endpoint secret does not match
   the one Stripe is signing with.

## A report renders wrong numbers

The PDF and the page are computed by the same engines, so they cannot disagree
by construction. If they do, the calculation stamp on the report names the
model version and assumption set; reproduce with that stamp and open an issue
against the engine, not the PDF.

## Restoring typography

`pnpm fonts:fetch` downloads the two variable fonts into
`client/public/fonts`. The build works without them — every family declares a
full fallback stack — but the intended typography needs them present.

## What to alert on

| Signal | Meaning |
|---|---|
| `/api/health` `status != "ok"` | a revenue-critical capability is missing |
| Stripe webhook 4xx/5xx rate | payments are settling without fulfilment |
| `/api/lead` 5xx rate | leads are being lost |
| E2E failure on main | a shipped regression |
