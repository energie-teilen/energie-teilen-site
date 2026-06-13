import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { MieterstromInputs } from "../../../shared/schema";
import type { MieterstromResult } from "./mieterstrom";
import { interpret } from "./interpret";

export type ScenarioBundle = {
  konservativ: MieterstromResult; realistisch: MieterstromResult; optimistisch: MieterstromResult;
};

const BRAND = { green: "#1d493a", greenDk: "#143528", gold: "#c79236", brown: "#94735b", ink: "#1a1a1a", muted: "#6b6b6b", line: "#e2e2dc", panel: "#fafaf7" };
// ── Edit contact + links in ONE place ──
const CONTACT = {
  company: "Energie Teilen",
  tagline: "Bezahlte Pilotaufnahme für lokale Energieprojekte",
  email: "vincenzo.grimaldi.engineering@gmail.com",
  web: "energie-teilen-site.vercel.app",
  webUrl: "https://energie-teilen-site.vercel.app/",
  rechnerUrl: "https://energie-teilen-site.vercel.app/#rechner",
  pilotUrl: "https://energie-teilen-site.vercel.app/#pilot-start",
  ort: "Frankfurt · Deutschland",
};

const eur = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
const num = (n: number, d = 1) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const irr = (p: number | null) => (p === null ? "n/a" : `${num(p, 1)} %`);
const amort = (j: number | null) => (j === null ? "> Laufzeit" : `${num(j, 1)} J.`);

function chrome(doc: jsPDF, pageW: number, pageH: number, margin: number, pageNo: number, pageCount: number) {
  doc.setFillColor(BRAND.green).rect(0, 0, pageW, 78, "F");
  doc.setFillColor(BRAND.gold).rect(0, 78, pageW, 3, "F");
  doc.setTextColor("#ffffff").setFont("helvetica", "bold").setFontSize(15).text(CONTACT.company, margin, 34);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#cfe0d8").text("Wirtschaftlichkeitsbericht Mieterstrom", margin, 52);
  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  doc.setFontSize(8).setTextColor("#a9c4ba");
  doc.text(today, pageW - margin, 34, { align: "right" });
  doc.text("Indikative Berechnung", pageW - margin, 48, { align: "right" });
  const fy = pageH - 40;
  doc.setDrawColor(BRAND.line).setLineWidth(0.5).line(margin, fy, pageW - margin, fy);
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(BRAND.green).text(CONTACT.company, margin, fy + 14);
  doc.setFont("helvetica", "normal").setFontSize(8);
  // clickable email + web
  doc.setTextColor(BRAND.muted).textWithLink(CONTACT.email, margin, fy + 26, { url: `mailto:${CONTACT.email}` });
  const exW = doc.getTextWidth(CONTACT.email);
  doc.text("   ·   ", margin + exW, fy + 26);
  const sepW = doc.getTextWidth("   ·   ");
  doc.setTextColor(BRAND.green).textWithLink(CONTACT.web, margin + exW + sepW, fy + 26, { url: CONTACT.webUrl });
  const wbW = doc.getTextWidth(CONTACT.web);
  doc.setTextColor(BRAND.muted).text(`   ·   ${CONTACT.ort}`, margin + exW + sepW + wbW, fy + 26);
  doc.text(`Seite ${pageNo}/${pageCount}`, pageW - margin, fy + 14, { align: "right" });
  doc.setFontSize(7).setTextColor("#a8a8a0");
  doc.text(CONTACT.tagline, pageW - margin, fy + 26, { align: "right" });
}

