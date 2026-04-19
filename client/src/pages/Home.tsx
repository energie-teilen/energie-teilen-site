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
import Header from "@/components/Header";
import Footer from "@/components/Footer";

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
  ["Portfolio-Relevanz", "Einzelstandorte und Quartiere lassen sich in konsistente Bewertungs- und Steuerungslogiken einordnen."],
];

const flowSteps = [
  {
    number: "01",
    title: "Erzeugung erfassen",
    text: "Lokale Energiequellen eines Standorts oder Quartiers werden in eine klar definierte Struktur aufgenommen.",
  },
  {
    number: "02",
    title: "Verbrauch zuordnen",
    text: "Verbrauchsgruppen, Nutzungseinheiten und betriebliche Kontexte werden in ein belastbares Bild überführt.",
  },
  {
    number: "03",
    title: "Verteilung strukturieren",
    text: "Die operative Beziehung zwischen Erzeugung, Nutzung und standortbezogener Verteilung wird nachvollziehbar dargestellt.",
  },
  {
    number: "04",
    title: "Auswertung bereitstellen",
    text: "Ergebnisbilder, Kennzahlen und Kommunikationsgrundlagen werden für Projekte und Beteiligte aufbereitet.",
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
                    Energie Civic Ledger
                  </Badge>
                  <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
                    <div className="chapter-pill">Kapitel 01</div>
                    <div className="space-y-5">
                      <h1 className="font-display max-w-4xl text-4xl leading-[0.96] font-semibold tracking-[-0.05em] text-foreground sm:text-5xl lg:text-[4.5rem]">
                        Energie Teilen ordnet lokale Energieprojekte in eine belastbare geschäftliche Struktur.
                      </h1>
                      <p className="max-w-2xl font-body text-lg leading-8 text-muted-foreground sm:text-xl">
                        Die Website beschreibt, was Energie Teilen für Eigentümer, Quartiere, Projektträger und kommunale Akteure leistet: eine professionelle Struktur für lokale Erzeugung, Nutzung, Verteilung und operative Lesbarkeit.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Positionierung</span>
                        <ShieldCheck className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Professionelle Energieplattform für strukturierte Projektkonstellationen
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Schwerpunkt</span>
                        <Leaf className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Lokale Erzeugung, Verbrauch, Verteilung und betriebliche Einordnung
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="ledger-panel border-border/70 bg-card/85 shadow-[0_16px_60px_rgba(18,32,27,0.10)] backdrop-blur-sm sm:col-span-2 xl:col-span-1">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Zielgruppe</span>
                        <Landmark className="h-4 w-4 text-primary" />
                      </div>
                      <p className="font-display text-xl leading-snug font-semibold text-foreground">
                        Immobilien, Quartiere, kommunale Kontexte und Infrastrukturpartner
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="rounded-full bg-primary px-6 text-primary-foreground shadow-[0_12px_30px_rgba(29,73,58,0.24)] hover:bg-primary/92">
                    <a href="#kontakt">
                      Gespräch anfragen
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
                    Energie Teilen präsentiert sich als belastbare Struktur für lokale Energiekonstellationen im deutschen Markt.
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
              title="Was Energie Teilen macht"
              text="Energie Teilen beschreibt und strukturiert lokale Energieprojekte so, dass geschäftliche, technische und standortbezogene Zusammenhänge in einer professionellen Form sichtbar werden. Im Mittelpunkt stehen belastbare Projektbilder für Immobilien, Areale, Quartiere und partnerbasierte Konstellationen."
            />

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="ledger-panel overflow-hidden border-border/70 bg-card">
                <CardContent className="grid gap-8 p-8 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
                  <div className="space-y-5">
                    <p className="section-kicker">Mandat</p>
                    <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
                      Eine klare operative Sprache für lokale Energiebeziehungen.
                    </h3>
                    <p className="text-base leading-8 text-muted-foreground">
                      Die Leistung von Energie Teilen besteht darin, Energiebeziehungen in Gebäuden und Quartieren in einer Weise zu ordnen, die für Eigentümer, Projektpartner und institutionelle Gesprächskontexte geschäftlich lesbar wird. Statt diffuser Komplexität entsteht ein strukturierter Rahmen mit klaren Einheiten, Rollen und Bezugspunkten.
                    </p>
                  </div>
                  <div className="editorial-aside">
                    <div>
                      <span className="aside-label">Fokus</span>
                      <p>Gebäude, Portfolios, Areale und Quartiere mit lokaler Erzeugung und standortbezogenen Verbrauchsbeziehungen.</p>
                    </div>
                    <div>
                      <span className="aside-label">Darstellung</span>
                      <p>Professionell, präzise und anschlussfähig für Eigentümer, Betreiber, Gemeinden und Infrastrukturpartner.</p>
                    </div>
                    <div>
                      <span className="aside-label">Kommunikation</span>
                      <p>Konzentriert auf das, was Energie Teilen leistet, ohne geschützte operative Detailtiefe offenzulegen.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="ledger-panel border-border/70 bg-[linear-gradient(180deg,rgba(245,241,233,0.92),rgba(231,226,216,0.82))]">
                <CardContent className="space-y-5 p-8 lg:p-10">
                  <p className="section-kicker">Einordnung</p>
                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-3 rounded-full border border-primary/15 bg-white/80 px-4 py-2 text-sm text-foreground">
                      <BatteryCharging className="h-4 w-4 text-primary" />
                      Lokale Energiepotenziale in strukturierter Form
                    </div>
                    <div className="inline-flex items-center gap-3 rounded-full border border-primary/15 bg-white/80 px-4 py-2 text-sm text-foreground">
                      <MapPinned className="h-4 w-4 text-primary" />
                      Geeignet für einzelne Objekte und Quartierskontexte
                    </div>
                    <div className="inline-flex items-center gap-3 rounded-full border border-primary/15 bg-white/80 px-4 py-2 text-sm text-foreground">
                      <Factory className="h-4 w-4 text-primary" />
                      Anschlussfähig für operative und institutionelle Gesprächslagen
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </motion.section>

        <motion.section id="leistungen" className="section-shell section-shell-alt" {...reveal}>
          <div className="container space-y-12">
            <SectionIntro
              chapter="03"
              eyebrow="Leistungsbild"
              title="Leistungsbausteine für professionelle Energieprojekte"
              text="Die Leistung wird nicht als generisches Produkt beschrieben, sondern als modulare Struktur für reale Projektkonstellationen. So entsteht ein präzises Bild davon, was Energie Teilen für Marktteilnehmer bereitstellt."
            />

            <div className="grid gap-6 md:grid-cols-2">
              {serviceModules.map(({ icon: Icon, title, text }) => (
                <Card key={title} className="ledger-panel group border-border/70 bg-card transition-transform duration-300 hover:-translate-y-1">
                  <CardContent className="space-y-5 p-7 sm:p-8">
                    <div className="flex items-center justify-between">
                      <div className="icon-disc">
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
              title="Ein verständliches Gesamtbild aus Erzeugung, Nutzung, Verteilung und Auswertung"
              text="Die Darstellung von Energie Teilen folgt einer klaren Leselogik. Aus einzelnen technischen und betrieblichen Bestandteilen wird ein zusammenhängendes Projektbild, das für Entscheidungen, Kommunikation und Einordnung geeignet ist."
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
              title="Relevanz für die Beteiligten, die lokale Energieprojekte tragen"
              text="Energie Teilen ist für Konstellationen gedacht, in denen mehrere Rollen, Standorte oder organisatorische Ebenen zusammenkommen. Entscheidend ist nicht nur die technische Ausgangslage, sondern die professionelle Lesbarkeit für alle Beteiligten."
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
              title="Warum die Struktur selbst zum Projektwert wird"
              text="In Energieprojekten entsteht Wert nicht nur aus Anlagen und Verträgen, sondern auch aus Klarheit. Energie Teilen schafft ein professionelles Bild der Konstellation und verbessert damit die Anschlussfähigkeit eines Projekts an interne, externe und institutionelle Gesprächslagen."
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

        <motion.section id="kontakt" className="section-shell section-shell-contact" {...reveal}>
          <div className="container">
            <Card className="ledger-panel relative overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(29,73,58,0.98),rgba(18,32,27,0.98))] text-primary-foreground shadow-[0_24px_80px_rgba(18,32,27,0.28)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(199,146,54,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_24%)]" />
              <CardContent className="relative grid gap-8 p-8 sm:p-10 lg:grid-cols-[1fr_0.72fr] lg:p-12">
                <div className="space-y-5">
                  <p className="section-kicker text-primary-foreground/70">Kontakt</p>
                  <h2 className="font-display text-3xl leading-tight font-semibold tracking-[-0.04em] text-primary-foreground sm:text-4xl">
                    Professionelle Gespräche zu lokalen Energieprojekten beginnen mit einer klaren Ausgangslage.
                  </h2>
                  <p className="max-w-2xl text-base leading-8 text-primary-foreground/78 sm:text-lg">
                    Wenn Sie ein Gebäude, ein Portfolio, ein Quartier oder eine standortbezogene Konstellation professionell einordnen möchten, kann Energie Teilen als strukturierende Plattform in den Dialog eingebracht werden.
                  </p>
                </div>
                <div className="rounded-[28px] border border-white/12 bg-white/6 p-6 backdrop-blur-sm sm:p-7">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.16em] text-primary-foreground/60">E-Mail</p>
                      <a className="mt-1 block font-display text-xl text-primary-foreground transition-opacity hover:opacity-80" href="mailto:vincenzo.grimaldi.engineering@gmail.com">
                        vincenzo.grimaldi.engineering@gmail.com
                      </a>
                    </div>
                    <div>
                      <p className="text-sm uppercase tracking-[0.16em] text-primary-foreground/60">Standort</p>
                      <p className="mt-1 text-base text-primary-foreground/82">Frankfurt am Main, Deutschland</p>
                    </div>
                    <div>
                      <p className="text-sm uppercase tracking-[0.16em] text-primary-foreground/60">Nächster Schritt</p>
                      <p className="mt-1 text-base leading-7 text-primary-foreground/82">
                        Projektkontext, Standorttyp und Beteiligtenstruktur kurz skizzieren. Daraus lässt sich die passende Gesprächsgrundlage ableiten.
                      </p>
                    </div>
                    <Button asChild size="lg" className="mt-3 w-full rounded-full bg-accent px-6 text-accent-foreground hover:bg-accent/90">
                      <a href="mailto:vincenzo.grimaldi.engineering@gmail.com?subject=Energie%20Teilen%20Anfrage">
                        Kontakt aufnehmen
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.section>
      </main>

      <Footer />
    </div>
  );
}
