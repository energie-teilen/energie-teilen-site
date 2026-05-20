import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  memo,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BatteryCharging,
  Building2,
  Calculator,
  ChevronRight,
  Download,
  Factory,
  Landmark,
  Leaf,
  LineChart,
  MapPinned,
  Network,
  ShieldCheck,
  TrendingUp,
  Users2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { CapacityBanner } from "@/components/pilot/CapacityBanner";
import { PilotCheckoutForm } from "@/components/pilot/PilotCheckoutForm";
import { PilotOfferCards } from "@/components/pilot/PilotOfferCards";
import {
  getPilotOfferContent,
  submitLead,
  PilotApiError,
  type PilotOfferCode,
  type MieterstromInputs,
} from "@/lib/pilot-api";

/**
 * Energy Civic Ledger design reminder for this file:
 * Use chapter-based editorial storytelling, asymmetric composition, civic-tech credibility,
 * and German professional business language tailored only to Energie Teilen.
 * If a choice feels generic, decorative, or startup-like, reject it.
 *
 * UPGRADE NOTES — this revision adds a free Mieterstrom-Rechner as Kapitel 02
 * and funnels its captured leads directly into the existing paid pilot intake.
 * The new section is additive — every existing chapter, asset, image, and word
 * is preserved. Chapter numbers shift by one to make room for the calculator.
 *
 * Performance disciplines applied to the new section:
 *   - useDeferredValue on the slider state keeps the UI responsive while
 *     three parallel scenarios are recomputed.
 *   - Three scenarios (konservativ / realistisch / optimistisch) are each
 *     wrapped in their own useMemo so React processes them independently and
 *     skips work when inputs haven't changed.
 *   - The cashflow chart is React.memo'd so slider drags don't re-render it
 *     when its data reference is stable.
 *   - Inputs are persisted to localStorage so returning visitors see their
 *     last scenario without a network round-trip.
 *   - Lead capture POSTs to /api/lead (your Express server) with a graceful
 *     fallback to localStorage if the endpoint isn't wired yet.
 */

// ============================================================================
// EXISTING CONTENT — preserved verbatim
// ============================================================================

const serviceModules = [
  {
    title: "Standort- und Quartiersmodellierung",
    text: "Energie Teilen strukturiert Vorhaben für Gebäude, Areale und Quartiere so, dass lokale Erzeugung, Verbrauch und betriebliche Rollen in ein belastbares Gesamtmodell überführt werden.",
    icon: Building2,
  },
  {
    title: "Teilnehmer- und Rollenstruktur",
    text: "Die Plattform ordnet Eigentümer, Betreiber, Nutzer, technische Partner und weitere Beteiligte in eine klare operative Struktur mit nachvollziehbaren Zuständigkeiten ein.",
    icon: Users2,
  },
  {
    title: "Verteilungs- und Nutzungslogik",
    text: "Energieflüsse, Verbrauchsbezüge und standortbezogene Konstellationen werden in eine verständliche operative Logik übersetzt, die für Projekte und Portfolios anschlussfähig ist.",
    icon: Network,
  },
  {
    title: "Betriebsnahe Auswertungen",
    text: "Energie Teilen bereitet projektrelevante Kennzahlen, Zustände und Strukturinformationen so auf, dass sie für Steuerung, Kommunikation und Projektentscheidungen nutzbar werden.",
    icon: LineChart,
  },
];

const stakeholders = [
  {
    title: "Bestandshalter und Eigentümer",
    text: "Für Immobilienbestände mit dem Anspruch, lokale Energiepotenziale professionell in den Betrieb und in die Objektstrategie einzubinden.",
  },
  {
    title: "Projektentwickler und Arealträger",
    text: "Für neue Quartiere und komplexe Projektstrukturen, in denen mehrere Erzeugungs-, Verbrauchs- und Betreiberrollen sauber zusammengeführt werden müssen.",
  },
  {
    title: "Gemeinden und kommunale Akteure",
    text: "Für lokale Konstellationen, in denen Energieprojekte nachvollziehbar, strukturiert und professionell kommuniziert werden sollen.",
  },
  {
    title: "Betriebs- und Infrastrukturpartner",
    text: "Für Partner, die belastbare Schnittstellen zu Verbrauch, Verteilung, Anlagenlogik und Projektorganisation benötigen.",
  },
];

const valueRows = [
  ["Projektbild", "Ein klar strukturiertes Gesamtbild aus Erzeugung, Verbrauch, Rollen und Standortlogik."],
  ["Operative Lesbarkeit", "Komplexe Konstellationen werden in eine verständliche, geschäftsfähige Darstellung überführt."],
  ["Stakeholder-Fähigkeit", "Beteiligte erhalten eine gemeinsame Sprache für Entscheidungen, Einordnung und Abstimmung."],
  ["Pilotfähigkeit", "Relevante Vorhaben können direkt in eine bezahlte Pilotaufnahme und strukturierte Dokumentenphase überführt werden."],
];