function drawChart(doc: jsPDF, s: ScenarioBundle, x: number, y: number, w: number, h: number) {
  const series = [
    { label: "Konservativ", color: BRAND.brown, data: s.konservativ.jahre },
    { label: "Realistisch", color: BRAND.green, data: s.realistisch.jahre },
    { label: "Optimistisch", color: BRAND.gold, data: s.optimistisch.jahre },
  ];
  const N = Math.max(...series.map((q) => q.data.length));
  const vals = series.flatMap((q) => q.data.map((d) => d.kumulierterCashflowEur)).concat([0]);
  const minV = Math.min(...vals), maxV = Math.max(...vals), span = maxV - minV || 1;
  const xAt = (i: number) => x + (i / (N - 1)) * w;
  const yAt = (v: number) => y + h - ((v - minV) / span) * h;
  doc.setFillColor(BRAND.panel).rect(x, y, w, h, "F");
  doc.setDrawColor(BRAND.line).setLineWidth(0.5).rect(x, y, w, h);
  doc.setFontSize(7).setTextColor(BRAND.muted);
  for (let t = 0; t <= 4; t++) {
    const v = minV + (span * t) / 4, gy = yAt(v);
    doc.setDrawColor("#ecece6").setLineWidth(0.4).line(x, gy, x + w, gy);
    doc.text(eur(v), x - 4, gy + 2, { align: "right" });
  }
  for (let yr = 0; yr < N; yr += 5) {
    const gx = xAt(yr);
    doc.setDrawColor("#ecece6").setLineWidth(0.4).line(gx, y, gx, y + h);
    doc.text(`${yr + 1}`, gx, y + h + 10, { align: "center" });
  }
  doc.text(`${N}`, xAt(N - 1), y + h + 10, { align: "center" });
  if (minV < 0 && maxV > 0) { doc.setDrawColor("#b9b9af").setLineWidth(0.8).line(x, yAt(0), x + w, yAt(0)); }
  series.forEach((q) => {
    doc.setDrawColor(q.color).setLineWidth(1.6);
    for (let i = 1; i < q.data.length; i++)
      doc.line(xAt(i - 1), yAt(q.data[i - 1].kumulierterCashflowEur), xAt(i), yAt(q.data[i].kumulierterCashflowEur));
    const last = q.data[q.data.length - 1];
    doc.setFillColor(q.color).circle(xAt(q.data.length - 1), yAt(last.kumulierterCashflowEur), 2, "F");
  });
  doc.setFontSize(7).setTextColor(BRAND.muted).text("Jahr", x + w / 2, y + h + 22, { align: "center" });
  let lx = x + 8; const ly = y + 12;
  series.forEach((q) => {
    doc.setFillColor(q.color).rect(lx, ly - 6, 8, 8, "F");
    doc.setTextColor(BRAND.ink).setFontSize(8).text(q.label, lx + 11, ly);
    lx += 11 + doc.getTextWidth(q.label) + 14;
  });
}

