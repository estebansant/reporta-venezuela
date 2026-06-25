import { ShieldAlert } from "lucide-react";

import { damageGuideItems } from "@/components/damage-app/constants";
import { ReportDialog } from "@/components/damage-app/reports/ReportDialog";
import type { ReportCreatedHandler } from "@/components/damage-app/types";
import { cn } from "@/lib/utils";

export function DamageGuideSection({
  onCreated,
}: {
  onCreated: ReportCreatedHandler;
}) {
  return (
    <section className="cracks section-pad" id="tipos-danos">
      <div className="cracks-intro">
        <div>
          <p className="eyebrow">Información técnica</p>
          <h2>Reconoce las grietas y actúa a tiempo</h2>
        </div>
        <p>
          Esta guía es orientativa y no sustituye una evaluación profesional.
        </p>
      </div>
      <div className="crack-grid">
        {damageGuideItems.map(({ level, title, crackClass, copy }) => (
          <article key={level}>
            <div
              className={cn("crack-diagram", crackClass)}
              aria-hidden="true"
            >
              <span />
            </div>
            <p className="eyebrow">{level}</p>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <div className="safety-banner">
        <ShieldAlert />
        <div>
          <strong>Tu seguridad es primero</strong>
          <p>No ingreses a estructuras inestables para tomar fotografías.</p>
        </div>
        <ReportDialog compact onCreated={onCreated} />
      </div>
    </section>
  );
}
