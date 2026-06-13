import { Link } from "wouter";

/**
 * IMPRESSUM — required by § 5 DDG (formerly § 5 TMG).
 * Replace every [PLACEHOLDER] with your real legal-entity data and have a
 * German lawyer review before launch. Publishing this with real data is a
 * legal prerequisite for taking payments.
 */
export default function Impressum() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 prose prose-neutral">
      <Link href="/" className="text-sm no-underline opacity-70 hover:opacity-100">
        ← Zur Startseite
      </Link>
      <h1>Impressum</h1>

      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        [FIRMENNAME / RECHTSFORM]
        <br />
        [STRASSE UND HAUSNUMMER]
        <br />
        [PLZ] [ORT]
        <br />
        Deutschland
      </p>

      <h2>Vertreten durch</h2>
      <p>[GESCHÄFTSFÜHRER:IN / INHABER:IN]</p>

      <h2>Kontakt</h2>
      <p>
        Telefon: [TELEFONNUMMER]
        <br />
        E-Mail: <a href="mailto:kontakt@energie-teilen.de">kontakt@energie-teilen.de</a>
      </p>

      <h2>Registereintrag</h2>
      <p>
        Eintragung im Handelsregister.
        <br />
        Registergericht: [AMTSGERICHT]
        <br />
        Registernummer: [HRB XXXXXX]
        <br />
        <em>(Bei Einzelunternehmen ohne Registereintrag diesen Abschnitt entfernen.)</em>
      </p>

      <h2>Umsatzsteuer-ID</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG:
        <br />
        [DE XXXXXXXXX]
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        [NAME]
        <br />
        [ANSCHRIFT]
      </p>

      <h2>EU-Streitschlichtung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur
        Online-Streitbeilegung (OS) bereit:{" "}
        <a href="https://ec.europa.eu/consumers/odr/" rel="noopener noreferrer" target="_blank">
          https://ec.europa.eu/consumers/odr/
        </a>
        . Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungs-
        verfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <p className="text-sm opacity-60">
        Hinweis: Diese Seite ist ein Strukturentwurf. Vor Veröffentlichung
        anwaltlich prüfen lassen.
      </p>
    </main>
  );
}
