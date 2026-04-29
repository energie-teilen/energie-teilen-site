import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BatteryCharging,
  Building2,
  ChevronRight,
  Factory,
  Landmark,
  Leaf,
  LineChart,
  MapPinned,
  Network,
  ShieldCheck,
  Users2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { CapacityBanner } from "@/components/pilot/CapacityBanner";
import { PilotCheckoutForm } from "@/components/pilot/PilotCheckoutForm";
import { PilotOfferCards } from "@/components/pilot/PilotOfferCards";
import { getPilotOfferContent, type PilotOfferCode } from "@/lib/pilot-api";

/**
 * Energy Civic Ledger design reminder for this file:
 * Use chapter-based editorial storytelling, asymmetric composition, civic-tech credibility,
 * and German professional business language tailored only to Energie Teilen.
 * If a choice feels generic, decorative, or startup-like, reject it.
 */

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

function SectionIntro({ chapter, eyebrow, title, text }: { chapter: string; eyebrow: string; title: string; text: string }) {
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

export default function Home() {
  const [selectedOfferCode, setSelectedOfferCode] = useState<PilotOfferCode>("et_structuring");
  const selectedOffer = useMemo(() => getPilotOfferContent(selectedOfferCode), [selectedOfferCode]);
  const pilotCapacityRemaining = Number.parseInt(import.meta.env.VITE_PILOT_CAPACITY_REMAINING || "", 10);
  const hasCapacitySignal = Number.isFinite(pilotCapacityRemaining) && pilotCapacityRemaining >= 0;

  function handleProceedToForm() {
    const target = document.getElementById("pilot-checkout-form");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main>
        <section id="top" className="ledger-hero relative overflow-hidden pt-28 sm:pt-32">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(199,146,54,0.09),transparent_28%),radial-gradient(circle_at_right,rgba(29,73,58,0.12),transparent_34%)]" />
          <div className="container relative">
            <div className="grid items-end gap-10 pb-16 lg:grid-cols-[1.04fr_0.96fr] lg:gap-14 lg:pb-24">
              <motion.div className="space-y-8" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75 }}>
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
                  <Button asChild size="lg" className="rounded-full bg-primary px-6 text-primary-foreground shadow-[0_12px_30px_rgba(29,73,58,0.24)] hover:bg-primary/92">
                    <a href="#pilot-start">
                      Pilot starten
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="rounded-full border-border bg-background/70 px-6 text-foreground hover:bg-muted">
                    <a href="#leistungen">Leistungsbild ansehen</a>
                  </Button>
                </div>
              </motion.div>

              <motion.div className="relative lg:pb-6" initial={{ opacity: 0, scale: 0.98, y: 22 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.08 }}>
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
                    Energie Teilen verbindet anspruchsvolle Projektkommunikation mit einer klaren bezahlten Einstiegslinie,
                    damit aus Interesse eine geordnete Pilotbearbeitung wird.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <motion.section id="ueberblick" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="02"
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
                        <h3 className="font-display text-xl font-semibold tracking-[-0.03em] text-foreground">{item.title}</h3>
                        <p className="text-base leading-7 text-muted-foreground">{item.text}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </motion.section>

        <motion.section id="leistungen" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="03"
              eyebrow="Leistungen"
              title="Die Leistung wird so aufbereitet, dass aus Komplexität ein verkäuflicher, bearbeitbarer Projektzugang entsteht"
              text="Die Plattform ist auf Konstellationen ausgelegt, in denen mehrere technische, organisatorische oder betriebliche Ebenen zusammenkommen. Der Wert entsteht aus Struktur, professioneller Lesbarkeit und der Fähigkeit, eine Konstellation in ein belastbares nächstes Arbeitsformat zu überführen."
            />

            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
              {serviceModules.map(({ title, text, icon: Icon }) => (
                <Card key={title} className="ledger-panel group border-border/70 bg-card transition-transform duration-300 hover:-translate-y-1">
                  <CardContent className="space-y-6 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
                      <p className="font-body text-base leading-8 text-muted-foreground">{text}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section id="struktur" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="04"
              eyebrow="Struktur"
              title="Ein verständliches Gesamtbild aus Einordnung, Paketwahl, Checkout und Intake"
              text="Die operative Leselogik endet nicht bei der Beschreibung eines Projekts. Sie setzt sich in der bezahlten Pilotaufnahme fort. Dadurch wird aus einer Marketingoberfläche eine funktionierende geschäftliche Oberfläche mit klaren Übergängen zwischen Interesse, Zahlung und Bearbeitung."
            />

            <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
              <Card className="ledger-panel border-border/70 bg-card">
                <CardContent className="space-y-8 p-8 lg:p-10">
                  {flowSteps.map((step) => (
                    <div key={step.number} className="grid gap-4 border-b border-border/70 pb-6 last:border-none last:pb-0 md:grid-cols-[72px_1fr]">
                      <div className="flow-number">{step.number}</div>
                      <div className="space-y-2">
                        <h3 className="font-display text-xl font-semibold text-foreground">{step.title}</h3>
                        <p className="text-base leading-7 text-muted-foreground">{step.text}</p>
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

        <motion.section id="stakeholder" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="05"
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
                        <h3 className="font-display text-xl font-semibold text-foreground">{item.title}</h3>
                        <p className="text-base leading-7 text-muted-foreground">{item.text}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section id="mehrwert" className="section-shell" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="06"
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

        <motion.section id="pilot-start" className="section-shell section-shell-contact" {...reveal}>
          <div className="container space-y-10">
            <SectionIntro
              chapter="07"
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
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">Ausgewählter Fokus</p>
                      <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
                        {selectedOffer.title}
                      </h3>
                      <p className="text-base leading-8 text-muted-foreground">{selectedOffer.idealFor}</p>
                    </div>

                    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                      <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">Nächster Schritt</p>
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