const flowSteps = [
  {
    number: "01",
    title: "Konstellation erfassen",
    text: "Standorttyp, Rollenbild und Projektziel werden in eine belastbare Ausgangslage überführt.",
  },
  {
    number: "02",
    title: "Paket auswählen",
    text: "Die bezahlte Pilotstufe wird passend zur Komplexität der Konstellation serverseitig vorbereitet.",
  },
  {
    number: "03",
    title: "Checkout abschließen",
    text: "Die Pilotaufnahme wird per sicherem Checkout ausgelöst, ohne clientseitige Preislogik oder manuelle Angebotsbrüche.",
  },
  {
    number: "04",
    title: "Intake und Unterlagen fortsetzen",
    text: "Nach erfolgreicher Zahlung folgen strukturierte Intake- und Dokumentenschritte für die operative Bearbeitung.",
  },
];

const readinessSignals = [
  {
    title: "Gebäude und Standorte",
    text: "Einzelobjekte, Areale und Portfolios mit lokaler Erzeugung, Nutzungsbezug oder geplanter Projektstruktur.",
    icon: Building2,
  },
  {
    title: "Quartiere und Betriebslogiken",
    text: "Vorhaben mit mehreren Nutzergruppen, Betreiberrollen oder organisationaler Abstimmungslast.",
    icon: BatteryCharging,
  },
  {
    title: "Kommunale und institutionelle Fälle",
    text: "Konstellationen mit Entscheidungsdruck, Dokumentationsbedarf und mehreren Beteiligungsebenen.",
    icon: Landmark,
  },
  {
    title: "Infrastruktur- und Partnerfälle",
    text: "Partner, Dienstleister und technische Akteure, die eine klare Projektlogik benötigen.",
    icon: Factory,
  },
];

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6 },
};

function SectionIntro({
  chapter,
  eyebrow,
  title,
  text,
}: {
  chapter: string;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10">
      <div className="section-index">
        <span>{chapter}</span>
        <div className="section-index-line" />
        <small>{eyebrow}</small>
      </div>
      <div className="max-w-3xl space-y-4">
        <p className="section-kicker">{eyebrow}</p>
        <h2 className="font-display text-3xl leading-tight font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
          {title}
        </h2>
        <p className="text-base leading-8 text-muted-foreground sm:text-lg">{text}</p>
      </div>
    </div>
  );
}

// ============================================================================
// NEW: MIETERSTROM CALCULATOR — pure functions + UI
// MieterstromInputs is imported from @/lib/pilot-api (single source of truth in
// shared/schema.ts). MieterstromYear and MieterstromResult are local result
// shapes; the engine output never crosses the network.
// ============================================================================

type MieterstromYear = {
  jahr: number;
  ertragKwh: number;
  eigenverbrauchKwh: number;
  einspeisungKwh: number;
  cashflowEur: number;
  kumulierterCashflowEur: number;
};

type MieterstromResult = {
  inputs: MieterstromInputs;
  jahre: MieterstromYear[];
  kpis: {
    investitionEur: number;
    amortisationsdauerJahre: number | null;
    npvEur: number;
    irrPct: number | null;
    erlosKumEur: number;
    co2EinsparungT: number;
  };
};

const DEFAULTS: MieterstromInputs = {
  kwp: 30,
  anzahlWohneinheiten: 12,
  eigenverbrauchsquote: 0.45,
  strompreisMieterCtPerKwh: 32,
  mieterstromZuschlagCtPerKwh: 2.5,
  einspeiseverguetungCtPerKwh: 7.86,
  investitionEurPerKwp: 1400,
  betriebskostenEurPerKwpJahr: 20,
  laufzeitJahre: 20,
  diskontierungssatz: 0.04,
  degradationPctPerJahr: 0.005,
  spezifischerErtragKwhPerKwp: 950,
};

const CO2_FACTOR_DE_T_PER_MWH = 0.38;
const STORAGE_KEY = "et:rechner:v1";

