import { useState } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { AllocationPanel } from "@/components/AllocationPanel";
import { MethodNote, NumberField, ToolInputGrid } from "@/components/ToolInputs";
import { DEFAULTS } from "@/lib/mieterstrom";
import type { MieterstromInputs } from "../../../../shared/schema";

/**
 * /aufteilungsschluessel
 *
 * The allocation-key comparison on its own route.
 *
 * The choice of key is worth a measurable amount of money per year, and until
 * now the only way to see that was to scroll past the whole economic model.
 */
export default function AllocationTool() {
  const [units, setUnits] = useState(DEFAULTS.anzahlWohneinheiten);
  const [kwp, setKwp] = useState(DEFAULTS.kwp);
  const [preis, setPreis] = useState(DEFAULTS.strompreisMieterCtPerKwh);

  const inputs: MieterstromInputs = {
    ...DEFAULTS,
    anzahlWohneinheiten: units,
    kwp,
    strompreisMieterCtPerKwh: preis,
  };

  return (
    <ToolPageLayout
      path="/aufteilungsschluessel"
      kicker="Kostenloses Werkzeug"
      heading="Welcher Aufteilungsschlüssel lässt am meisten Strom im Haus?"
      lede="Der Schlüssel wird in jeder Viertelstunde angewendet. Er entscheidet, wie viel der Erzeugung bei den Teilnehmern bleibt statt eingespeist zu werden — und das ist ein Betrag, kein Detail. Drei Schlüssel, dieselben Daten, der Unterschied gerechnet."
      aside={
        <div className="space-y-6">
          <MethodNote title="Die drei Schlüssel">
            <p>
              <strong className="text-foreground">Statisch</strong> — feste Anteile. Einfach zu
              vereinbaren, lässt aber Energie ungenutzt, sobald der Anteil eines Teilnehmers dessen
              Bedarf in einer Viertelstunde übersteigt.
            </p>
            <p>
              <strong className="text-foreground">Dynamisch</strong> — verbrauchsanteilig je
              Viertelstunde. Alle Teilnehmer erreichen denselben Deckungsgrad.
            </p>
            <p>
              <strong className="text-foreground">Mit Nachverteilung</strong> — zunächst der feste
              Anteil, anschließend wird der nicht genutzte Rest unter den Teilnehmern mit offenem
              Bedarf weiterverteilt. Höchste Eigennutzung bei erhaltener Anteilslogik.
            </p>
          </MethodNote>
          <MethodNote title="Warum die Energiebilanz exakt aufgeht">
            <p>
              Die Einspeisung wird als Erzeugung minus Zuordnung berechnet, nicht unabhängig
              ermittelt. Damit schließt die Bilanz in jeder Viertelstunde konstruktionsbedingt und
              nicht näherungsweise: kein Teilnehmer erhält mehr, als er verbraucht hat, und keine
              Kilowattstunde wird zweimal zugeordnet. Beides ist über ein volles Jahr an
              Viertelstunden geprüft.
            </p>
          </MethodNote>
        </div>
      }
    >
      <div className="space-y-6">
        <ToolInputGrid>
          <NumberField
            id="al-units"
            label="Teilnehmer"
            value={units}
            min={2}
            max={60}
            unit="WE"
            onChange={setUnits}
          />
          <NumberField
            id="al-kwp"
            label="Anlagengröße"
            value={kwp}
            min={5}
            max={300}
            unit="kWp"
            onChange={setKwp}
          />
          <NumberField
            id="al-preis"
            label="Strompreis Mieter"
            value={preis}
            min={20}
            max={50}
            step={0.5}
            unit="ct/kWh"
            onChange={setPreis}
          />
        </ToolInputGrid>

        <AllocationPanel inputs={inputs} />
      </div>
    </ToolPageLayout>
  );
}
