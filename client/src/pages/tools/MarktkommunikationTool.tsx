import { useState } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { MarktkommunikationPanel } from "@/components/MarktkommunikationPanel";
import { MethodNote, NumberField, ToolInputGrid } from "@/components/ToolInputs";
import { DEFAULTS } from "@/lib/mieterstrom";
import type { MieterstromInputs } from "../../../../shared/schema";

/**
 * /marktkommunikation
 *
 * The metering-message page.
 *
 * This is the strongest technical claim the product makes, and it was buried
 * three quarters of the way down the landing page: the German market settles on
 * a LOCAL quarter-hour grid, two days a year that grid is not 96 intervals
 * long, and an implementation that assumes otherwise files wrong quantities
 * twice a year.
 */
export default function MarktkommunikationTool() {
  const [units, setUnits] = useState(DEFAULTS.anzahlWohneinheiten);
  const [kwp, setKwp] = useState(DEFAULTS.kwp);

  const inputs: MieterstromInputs = { ...DEFAULTS, anzahlWohneinheiten: units, kwp };

  return (
    <ToolPageLayout
      path="/marktkommunikation"
      kicker="Marktkommunikation"
      heading="Zweimal im Jahr hat ein Tag nicht 96 Viertelstunden."
      lede="Am letzten Sonntag im März hat der Tag 92, am letzten Sonntag im Oktober 100. Jede Umsetzung, die 96 fest verdrahtet, verliert im Frühjahr vier Werte und zählt im Herbst vier doppelt — und der Fehler landet in einer Rechnung. Hier ist das Raster, und hier ist die Nachricht."
      aside={
        <div className="space-y-6">
          <MethodNote title="Warum die Jahressumme nichts beweist">
            <p>
              Ein volles Jahr ergibt weiterhin 35 040 Viertelstunden, weil sich die beiden
              Umstellungen gegenseitig aufheben. Genau das ist die Falle: die Jahreszahl sieht
              richtig aus, während zwei einzelne Tage falsch sind. Eine Prüfung auf Jahresebene
              zeigt den Fehler nicht.
            </p>
          </MethodNote>
          <MethodNote title="Geprüft und nicht geprüft">
            <p>
              <strong className="text-foreground">Geprüft ist die Syntax.</strong> Freigabezeichen,
              Segmentzählung in UNT und Kontrollreferenz in UNZ werden aus dem Inhalt berechnet und
              anschließend aus der erzeugten Nachricht heraus nachgeprüft — nicht aus dem Code
              angenommen. Der OBIS-Code enthält den Komponententrenner und wird maskiert; ohne diese
              Maskierung zerfällt das Element und die Nachricht meldet eine andere Messgröße als
              gemeint.
            </p>
            <p>
              <strong className="text-foreground">Nicht geprüft ist die Profilfassung.</strong>{" "}
              Segmentverwendung, Qualifier und Verzeichnisstand sind nicht gegen die aktuelle
              Formatbeschreibung des BDEW abgeglichen. Bis dahin ist die erzeugte Nachricht für
              Test- und Abstimmungszwecke bestimmt, und sie sagt das selbst.
            </p>
          </MethodNote>
        </div>
      }
    >
      <div className="space-y-6">
        <ToolInputGrid>
          <NumberField
            id="mako-units"
            label="Teilnehmer"
            value={units}
            min={2}
            max={60}
            unit="WE"
            onChange={setUnits}
          />
          <NumberField
            id="mako-kwp"
            label="Anlagengröße"
            value={kwp}
            min={5}
            max={300}
            unit="kWp"
            onChange={setKwp}
          />
        </ToolInputGrid>

        <MarktkommunikationPanel inputs={inputs} />
      </div>
    </ToolPageLayout>
  );
}