// Pure function — same math regardless of how many scenarios you run in parallel.
function calculateMieterstrom(inputs: MieterstromInputs): MieterstromResult {
  const investitionEur = inputs.investitionEurPerKwp * inputs.kwp;
  const jahre: MieterstromYear[] = [];
  let kumulierterCashflow = -investitionEur;
  let npv = -investitionEur;

  for (let j = 1; j <= inputs.laufzeitJahre; j++) {
    const degradation = (1 - inputs.degradationPctPerJahr) ** (j - 1);
    const ertragKwh =
      inputs.kwp * inputs.spezifischerErtragKwhPerKwp * degradation;
    const eigenverbrauchKwh = ertragKwh * inputs.eigenverbrauchsquote;
    const einspeisungKwh = ertragKwh - eigenverbrauchKwh;

    const erloesMieterstrom =
      (eigenverbrauchKwh * inputs.strompreisMieterCtPerKwh) / 100;
    const erloesZuschlag =
      (eigenverbrauchKwh * inputs.mieterstromZuschlagCtPerKwh) / 100;
    const erloesEinspeisung =
      (einspeisungKwh * inputs.einspeiseverguetungCtPerKwh) / 100;
    const betriebskosten =
      inputs.betriebskostenEurPerKwpJahr * inputs.kwp * (1 + 0.02) ** (j - 1);

    const cashflow =
      erloesMieterstrom + erloesZuschlag + erloesEinspeisung - betriebskosten;
    kumulierterCashflow += cashflow;
    npv += cashflow / (1 + inputs.diskontierungssatz) ** j;

    jahre.push({
      jahr: j,
      ertragKwh: round2(ertragKwh),
      eigenverbrauchKwh: round2(eigenverbrauchKwh),
      einspeisungKwh: round2(einspeisungKwh),
      cashflowEur: round2(cashflow),
      kumulierterCashflowEur: round2(kumulierterCashflow),
    });
  }

  const amortisation = findAmortisation(jahre);
  const irr = calculateIRR(
    jahre.map((j) => j.cashflowEur),
    investitionEur,
  );
  const erlosKumEur = jahre.reduce((s, j) => s + j.cashflowEur, 0) + investitionEur;
  const totalEigenverbrauchKwh = jahre.reduce((s, j) => s + j.eigenverbrauchKwh, 0);

  return {
    inputs,
    jahre,
    kpis: {
      investitionEur: round2(investitionEur),
      amortisationsdauerJahre: amortisation,
      npvEur: round2(npv),
      irrPct: irr === null ? null : round2(irr * 100),
      erlosKumEur: round2(erlosKumEur),
      co2EinsparungT: round2((totalEigenverbrauchKwh / 1000) * CO2_FACTOR_DE_T_PER_MWH),
    },
  };
}

function findAmortisation(jahre: MieterstromYear[]): number | null {
  for (let i = 0; i < jahre.length; i++) {
    const j = jahre[i];
    if (j.kumulierterCashflowEur >= 0) {
      const prev = i > 0 ? jahre[i - 1] : null;
      if (!prev || prev.kumulierterCashflowEur >= 0) return j.jahr;
      const fraction =
        Math.abs(prev.kumulierterCashflowEur) /
        (Math.abs(prev.kumulierterCashflowEur) + j.kumulierterCashflowEur);
      return round2(prev.jahr + fraction);
    }
  }
  return null;
}

// Newton-Raphson IRR
function calculateIRR(cashflows: number[], investition: number): number | null {
  let r = 0.1;
  for (let iter = 0; iter < 80; iter++) {
    let npv = -investition;
    let derivative = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const t = i + 1;
      const cf = cashflows[i];
      npv += cf / (1 + r) ** t;
      derivative -= (t * cf) / (1 + r) ** (t + 1);
    }
    if (Math.abs(npv) < 0.01) return r;
    if (derivative === 0) return null;
    const next = r - npv / derivative;
    if (!Number.isFinite(next) || next < -0.99) return null;
    r = next;
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function eurFmt(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n);
}

// --- Lead capture is delegated to `submitLead` from @/lib/pilot-api.
// It validates against the shared schema, POSTs to /api/lead, and falls back
// to localStorage if the network/server is unreachable. No lead is ever lost.

// --- Components for the calculator section ---

