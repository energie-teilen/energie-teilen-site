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

Work top to bottom. `GET /api/health` and `pnpm doctor` read the same register
(`shared/health.ts`), so the ids in brackets are what they report.

**Revenue blockers** — while any is missing, health says `blocked`, the
doctor exits 1, and no euro can move.

1. `STRIPE_SECRET_KEY` [`stripe_secret_key`] — test key first, live key after
   a successful test purchase. Health reports the mode as `stripeMode`.
2. `STRIPE_PRICE_ET_ELIGIBILITY`, `STRIPE_PRICE_ET_STRUCTURING`,
   `STRIPE_PRICE_ET_MANDATE` [`stripe_price_et_*`] — one-time EUR prices.
   Server-side only; the browser never learns a price ID.
3. `APP_URL` [`app_url`] — the public https origin. Used for Stripe return
   URLs; a localhost or plain-http value is refused in production.
4. `STRIPE_WEBHOOK_SECRET` [`stripe_webhook_secret`] — endpoint
   `<APP_URL>/api/stripe/webhook` for `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`.
5. `shared/legal-entity.ts` [`legal_entity`] — fill every field, set
   `configured: true`. Health checks the record itself, not only the flag.
   Verify: `RELEASE_CHECK=1 pnpm test -- client/src/lib/legal-entity.test.ts`

**Fulfilment** — payment works, delivery or record-keeping does not. Health
says `degraded`; the doctor prints them and exits 0.

6. `RESEND_API_KEY` [`resend_api_key`], `RESEND_FROM_EMAIL`
   [`resend_from_email`] on a Resend-verified domain, `LEAD_NOTIFICATION_EMAIL`
   [`lead_notification_email`] — domain mailboxes only.
7. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` [`durable_kv`] —
   without these a paid order is not durably enumerable.
8. `ADMIN_API_TOKEN` [`admin_api_token`] — at least 32 random characters;
   below 16 the admin surface stays disabled.

**Optional** — reported, never changes the status.

9. `ET_API_KEYS` [`api_keys`] for the v1 API — issue with
   `pnpm apikey:new <label>`.
10. `ET_PILOT_RESPONSE_WINDOW`, `ET_CUSTOMER_REPLY_TO` (not scored).
11. `pnpm fonts:fetch` and commit the two `.woff2` files (not scored).

A value copied verbatim from `.env.example` (ending in `...`) counts as not
configured, and health says so.

**Confirm after deploying**

```bash
pnpm doctor                          # APP_URL if set, else the public host
pnpm doctor https://<host>
curl -s https://<host>/api/health | jq '.status, .failing'
```

| `status` | Meaning | `pnpm doctor` exit |
|---|---|---|
| `ok` | every revenue blocker and fulfilment capability present | 0 |
| `degraded` | money can move; fulfilment is missing something | 0 |
| `blocked` | at least one revenue blocker is missing | 1 |
| — | site unreachable, or it answers without a scoreboard | 2 |

Each entry in `.capabilities` carries `id`, `severity`, `present`,
`cost_if_missing`, `fix` and, when a value is set but unusable, `problem`.
`.env` reports the presence of each variable as a boolean. No value is ever
returned. A monitor should alert on `status != "ok"`.

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
| `/api/health` `status == "blocked"` | no payment can be taken |
| `/api/health` `status == "degraded"` | payments work, fulfilment is incomplete |
| Stripe webhook 4xx/5xx rate | payments are settling without fulfilment |
| `/api/lead` 5xx rate | leads are being lost |
| E2E failure on main | a shipped regression |
