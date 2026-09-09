# Architecture

## What this system is

A deterministic calculation stack for German distributed-energy projects, with
a website in front of it and a keyed API beside it. The website is the entry
point; the engines are the product.

## The chain

Each layer consumes the one above and adds exactly one thing. Nothing skips a
layer, and no layer invents an input it was not given.

```
market-time      the local quarter-hour grid (92 / 96 / 100 intervals per day)
      ↓
mieterstrom      the economics: yield, self-consumption, cashflow, NPV, IRR
      ↓
eligibility      whether the constellation clears the economic/structural bar
      ↓
messkonzept      how it can be metered: variant, meters, roles, critical path
      ↓
allocation       who gets which kilowatt-hour, per interval, under which key
      ↓
billing          what each participant pays, in integer cents
      ↓
mscons/edifact   the message that carries the values into the market
```

## Modules

| Module | Responsibility | Refuses to |
|---|---|---|
| `shared/market-time.ts` | Europe/Berlin quarter-hour grid, DST-correct | assume 96 intervals |
| `shared/mieterstrom.ts` | economics, deterministic | — |
| `shared/tariffs.ts` | regulated rates, bands, validity windows | return a rate outside a published band |
| `shared/assumptions.ts` | provenance and versioning of every input | present a default as sourced |
| `shared/legal-models.ts` | the three participation models | render an unverified citation |
| `shared/eligibility.ts` | qualification verdict, next paid step | claim legal admissibility |
| `shared/messkonzept.ts` | metering concept, roles, tasks | guess the grid connection |
| `shared/allocation.ts` | interval allocation under three keys | allocate more than was generated or consumed |
| `shared/billing.ts` | statements in integer cents | let line items disagree with a total |
| `shared/edifact.ts` | ISO 9735 syntax | write an unescaped value |
| `shared/market-ids.ts` | MaLo / MeLo / BDEW / EIC | report a check digit as correct on an unverified algorithm |
| `shared/mscons.ts` | the metering-value message | pad or truncate a clock-change day |
| `shared/legal-entity.ts` | the operator's own details | publish a placeholder |

## The verification gate

Three ideas run through the whole codebase, and they are what the tests
actually protect:

**1. An unverified claim never renders.** `formatCitation()` returns null while
a statutory citation is unchecked. `validateMalo()` returns
`algorithm_unverified` rather than "valid" while its check-digit algorithm is
unchecked. The MSCONS profile marks its own output as a test while its segment
usage is unchecked. The pattern is the same each time: the code separates *what
it computed* from *what it is entitled to assert*.

**2. Totals are sums, not recomputations.** A statement's net is the sum of its
own lines. A period's total is the sum of its statements. `reconcile()` re-derives
those identities from the produced result so a caller can check without trusting
the producer.

**3. An impossible input is refused, not absorbed.** 96 values for a 100-interval
day, a consumption series that does not match the generation series, a reversed
billing period: each returns an error naming the reason.

## Layout

```
client/src/       React application (Vite). Pages, components, client libraries.
server/           Express: the funnel API, the v1 API, security headers.
shared/           The engines. No DOM, no React — imported by both sides.
api/              Vercel serverless entry wrapping the Express app.
e2e/              Playwright: reachability, funnel, a11y, security, performance.
scripts/          Operational scripts (fonts, API keys, licences, dev KV).
docs/             This directory.
```

Two TypeScript projects: the root config covers client and shared with DOM
libs; `api/tsconfig.json` covers api, server and shared **without** DOM,
because the DOM's `Response` shadows Express's. `pnpm check` runs both.

## Data flow of a visit

1. The visitor moves calculator inputs. Everything is computed in the browser;
   nothing is sent.
2. The eligibility, metering, allocation and billing panels recompute from the
   same inputs, so no two panels can disagree.
3. On requesting the report, the email and the constellation go to `/api/lead`,
   and the PDF is generated client-side from the same engines.
4. On choosing a tier, `/api/pilot-checkout` creates a Stripe Checkout session.
   The client never learns a price; the server holds the price IDs.
5. Stripe calls `/api/stripe/webhook` with a signed event. The signature is
   verified, the work is idempotent, and the order is written to the ledger.

## Deliberate constraints

- Financial results are produced by deterministic code and never by a model.
- Product language is German; jurisdiction DE; currency EUR.
- No statutory paragraph is hard-coded outside `shared/legal-models.ts`;
  a test scans the source tree, `client/index.html` included.