const ScenarioCashflowChart = memo(function ScenarioCashflowChart({
  data,
  accent,
}: {
  data: Array<{ jahr: number; kumuliert: number }>;
  accent: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`grad-${accent}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.08)" />
        <XAxis
          dataKey="jahr"
          stroke="rgba(0,0,0,0.4)"
          fontSize={11}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          stroke="rgba(0,0,0,0.4)"
          fontSize={11}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v: number) => [`${eurFmt(v)} €`, "Kumuliert"]}
          labelFormatter={(l) => `Jahr ${l}`}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.08)",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="kumuliert"
          stroke={accent}
          strokeWidth={2}
          fill={`url(#grad-${accent})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

type ScenarioLabel = "konservativ" | "realistisch" | "optimistisch";

const SCENARIO_META: Record<
  ScenarioLabel,
  { title: string; subtitle: string; accent: string }
> = {
  konservativ: {
    title: "Konservativ",
    subtitle: "höhere Investition, niedrigere Eigenverbrauchsquote",
    accent: "#94735b",
  },
  realistisch: {
    title: "Realistisch",
    subtitle: "Standardannahmen für die DACH-Region",
    accent: "#1d493a",
  },
  optimistisch: {
    title: "Optimistisch",
    subtitle: "Speicher und Lastmanagement gut ausgelegt",
    accent: "#c79236",
  },
};

function ScenarioCard({
  scenario,
  result,
  isPrimary,
}: {
  scenario: ScenarioLabel;
  result: MieterstromResult;
  isPrimary?: boolean;
}) {
  const meta = SCENARIO_META[scenario];
  const chartData = useMemo(
    () =>
      result.jahre.map((j) => ({ jahr: j.jahr, kumuliert: j.kumulierterCashflowEur })),
    [result.jahre],
  );
  const npvPositive = result.kpis.npvEur > 0;

  return (
    <Card
      className={`ledger-panel border-border/70 bg-card transition-shadow ${
        isPrimary ? "shadow-[0_24px_64px_rgba(18,32,27,0.10)]" : ""
      }`}
    >
      <CardContent className="space-y-5 p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p
              className="text-[0.72rem] font-medium uppercase tracking-[0.2em]"
              style={{ color: meta.accent }}
            >
              {meta.title}
            </p>
            {isPrimary ? (
              <Badge className="rounded-full bg-primary/10 px-3 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-primary hover:bg-primary/10">
                Basisszenario
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <KPI label="NPV (20 J.)" value={`${eurFmt(result.kpis.npvEur)} €`} highlight={npvPositive} />
          <KPI
            label="Amortisation"
            value={
              result.kpis.amortisationsdauerJahre
                ? `${result.kpis.amortisationsdauerJahre.toFixed(1)} J.`
                : "—"
            }
          />
          <KPI
            label="IRR"
            value={
              result.kpis.irrPct === null
                ? "—"
                : `${result.kpis.irrPct.toFixed(1)} %`
            }
          />
          <KPI label="Investition" value={`${eurFmt(result.kpis.investitionEur)} €`} />
        </div>

        <ScenarioCashflowChart data={chartData} accent={meta.accent} />

        <div className="flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span>Kum. Erlös (20 J.)</span>
          <span className="font-medium text-foreground tabular-nums">
            {eurFmt(result.kpis.erlosKumEur)} €
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>CO₂-Einsparung</span>
          <span className="font-medium text-foreground tabular-nums">
            {result.kpis.co2EinsparungT.toFixed(1)} t
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function KPI({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-lg font-semibold tabular-nums tracking-[-0.02em] ${
          highlight ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label={label}
      />
    </div>
  );
}

function MieterstromRechner({ onProceedToPilot }: { onProceedToPilot: () => void }) {
  const [inputs, setInputs] = useState<MieterstromInputs>(DEFAULTS);
  const [, startTransition] = useTransition();

  // Hydrate from localStorage on first mount (returning visitor sees last scenario)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MieterstromInputs>;
        setInputs((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist inputs (cheap; runs on every committed change)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      // localStorage might be full or disabled — silently continue
    }
  }, [inputs]);

  // Defer the heavy work so slider drags stay smooth
  const deferredInputs = useDeferredValue(inputs);

  // Three independent memoised scenarios — React skips work when inputs haven't moved.
  const baseScenario = useMemo(
    () => calculateMieterstrom(deferredInputs),
    [deferredInputs],
  );
  const conservativeScenario = useMemo(
    () =>
      calculateMieterstrom({
        ...deferredInputs,
        eigenverbrauchsquote: Math.max(0.15, deferredInputs.eigenverbrauchsquote - 0.12),
        investitionEurPerKwp: deferredInputs.investitionEurPerKwp + 200,
        betriebskostenEurPerKwpJahr: deferredInputs.betriebskostenEurPerKwpJahr + 6,
      }),
    [deferredInputs],
  );
  const optimisticScenario = useMemo(
    () =>
      calculateMieterstrom({
        ...deferredInputs,
        eigenverbrauchsquote: Math.min(0.85, deferredInputs.eigenverbrauchsquote + 0.15),
        investitionEurPerKwp: Math.max(900, deferredInputs.investitionEurPerKwp - 200),
        betriebskostenEurPerKwpJahr: Math.max(10, deferredInputs.betriebskostenEurPerKwpJahr - 4),
      }),
    [deferredInputs],
  );

  function update<K extends keyof MieterstromInputs>(k: K, v: MieterstromInputs[K]) {
    startTransition(() => setInputs((prev) => ({ ...prev, [k]: v })));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr] xl:gap-8">
      {/* INPUTS */}
      <Card className="ledger-panel h-fit border-border/70 bg-card">
        <CardContent className="space-y-6 p-6 lg:p-7">
          <div className="space-y-2">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
              Eingaben
            </p>
            <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
              Konstellation in Zahlen
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              Eingaben laufen vollständig im Browser. Es werden keine Werte
              automatisch übertragen, bevor Sie aktiv zustimmen.
            </p>
          </div>

          <div className="space-y-5">
            <SliderField
              label="Anlagengröße"
              value={inputs.kwp}
              display={`${inputs.kwp} kWp`}
              min={5}
              max={300}
              onChange={(v) => update("kwp", v)}
            />
            <SliderField
              label="Wohneinheiten"
              value={inputs.anzahlWohneinheiten}
              display={`${inputs.anzahlWohneinheiten}`}
              min={2}
              max={100}
              onChange={(v) => update("anzahlWohneinheiten", v)}
            />
            <SliderField
              label="Eigenverbrauchsquote"
              value={Math.round(inputs.eigenverbrauchsquote * 100)}
              display={`${Math.round(inputs.eigenverbrauchsquote * 100)} %`}
              min={10}
              max={90}
              onChange={(v) => update("eigenverbrauchsquote", v / 100)}
            />
            <SliderField
              label="Strompreis Mieter"
              value={inputs.strompreisMieterCtPerKwh}
              display={`${inputs.strompreisMieterCtPerKwh.toFixed(1)} ct/kWh`}
              min={20}
              max={50}
              step={0.5}
              onChange={(v) => update("strompreisMieterCtPerKwh", v)}
            />
            <SliderField
              label="Investition"
              value={inputs.investitionEurPerKwp}
              display={`${inputs.investitionEurPerKwp} €/kWp`}
              min={800}
              max={2200}
              step={50}
              onChange={(v) => update("investitionEurPerKwp", v)}
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/70 p-4 text-xs leading-6 text-muted-foreground">
            Berechnung umfasst Mieterstromzuschlag, Eigenverbrauch, Einspeisung,
            Degradation (0,5 % p.a.) und Diskontierung. Standardannahmen für die
            DACH-Region. Drei Szenarien werden parallel ausgewertet.
          </div>
        </CardContent>
      </Card>

      {/* THREE-COLUMN SCENARIO RESULT */}
      <div className="space-y-6">
        <div className="grid gap-5 md:grid-cols-3">
          <ScenarioCard scenario="konservativ" result={conservativeScenario} />
          <ScenarioCard scenario="realistisch" result={baseScenario} isPrimary />
          <ScenarioCard scenario="optimistisch" result={optimisticScenario} />
        </div>

        <LeadCaptureBand
          inputs={inputs}
          result={baseScenario}
          onProceedToPilot={onProceedToPilot}
        />
      </div>
    </div>
  );
}

function LeadCaptureBand({
  inputs,
  result,
  onProceedToPilot,
}: {
  inputs: MieterstromInputs;
  result: MieterstromResult;
  onProceedToPilot: () => void;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Minimal client guard — the imported submitLead re-validates with the
    // shared schema, and the server validates again. Defence in depth.
    if (!email.trim() || !consent) {
      toast.error("Bitte E-Mail eingeben und Einwilligung bestätigen.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitLead({
        email: email.trim(),
        source: "rechner-mieterstrom-rendite",
        consent: true,
        payload: { inputs, kpis: result.kpis },
      });
      setDone(true);
      if (res.persisted === "server") {
        toast.success(
          "Vielen Dank. Der Bericht wird vorbereitet und an Ihre Adresse gesendet.",
        );
      } else {
        // Local fallback — server unavailable, but the lead is queued
        toast.success(
          "Anfrage gespeichert. Wir melden uns, sobald die Verarbeitung möglich ist.",
        );
      }
    } catch (err) {
      const msg =
        err instanceof PilotApiError
          ? err.message
          : "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="ledger-panel overflow-hidden border-border/70 bg-card">
      <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
        <div className="space-y-3">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
            Bericht freischalten
          </p>
          <h3 className="font-display text-xl font-semibold leading-snug tracking-[-0.02em] text-foreground">
            20-Jahres-Bericht inkl. Messkonzept-Skizze nach §42b EnWG.
          </h3>
          <p className="text-sm leading-7 text-muted-foreground">
            Sie erhalten die drei Szenarien als druckbares PDF, inklusive einer
            Messkonzept-Skizze für den Messstellenbetreiber. Anschließend können Sie
            die Konstellation direkt in die bezahlte Pilotaufnahme überführen.
          </p>
        </div>

        {done ? (
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-primary/15 bg-primary/6 p-5">
            <div className="space-y-2">
              <p className="font-display text-base font-semibold text-foreground">
                Bericht wird vorbereitet.
              </p>
              <p className="text-sm leading-7 text-muted-foreground">
                Wenn Sie diese Konstellation jetzt als bezahlten Pilot strukturieren
                möchten, ist der nächste Schritt direkt unten verfügbar.
              </p>
            </div>
            <Button
              onClick={onProceedToPilot}
              size="lg"
              className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/92"
            >
              Konstellation strukturieren
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="lead-email" className="text-sm font-medium text-foreground">
                Geschäftliche E-Mail
              </label>
              <input
                id="lead-email"
                type="email"
                required
                placeholder="ihre@firma.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:bg-background"
              />
            </div>
            <label className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 accent-primary"
              />
              <span>
                Ich willige ein, gelegentlich Informationen zu §42b EnWG, Mieterstrom
                und der bezahlten Pilotaufnahme zu erhalten. Widerruf jederzeit
                möglich.
              </span>
            </label>
            <Button
              type="submit"
              disabled={submitting}
              size="lg"
              className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/92"
            >
              {submitting ? (
                "Wird vorbereitet…"
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Bericht freischalten
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function Home() {
  const [selectedOfferCode, setSelectedOfferCode] =
    useState<PilotOfferCode>("et_structuring");
  const selectedOffer = useMemo(
    () => getPilotOfferContent(selectedOfferCode),
    [selectedOfferCode],
  );
  const pilotCapacityRemaining = Number.parseInt(
    import.meta.env.VITE_PILOT_CAPACITY_REMAINING || "",
    10,
  );
  const hasCapacitySignal =
    Number.isFinite(pilotCapacityRemaining) && pilotCapacityRemaining >= 0;

  function handleProceedToForm() {
    const target = document.getElementById("pilot-checkout-form");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleProceedToPilotStart() {
    const target = document.getElementById("pilot-start");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main>
        {/* =================================================================
            KAPITEL 01 — HERO (preserved)
            ================================================================= */}
        <section id="top" className="ledger-hero relative overflow-hidden pt-28 sm:pt-32">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(199,146,54,0.09),transparent_28%),radial-gradient(circle_at_right,rgba(29,73,58,0.12),transparent_34%)]" />
          <div className="container relative">
            <div className="grid items-end gap-10 pb-16 lg:grid-cols-[1.04fr_0.96fr] lg:gap-14 lg:pb-24">
              <motion.div
                className="space-y-8"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75 }}
              >
                <div className="space-y-4">
                  <Badge className="rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 font-body text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary hover:bg-primary/10">
                    Paid Pilot Platform
                  </Badge>
                  <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
                    <div className="chapter-pill">Kapitel 01</div>
                    <div className="space-y-5">
                      <h1 className="font-display max-w-4xl text-4xl leading-[0.96] font-semibold tracking-[-0.05em] text-foreground sm:text-5xl lg:text-[4.5rem]">
                        Energie Teilen führt lokale Energieprojekte in eine bezahlte, belastbare Pilotaufnahme.
                      </h1>
                      <p className="max-w-2xl font-body text-lg leading-8 text-muted-foreground sm:text-xl">
                        Die Website ist nicht länger nur eine Darstellung. Sie wird zum operativen Einstieg für Eigentümer,
                        Quartiere, Projektträger und kommunale Akteure, die ihre Konstellation professionell qualifizieren,
                        strukturieren und in eine belastbare nächste Stufe überführen wollen.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Monetisierbar</span>
                        <ShieldCheck className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Drei serverseitig geführte Pilotpakete statt unverbindlicher Kontaktstrecke
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Betrieblicher Fokus</span>
                        <Leaf className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Lokale Erzeugung, Verbrauch, Verteilung und belastbare Projektaufnahme
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm sm:col-span-2 xl:col-span-1">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Zielgruppenfit</span>
                        <Landmark className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Immobilien, Quartiere, kommunale Kontexte und Infrastrukturpartner
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {hasCapacitySignal ? <CapacityBanner remaining={pilotCapacityRemaining} /> : null}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-primary px-6 text-primary-foreground shadow-[0_12px_30px_rgba(29,73,58,0.24)] hover:bg-primary/92"
                  >
                    <a href="#pilot-start">
                      Pilot starten
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="rounded-full border-border bg-background/70 px-6 text-foreground hover:bg-muted"
                  >
                    <a href="#rechner">
                      <Calculator className="mr-2 h-4 w-4" />
                      Rendite-Rechner öffnen
                    </a>
                  </Button>
                </div>
              </motion.div>

              <motion.div
                className="relative lg:pb-6"
                initial={{ opacity: 0, scale: 0.98, y: 22 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.08 }}
              >
                <div className="absolute -left-10 top-10 hidden h-36 w-36 rounded-full bg-primary/10 blur-3xl lg:block" />
                <div className="hero-frame">
                  <img
                    src="https://d2xsxph8kpxj0f.cloudfront.net/107050196/atEQdzJHpzRWntNYZpob6k/energie-teilen-hero-network-VjgL6vHPc99hnkyTaNsfW5.webp"
                    alt="Vernetzte urbane Energieinfrastruktur für Energie Teilen"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="hero-note lg:absolute lg:-bottom-6 lg:-left-12">
                  <span className="hero-note-label">Frankfurt · Deutschland</span>
                  <p>
                    Energie Teilen verbindet anspruchsvolle Projektkommunikation mit
                    einer klaren bezahlten Einstiegslinie, damit aus Interesse eine
                    geordnete Pilotbearbeitung wird.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* =================================================================
            KAPITEL 02 — RECHNER (new — funnels free users to paid pilot)
            ================================================================= */}
        <motion.section id="rechner" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="02"
              eyebrow="Rechner"
              title="Konstellation in 30 Sekunden als belastbare Wirtschaftlichkeitsrechnung verstehen"
              text="Drei parallel berechnete Szenarien — konservativ, realistisch und optimistisch — zeigen Ihnen NPV, Amortisationsdauer, IRR und kumulierte Erlöse über 20 Jahre. Die Berechnung läuft vollständig im Browser. Das Ergebnis lässt sich anschließend ohne Bruch in die bezahlte Pilotaufnahme überführen."
            />

            <MieterstromRechner onProceedToPilot={handleProceedToPilotStart} />

            <div className="grid gap-6 lg:grid-cols-3">
              <RechnerBenefit
                icon={TrendingUp}
                title="Drei Szenarien gleichzeitig"
                text="Konservativ, realistisch und optimistisch laufen parallel — keine Klick-Wechsel, kein Datenverlust."
              />
              <RechnerBenefit
                icon={ShieldCheck}
                title="Auditfähige Annahmen"
                text="Standardparameter für Mieterstromzuschlag, Degradation und Diskontierung. Jede Annahme ist im Bericht dokumentiert."
              />
              <RechnerBenefit
                icon={MapPinned}
                title="Direkter Übergang in den Pilot"
                text="Wenn die Zahlen tragen, geht die Konstellation ohne Bruch in die bezahlte Pilotaufnahme über."
              />
            </div>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 03 — ÜBERBLICK (was 02)
            ================================================================= */}
        <motion.section id="ueberblick" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="03"
              eyebrow="Überblick"
              title="Die stärkste Position entsteht dort, wo Darstellung und bezahlter Start zusammenlaufen"
              text="Energie Teilen übersetzt lokale Energiekonstellationen nicht nur in ein professionelles Bild, sondern auch in einen klaren operativen Einstieg. Interessenten müssen nicht mehr erst eine lose Anfrage formulieren, sondern können die passende Pilotstufe auswählen und direkt in eine belastbare Aufnahme übergehen."
            />

            <div className="grid gap-6 xl:grid-cols-4">
              {readinessSignals.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title} className="ledger-panel border-border/70 bg-card">
                    <CardContent className="space-y-4 p-6">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="font-display text-xl font-semibold tracking-[-0.03em] text-foreground">
                          {item.title}
                        </h3>
                        <p className="text-base leading-7 text-muted-foreground">
                          {item.text}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 04 — LEISTUNGEN (was 03)
            ================================================================= */}
        <motion.section id="leistungen" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="04"
              eyebrow="Leistungen"
              title="Die Leistung wird so aufbereitet, dass aus Komplexität ein verkäuflicher, bearbeitbarer Projektzugang entsteht"
              text="Die Plattform ist auf Konstellationen ausgelegt, in denen mehrere technische, organisatorische oder betriebliche Ebenen zusammenkommen. Der Wert entsteht aus Struktur, professioneller Lesbarkeit und der Fähigkeit, eine Konstellation in ein belastbares nächstes Arbeitsformat zu überführen."
            />

            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
              {serviceModules.map(({ title, text, icon: Icon }) => (
                <Card
                  key={title}
                  className="ledger-panel group border-border/70 bg-card transition-transform duration-300 hover:-translate-y-1"
                >
                  <CardContent className="space-y-6 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
                        {title}
                      </h3>
                      <p className="font-body text-base leading-8 text-muted-foreground">
                        {text}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 05 — STRUKTUR (was 04)
            ================================================================= */}
        <motion.section id="struktur" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="05"
              eyebrow="Struktur"
              title="Ein verständliches Gesamtbild aus Einordnung, Paketwahl, Checkout und Intake"
              text="Die operative Leselogik endet nicht bei der Beschreibung eines Projekts. Sie setzt sich in der bezahlten Pilotaufnahme fort. Dadurch wird aus einer Marketingoberfläche eine funktionierende geschäftliche Oberfläche mit klaren Übergängen zwischen Interesse, Zahlung und Bearbeitung."
            />

            <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
              <Card className="ledger-panel border-border/70 bg-card">
                <CardContent className="space-y-8 p-8 lg:p-10">
                  {flowSteps.map((step) => (
                    <div
                      key={step.number}
                      className="grid gap-4 border-b border-border/70 pb-6 last:border-none last:pb-0 md:grid-cols-[72px_1fr]"
                    >
                      <div className="flow-number">{step.number}</div>
                      <div className="space-y-2">
                        <h3 className="font-display text-xl font-semibold text-foreground">
                          {step.title}
                        </h3>
                        <p className="text-base leading-7 text-muted-foreground">
                          {step.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="ledger-panel overflow-hidden border-border/70 bg-card">
                <CardContent className="p-3 sm:p-4">
                  <div className="diagram-frame">
                    <img
                      src="https://d2xsxph8kpxj0f.cloudfront.net/107050196/atEQdzJHpzRWntNYZpob6k/energie-teilen-grid-flow-diagram-7cH6CiSWqS8KtmD5Zq3tzP.webp"
                      alt="Schematische Darstellung lokaler Energieflüsse im Kontext von Energie Teilen"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 06 — STAKEHOLDER (was 05)
            ================================================================= */}
        <motion.section id="stakeholder" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="06"
              eyebrow="Adressaten"
              title="Relevanz für die Beteiligten, die aus einer Darstellung einen belastbaren Projektstart machen müssen"
              text="Energie Teilen ist für Konstellationen gedacht, in denen mehrere Rollen, Standorte oder organisatorische Ebenen zusammenkommen. Entscheidend ist nicht nur die technische Ausgangslage, sondern die Fähigkeit, daraus eine bezahlte und geordnete Bearbeitung zu machen."
            />

            <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr] xl:items-start">
              <Card className="ledger-panel overflow-hidden border-border/70 bg-card">
                <CardContent className="space-y-4 p-3 sm:p-4">
                  <div className="stakeholder-image-frame">
                    <img
                      src="https://d2xsxph8kpxj0f.cloudfront.net/107050196/atEQdzJHpzRWntNYZpob6k/energie-teilen-community-professional-T6CWZMwwB4P7GG8bYaBgmN.webp"
                      alt="Professionelle Zusammenarbeit im Kontext von Energie Teilen"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-5">
                {stakeholders.map((item, index) => (
                  <Card key={item.title} className="ledger-panel border-border/70 bg-card">
                    <CardContent className="grid gap-4 p-6 sm:grid-cols-[82px_1fr] sm:p-7">
                      <div className="stakeholder-count">0{index + 1}</div>
                      <div className="space-y-2">
                        <h3 className="font-display text-xl font-semibold text-foreground">
                          {item.title}
                        </h3>
                        <p className="text-base leading-7 text-muted-foreground">
                          {item.text}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 07 — MEHRWERT (was 06)
            ================================================================= */}
        <motion.section id="mehrwert" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="07"
              eyebrow="Geschäftsmehrwert"
              title="Warum die Struktur selbst zum kaufbaren Projektwert wird"
              text="In Energieprojekten entsteht Wert nicht nur aus Anlagen und Verträgen, sondern aus Klarheit, Anschlussfähigkeit und operativer Weiterverarbeitung. Energie Teilen macht diese Qualität sichtbar und verbindet sie direkt mit einer bezahlten nächsten Stufe statt mit unstrukturierter Kontaktaufnahme."
            />

            <Card className="ledger-panel overflow-hidden border-border/70 bg-card">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="ledger-table w-full min-w-[720px] border-collapse">
                    <thead>
                      <tr>
                        <th>Dimension</th>
                        <th>Beitrag von Energie Teilen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valueRows.map(([label, text]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td>{text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.section>

        {/* =================================================================
            KAPITEL 08 — PILOTSTART (was 07)
            ================================================================= */}
        <motion.section id="pilot-start" className="section-shell section-shell-contact" {...reveal}>
          <div className="container space-y-10">
            <SectionIntro
              chapter="08"
              eyebrow="Pilotstart"
              title="Wählen Sie die passende Pilotstufe und führen Sie die Konstellation in einen sauberen bezahlten Einstieg"
              text="Die Pilotoberfläche ist bewusst als produktiver Einstieg gebaut. Sie wählen das Paket, prüfen die operative Ausgangslage und starten anschließend einen serverseitig kontrollierten Checkout, der das Projekt in eine geordnete Bearbeitung überführt."
            />

            <div className="grid gap-8">
              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                <div className="space-y-6">
                  <PilotOfferCards
                    selectedOfferCode={selectedOfferCode}
                    onSelectOffer={setSelectedOfferCode}
                    onProceed={handleProceedToForm}
                  />
                </div>

                <Card className="ledger-panel border-border/70 bg-card">
                  <CardContent className="space-y-6 p-6 sm:p-7">
                    <div className="space-y-3">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
                        Ausgewählter Fokus
                      </p>
                      <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
                        {selectedOffer.title}
                      </h3>
                      <p className="text-base leading-8 text-muted-foreground">
                        {selectedOffer.idealFor}
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Nächster Schritt
                      </p>
                      <p className="mt-3 text-sm leading-7 text-foreground/90">
                        Nach dem Checkout wird die Konstellation als bezahlte Pilotanwendung angelegt. Erst danach folgen
                        Intake, Dokumente und die betriebliche Weiterverarbeitung.
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-primary/15 bg-primary/6 p-5">
                      <div className="flex items-start gap-3">
                        <MapPinned className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <p className="text-sm leading-7 text-foreground/90">
                          Für besonders große Portfolios oder institutionelle Sonderfälle bleibt der direkte Kontakt möglich,
                          aber die Standardlinie ist jetzt die bezahlte Pilotaufnahme.
                        </p>
                      </div>
                    </div>

                    <Button asChild size="lg" className="w-full rounded-full">
                      <a href="#pilot-checkout-form">
                        Zu den Projektangaben
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div id="pilot-checkout-form">
                <PilotCheckoutForm selectedOfferCode={selectedOfferCode} />
              </div>
            </div>
          </div>
        </motion.section>
      </main>

      <Footer />
    </div>
  );
}

function RechnerBenefit({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof TrendingUp;
  title: string;
  text: string;
}) {
  return (
    <Card className="ledger-panel border-border/70 bg-card">
      <CardContent className="space-y-3 p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h3>
        <p className="text-sm leading-7 text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
