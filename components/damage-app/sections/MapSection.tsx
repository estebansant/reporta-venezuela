import { DamageMapClient } from "@/components/damage-app/map/DamageMapClient";
import { ReportDialog } from "@/components/damage-app/reports/ReportDialog";
import type { ReportCreatedHandler } from "@/components/damage-app/types";
import type { PublicReport } from "@/lib/report-schema";

export function MapSection({
  reports,
  loading,
  affectedStates,
  onBoundsChange,
  onCreated,
}: {
  reports: PublicReport[];
  loading: boolean;
  affectedStates: number;
  onBoundsChange: (bounds: string) => void;
  onCreated: ReportCreatedHandler;
}) {
  return (
    <section className="map-layout" id="mapa">
      <div className="map-shell">
        <DamageMapClient reports={reports} onBoundsChange={onBoundsChange} />
        {!loading && !reports.length ? (
          <div className="map-empty">
            <strong>Aún no hay reportes en esta zona</strong>
            <span>
              Registra un daño o mueve el mapa para consultar otra región.
            </span>
          </div>
        ) : null}
        <div className="map-report">
          <ReportDialog compact onCreated={onCreated} />
        </div>
      </div>
      <aside className="response-panel">
        <section className="response-summary" aria-labelledby="response-title">
          <p className="eyebrow">Red de información ciudadana</p>
          <h2 id="response-title">Un reporte puede orientar la ayuda</h2>
          <p>
            Esta plataforma reúne incidentes en un solo lugar para identificar
            personas que necesitan rescate, ubicar zonas prioritarias y
            documentar los daños causados por el sismo.
          </p>
          <div className="stats-grid">
            <div>
              <strong>{reports.length}</strong>
              <span>reportes visibles</span>
            </div>
            <div>
              <strong>{affectedStates || "—"}</strong>
              <span>estados afectados</span>
            </div>
            <div>
              <strong>7.1</strong>
              <span>magnitud Mw · 24 jun</span>
            </div>
          </div>
        </section>

        <section className="report-guide" aria-labelledby="report-guide-title">
          <div className="aside-heading">
            <div>
              <p className="eyebrow">Cómo colaborar</p>
              <h3 id="report-guide-title">Crea un reporte claro y verificable</h3>
            </div>
            <span className="guide-time">2–4 min</span>
          </div>
          <ol className="report-steps">
            <li>
              <span>1</span>
              <p>
                <strong>Ubica el incidente.</strong> Indica estado, ciudad,
                dirección y una referencia que permita llegar al lugar.
              </p>
            </li>
            <li>
              <span>2</span>
              <p>
                <strong>Describe lo que ves.</strong> Señala el tipo de daño y
                marca si hay personas atrapadas o en peligro inmediato.
              </p>
            </li>
            <li>
              <span>3</span>
              <p>
                <strong>Aporta evidencia segura.</strong> Adjunta fotos
                recientes y un contacto, sin exponerte ni entrar a estructuras
                inestables.
              </p>
            </li>
          </ol>
          <p className="report-note">
            No dupliques reportes. Si el lugar ya aparece, consulta su ficha
            antes de registrar uno nuevo.
          </p>
        </section>

        <section className="emergency-list">
          <div className="emergency-copy">
            <p className="eyebrow">Peligro inmediato</p>
            <p>
              Un reporte ayuda a coordinar información, pero no reemplaza una
              llamada a los servicios de emergencia.
            </p>
          </div>
          <div className="emergency-phones">
            <a href="tel:08007248451">
              <span>Protección Civil</span>
              <strong>0800-7248451</strong>
            </a>
            <a href="tel:171">
              <span>Bomberos</span>
              <strong>171</strong>
            </a>
          </div>
        </section>
      </aside>
    </section>
  );
}
