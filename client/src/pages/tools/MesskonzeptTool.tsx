import { useState } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { MesskonzeptPanel, type MesskonzeptAnswers } from "@/components/MesskonzeptPanel";
import { MethodNote, NumberField, SelectField, ToolInputGrid } from "@/components/ToolInputs";
import { DEFAULTS } from "@/lib/mieterstrom";
import type { QualificationFacts } from "../../../../shared/eligibility";
import type { MieterstromInputs } from "../../../../shared/schema";

/**
 * /messkonzept
 *
 * The metering-concept generator on its own route.
 *
 * It answers a question people actually type — which metering concept a given
 * constellation needs and how many meters that is — and it was previously only
 * reachable by scrolling most of the way down the landing page.
 */
export default function MesskonzeptTool() {
  const [units, setUnits] = useState(DEFAULTS.anzahlWohneinheiten);
  const [kwp, setKwp] = useState(DEFAULTS.kwp);
  const [facts, setFacts] = useState<QualificationFacts>({});
  const [answers, setAnswers] = useState<MesskonzeptAnswers>({});

  const inputs: MieterstromInputs = { ...DEFAULTS, anzahlWohneinheiten: units, kwp };

  return (
    <ToolPageLayout
      path="/messkonzept"
      kicker="Kostenloses Werkzeug"
      heading="Welches Messkonzept braucht Ihr Projekt?"
      lede="Die Wirtschaftlichkeit entscheidet, ob sich ein Vorhaben lohnt. Das Messkonzept entscheidet, ob es gebaut werden kann. Geben Sie die Konstellation an und Sie erhalten Variante, Zählerinventar, Marktrollen und den kritischen Pfad bis zur Inbetriebnahme."
      aside={
        <div className="space-y-6">
          <MethodNote title="Wie das abgeleitet wird">
            <p>
              Ausschlaggebend ist die Netzanschlusssituation. Liegen alle Einheiten hinter einem
              Hausanschluss, kommt eine Summenzählung in Betracht; hat jede Einheit einen eigenen
              Anschluss, entfällt sie; liegen die Beteiligten an verschiedenen Netzanschlusspunkten,
              erfolgt die Zuordnung rechnerisch aus viertelstündlichen Messwerten.
            </p>
            <p>
              Ohne diese Angabe wird nichts geraten. Das Ergebnis lautet dann „nicht bestimmbar“ und
              nennt die Klärung als einzige Aufgabe — ein plausibles, aber falsches Schema wäre
              teurer als gar keines.
            </p>
          </MethodNote>
          <MethodNote title="Was dieses Werkzeug nicht leistet">
            <p>
              Es erstellt einen Vorschlag für die technische Ausgestaltung. Das Messkonzept ist mit
              dem zuständigen Netzbetreiber und Messstellenbetreiber abzustimmen; deren Freigabe ist
              maßgeblich. Eine Aussage über die rechtliche Zulässigkeit einer Konstellation ist damit
              nicht verbunden.
            </p>
          </MethodNote>
        </div>
      }
    >
      <div className="space-y-6">
        <ToolInputGrid>
          <NumberField
            id="mk-units"
            label="Einheiten"
            value={units}
            min={2}
            max={200}
            unit="WE"
            onChange={setUnits}
          />
          <NumberField
            id="mk-kwp"
            label="Anlagengröße"
            value={kwp}
            min={5}
            max={300}
            unit="kWp"
            onChange={setKwp}
          />
          <SelectField
            id="mk-owner"
            label="Eigentümerkonstellation"
            value={facts.ownerConstellation}
            options={[
              { value: "single_owner", label: "Ein Eigentümer" },
              { value: "weg", label: "Eigentümergemeinschaft (WEG)" },
              { value: "multiple_owners", label: "Mehrere Eigentümer" },
            ]}
            onChange={(v) => setFacts({ ...facts, ownerConstellation: v })}
          />
          <SelectField
            id="mk-scope"
            label="Räumlicher Zuschnitt"
            value={facts.buildingScope}
            options={[
              { value: "single_building", label: "Ein Gebäude" },
              { value: "multiple_buildings_same_site", label: "Mehrere Gebäude, ein Grundstück" },
              { value: "across_grid", label: "Über mehrere Standorte" },
            ]}
            onChange={(v) => setFacts({ ...facts, buildingScope: v })}
          />
        </ToolInputGrid>

        <MesskonzeptPanel
          inputs={inputs}
          facts={facts}
          answers={answers}
          onAnswersChange={setAnswers}
        />
      </div>
    </ToolPageLayout>
  );
}
