# Energie Teilen

**Bezahlte Pilotaufnahme für lokale Energieprojekte** — a productized-intake platform for German *Mieterstrom* / *gemeinschaftliche Gebäudeversorgung* (§ EnWG) projects. A prospect models a project's economics in the browser, downloads a branded PDF report, and converts into one of three paid "pilot" packages via Stripe Checkout.

> **Status (June 2026):** Live at [energie-teilen-site.vercel.app](https://energie-teilen-site.vercel.app/). Calculator, report, and lead capture work in production. **Paid checkout and lead-email are inert until the Stripe/Resend env vars are set in Vercel** — see [§7](#7-go-live-checklist).

## Table of contents

1. [What this is (and isn't)](#1-what-this-is-and-isnt)
2. [Architecture](#2-architecture)
3. [The Rechner pipeline](#3-the-rechner-pipeline)
4. [Request & data flows](#4-request--data-flows)
5. [Repository map](#5-repository-map)
6. [Local development](#6-local-development)
7. [Go-live checklist](#7-go-live-checklist)
8. [Deployment](#8-deployment)
9. [Roadmap to revenue](#9-roadmap-to-revenue)

---

## 1. What this is (and isn't)

**It is** a marketing site + a self-serve economic calculator + a paid intake funnel. The v1 "database" is the operator's inbox (leads via Resend); payments via Stripe Checkout.

**It is not** (yet) a metering/billing SaaS, a P2P trading platform, or a CRM — deliberate future scope, see the [roadmap](#9-roadmap-to-revenue).

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript, Tailwind, Radix (shadcn), Recharts, Framer Motion, wouter |
| Backend | Express 4 on Vercel serverless (`serverless-http`) |
| Validation | Zod (shared schema, client + server) |
| Payments | Stripe Checkout + webhook |
| Email | Resend |
| PDF | jsPDF + jspdf-autotable (client-side) |
| Tests | Vitest |

---

## 2. Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser (React SPA)"]
        UI[Home.tsx / Rechner UI]
        CALC["lib/mieterstrom.ts<br/>NPV / IRR / Amortisation"]
        SENS["lib/sensitivity.ts<br/>tornado + break-even"]
        INTERP["lib/interpret.ts<br/>plain-German verdict"]
        PDF["lib/report-pdf.ts<br/>branded PDF + chart"]
        API_CLIENT["lib/pilot-api.ts<br/>typed fetch wrapper"]
        UI --> CALC --> SENS --> INTERP
        CALC --> PDF
        UI --> API_CLIENT
    end
    subgraph Edge["Vercel"]
        SERVERLESS["api/index.ts<br/>serverless-http"]
        EXPRESS["server/index.ts<br/>Express app"]
        SERVERLESS --> EXPRESS
    end
    subgraph External["External services"]
        STRIPE[("Stripe<br/>Checkout + Webhook")]
        RESEND[("Resend<br/>lead notifications")]
    end
    SHARED["shared/schema.ts - Zod<br/>single source of truth"]
    API_CLIENT -->|"POST /api/lead"| EXPRESS
    API_CLIENT -->|"POST /api/pilot-checkout"| EXPRESS
    EXPRESS -->|"create session"| STRIPE
    EXPRESS -->|"notify operator"| RESEND
    STRIPE -->|"webhook events"| EXPRESS
    CALC -.validates with.-> SHARED
    EXPRESS -.validates with.-> SHARED
    classDef ext fill:#1d493a,color:#fff,stroke:#143528
    classDef shared fill:#c79236,color:#143528,stroke:#94735b
    class STRIPE,RESEND ext
    class SHARED shared
```

- **One Zod schema** validates on client *and* server — types never drift.
- **Graceful degradation**: without env vars the API returns clean `503 config_missing` instead of crashing (current prod state).
- **All financial math is deterministic**, runs in the browser, auditable, unit-tested, no ML.

---

## 3. The Rechner pipeline

```mermaid
flowchart LR
    IN["User inputs"] --> ENGINE["calculateMieterstrom()<br/>mieterstrom.ts"]
    ENGINE --> S1["Konservativ"]
    ENGINE --> S2["Realistisch"]
    ENGINE --> S3["Optimistisch"]
    S2 --> SENS["sensitivity()<br/>rank drivers"]
    S2 --> SOLVE["solveForTarget()<br/>break-even"]
    SENS --> TORNADO["Tornado chart"]
    SOLVE --> BE["Break-even panel"]
    S1 --> INTERP["interpret()<br/>verdict + benchmark"]
    S2 --> INTERP
    S3 --> INTERP
    INTERP --> PDF["PDF report<br/>report-pdf.ts"]
    S1 --> PDF
    S2 --> PDF
    S3 --> PDF
    PDF --> CTA["CTA to paid checkout"]
    classDef engine fill:#1d493a,color:#fff
    class ENGINE,INTERP engine
```

| Module | Responsibility | Tested |
|---|---|---|
| `mieterstrom.ts` | 20-year cashflow: NPV, IRR, amortisation, CO2 | 12 tests |
| `sensitivity.ts` | driver ranking + break-even solver | 5 tests |
| `interpret.ts` | plain-German verdict / break-even / benchmark | via report tests |
| `report-pdf.ts` | branded PDF: chart, links, CTA | valid-PDF + link tests |

> The **scenario assumptions** and **benchmark band** (`6-10%`, placeholder in `interpret.ts`) still need a Mieterstrom underwriter's sign-off before selling.

---

## 4. Request & data flows

### Lead capture (free report)

```mermaid
sequenceDiagram
    actor U as Visitor
    participant R as Rechner
    participant A as Express API
    participant E as Resend
    U->>R: submits email + consent
    R->>R: downloadReportPdf() client-side
    R->>A: POST /api/lead
    A->>A: re-validate + honeypot
    alt Resend configured
        A->>E: send notification
        A-->>R: ok, persisted=server
    else not configured (current prod)
        A-->>R: ok, persisted=local
    end
    R-->>U: PDF + success toast
```

### Paid pilot checkout

```mermaid
sequenceDiagram
    actor U as Visitor
    participant R as React
    participant A as Express API
    participant S as Stripe
    U->>R: clicks Pilot starten
    R->>A: POST /api/pilot-checkout
    alt Stripe configured
        A->>S: create Checkout Session
        S-->>A: session URL
        A-->>R: url
        R->>S: redirect to checkout
    else not configured (current prod)
        A-->>R: 503 config_missing
    end
```

---

## 5. Repository map

```text
energie-teilen-site/
  api/index.ts            Vercel serverless entry (wraps Express)
  server/index.ts         Express: health, lead, pilot-checkout, webhook
  shared/schema.ts        Zod schemas - single source of truth
  shared/const.ts         offer codes, constants
  client/index.html       SEO meta, OG, JSON-LD
  client/src/pages/Home.tsx       one-page site (hero, Rechner, lead band)
  client/src/lib/
    mieterstrom.ts        economic engine + tests
    sensitivity.ts        tornado + break-even solver + tests
    interpret.ts          plain-German verdict
    report-pdf.ts         branded PDF generator + tests
    pilot-api.ts          typed fetch wrapper
  client/src/components/
    SensitivityTornado.tsx  BreakEvenPanel.tsx
    HeroRotator.tsx         SectionRotator.tsx
  scripts/fetch-hero-images.mjs   Unsplash downloader -> self-hosted webp
  vercel.json             security headers, SPA rewrite
```

---

## 6. Local development

```bash
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
pnpm dev:all
```

| Command | Purpose |
|---|---|
| `pnpm dev:all` | frontend (3000) + API (3001) |
| `pnpm check` | typecheck |
| `pnpm exec vitest run` | tests |
| `pnpm build` | production build |
| `pnpm format` | Prettier |

Pre-deploy gate: `pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`

---

## 7. Go-live checklist

Set in **Vercel -> Settings -> Environment Variables** (Production), then redeploy.

```mermaid
flowchart TD
    A["Code deployed"] --> B{Env vars set?}
    B -->|No - current state| C["checkout 503<br/>email skipped"]
    B -->|Yes| D["full funnel works"]
    C --> E["1. Create 3 Stripe prices<br/>2. Add env vars<br/>3. Redeploy"]
    E --> D
    D --> F["Validate assumptions<br/>+ legal pages"]
    F --> G["Sell to Stadtwerke"]
    classDef warn fill:#fde,stroke:#c00
    classDef ok fill:#dfe9e3,stroke:#1d493a
    class C,E warn
    class D,G ok
```

| Variable | Used for |
|---|---|
| `STRIPE_SECRET_KEY` | create Checkout sessions |
| `STRIPE_PRICE_ET_ELIGIBILITY` | price ID, tier 1 |
| `STRIPE_PRICE_ET_STRUCTURING` | price ID, tier 2 |
| `STRIPE_PRICE_ET_MANDATE` | price ID, tier 3 |
| `STRIPE_WEBHOOK_SECRET` | verify webhook signatures |
| `RESEND_API_KEY` | send lead notifications |
| `RESEND_FROM_EMAIL` | verified sender |
| `LEAD_NOTIFICATION_EMAIL` | lead destination |
| `APP_URL` | absolute URL for redirects |

> Start in Stripe **test mode** (`sk_test_...`, card `4242 4242 4242 4242`). When `GET /api/health` shows `stripe: true`, switch to live keys.

---

## 8. Deployment

Auto-deploys from `main` via GitHub -> Vercel.

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build
git add -A && git commit -m "..." && git push origin main
```

Env-var changes require a redeploy to take effect.

---

## 9. Roadmap to revenue

```mermaid
flowchart LR
    subgraph NOW["Blocks revenue"]
        ENV["Stripe/Resend env vars"]
        LEGAL["Impressum / Datenschutz / AGB"]
        ASSUMP["Validate assumptions + citations"]
    end
    subgraph NEXT["Grows funnel"]
        OG["og-image.png"]
        ANALYTICS["analytics"]
        CRM["lead datastore"]
    end
    subgraph LATER["Platform moat"]
        BILLING["metering -> billing SaaS"]
        SHARE["scenario sharing"]
    end
    NOW --> NEXT --> LATER
    classDef now fill:#fde,stroke:#c00
    class ENV,LEGAL,ASSUMP now
```

**Strategy:** the calculator already beats most competitors' public tools — the path to money is (1) turn on checkout, (2) be legally shippable, (3) get the numbers validated.

### Honest caveats

- Benchmark band + scenario assumptions are hedged placeholders, **not** underwriter-validated.
- The § EnWG citation needs an energy lawyer (brand = energy sharing §42c; product describes §42b).
- PDF contact is a personal Gmail — swap to a domain address (one constant in `report-pdf.ts`).
- Documents the repo at commit `cecd53f`; keep in sync as it evolves.