export function buildReportDoc(inputs: MieterstromInputs, scenarios: ScenarioBundle): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight(), margin = 48;
  let y = 104;

  // ── Einordnung Ihres Ergebnisses (executive summary, plain German) ──
  const ip = interpret(inputs, scenarios.realistisch);
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(BRAND.ink).text("Einordnung Ihres Ergebnisses", margin, y); y += 10;
  const boxW = pageW - margin * 2;
  const summary = [
    { label: "Bewertung", text: ip.verdict },
    { label: "Break-Even", text: ip.breakEven },
    { label: "Benchmark", text: ip.benchmark },
  ];
  doc.setFontSize(9);
  let innerH = 0;
  const wrapped = summary.map((l) => {
    const w = doc.splitTextToSize(l.text, boxW - 90) as string[];
    innerH += w.length * 12 + 6;
    return { label: l.label, w };
  });
  const boxH = innerH + 14;
  doc.setFillColor("#f4f7f5").setDrawColor(BRAND.line).setLineWidth(0.6).roundedRect(margin, y, boxW, boxH, 6, 6, "FD");
  let ty = y + 16;
  wrapped.forEach(({ label, w }) => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(BRAND.green).text(label.toUpperCase(), margin + 12, ty);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(BRAND.ink);
    w.forEach((ln, i) => doc.text(ln, margin + 90, ty + i * 12));
    ty += w.length * 12 + 6;
  });
  y += boxH + 22;
  doc.setTextColor(BRAND.ink).setFont("helvetica", "bold").setFontSize(13).text("Konstellation in Zahlen", margin, y); y += 6;
  autoTable(doc, { startY: y, margin: { left: margin, right: margin }, theme: "plain",
    styles: { fontSize: 9, cellPadding: 3.5, textColor: BRAND.ink },
    columnStyles: { 0: { textColor: BRAND.muted }, 2: { textColor: BRAND.muted } },
    body: [
      ["Anlagengröße", `${num(inputs.kwp, 0)} kWp`, "Wohneinheiten", `${inputs.anzahlWohneinheiten}`],
      ["Eigenverbrauchsquote", `${num(inputs.eigenverbrauchsquote * 100, 0)} %`, "Strompreis Mieter", `${num(inputs.strompreisMieterCtPerKwh, 1)} ct/kWh`],
      ["Mieterstromzuschlag", `${num(inputs.mieterstromZuschlagCtPerKwh, 2)} ct/kWh`, "Einspeisevergütung", `${num(inputs.einspeiseverguetungCtPerKwh, 2)} ct/kWh`],
      ["Investition", `${num(inputs.investitionEurPerKwp, 0)} €/kWp`, "Diskontierungssatz", `${num(inputs.diskontierungssatz * 100, 1)} %`],
    ] });
  // @ts-expect-error autotable augments doc at runtime
  y = doc.lastAutoTable.finalY + 22;
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(BRAND.ink).text("Drei Szenarien über 20 Jahre", margin, y); y += 6;
  const c = (z: MieterstromResult, i: number) => [eur(z.kpis.npvEur), amort(z.kpis.amortisationsdauerJahre), irr(z.kpis.irrPct), eur(z.kpis.investitionEur), eur(z.kpis.erlosKumEur), `${num(z.kpis.co2EinsparungT, 1)} t`][i];
  const { konservativ: k, realistisch: r, optimistisch: o } = scenarios;
  autoTable(doc, { startY: y, margin: { left: margin, right: margin },
    head: [["Kennzahl", "Konservativ", "Realistisch", "Optimistisch"]],
    body: [["NPV (20 J.)", c(k,0), c(r,0), c(o,0)], ["Amortisation", c(k,1), c(r,1), c(o,1)], ["IRR", c(k,2), c(r,2), c(o,2)], ["Investition", c(k,3), c(r,3), c(o,3)], ["Kum. Erlös (20 J.)", c(k,4), c(r,4), c(o,4)], ["CO₂-Einsparung", c(k,5), c(r,5), c(o,5)]],
    styles: { fontSize: 9.5, cellPadding: 6 },
    headStyles: { fillColor: BRAND.green, textColor: "#ffffff", fontStyle: "bold" },
    columnStyles: { 0: { textColor: BRAND.muted, fontStyle: "bold" }, 3: { fillColor: "#f4f7f5", fontStyle: "bold", textColor: BRAND.greenDk } },
    alternateRowStyles: { fillColor: BRAND.panel } });
  // @ts-expect-error see above
  y = doc.lastAutoTable.finalY + 26;
  const chartH = 168;
  if (y + chartH + 60 > pageH - 60) { doc.addPage(); y = 104; }
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(BRAND.ink).text("Kumulierter Cashflow über die Laufzeit", margin, y); y += 12;
  drawChart(doc, scenarios, margin + 40, y, pageW - margin * 2 - 40, chartH); y += chartH + 40;

  // ── Closing CTA: connects the report to the paid pilot ──
  if (y + 96 > pageH - 60) { doc.addPage(); y = 104; }
  doc.setFillColor(BRAND.green).roundedRect(margin, y, pageW - margin * 2, 76, 8, 8, "F");
  doc.setTextColor("#ffffff").setFont("helvetica", "bold").setFontSize(12);
  doc.text("Nächster Schritt: bezahlte Pilotaufnahme", margin + 16, y + 26);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#cfe0d8");
  doc.text("Überführen Sie diese Konstellation ohne Bruch in eine strukturierte, serverseitig geführte Pilotbearbeitung.", margin + 16, y + 44);
  doc.setFillColor(BRAND.gold).roundedRect(margin + 16, y + 52, 130, 16, 4, 4, "F");
  doc.setTextColor(BRAND.greenDk).setFont("helvetica", "bold").setFontSize(8.5);
  doc.textWithLink("Pilot starten  >", margin + 26, y + 63, { url: CONTACT.pilotUrl });
  doc.setFillColor("#ffffff").roundedRect(margin + 156, y + 52, 150, 16, 4, 4, "F");
  doc.setTextColor(BRAND.green);
  doc.textWithLink("Rechner erneut oeffnen  >", margin + 166, y + 63, { url: CONTACT.rechnerUrl });
  y += 76 + 24;

  if (y + 96 > pageH - 60) { doc.addPage(); y = 104; }
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(BRAND.ink).text("Annahmen & Hinweise", margin, y); y += 15;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(BRAND.muted);
  ["Berechnung umfasst Mieterstromzuschlag, Eigenverbrauch, Einspeisung, jährliche Degradation und Diskontierung",
   "über die Laufzeit. Standardannahmen für die DACH-Region; sämtliche Eingaben sind vom Nutzer zu prüfen.",
   "Die gesetzliche Einordnung (§ EnWG) ist projektspezifisch und fachlich zu verifizieren.", "",
   "Indikative Wirtschaftlichkeitsrechnung — keine Anlage-, Steuer- oder Rechtsberatung. Ergebnisse hängen von den",
   "eingegebenen Annahmen ab und ersetzen keine projektspezifische Prüfung durch Fachberater."].forEach((l) => { doc.text(l, margin, y); y += 12.5; });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); chrome(doc, pageW, pageH, margin, p, pages); }
  return doc;
}

export function downloadReportPdf(inputs: MieterstromInputs, scenarios: ScenarioBundle, filename = "energie-teilen-wirtschaftlichkeitsbericht.pdf"): void {
  buildReportDoc(inputs, scenarios).save(filename);
}
