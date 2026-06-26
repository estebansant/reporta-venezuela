import type { Metadata } from "next";
import { ArrowUpRight, HandHelping, ShieldCheck } from "lucide-react";

const collectionCenters = {
  name: "Centros de Ayuda Venezuela",
  url: "https://centrosayudavenezuela.org/",
  displayUrl: "centrosayudavenezuela.org",
  description:
    "Consulta el directorio disponible para ubicar centros de acopio y puntos de ayuda activos.",
  action: "Ir al directorio de centros de acopio",
} as const;

export const metadata: Metadata = {
  title: "Centros de acopio",
  description:
    "Enlace al directorio externo de centros de acopio y puntos de ayuda para la emergencia en Venezuela.",
  alternates: {
    canonical: "/centros-de-acopio",
  },
};

export default function CollectionCentersPage() {
  return (
    <main className="resource-page collection-centers-page">
      <section className="resource-hero">
        <div className="resource-hero-copy">
          <p className="eyebrow eyebrow-light">Recursos para ayuda humanitaria</p>
          <h1>Centros de acopio</h1>
          <p>
            Revisa el directorio externo para encontrar puntos de recolección y
            ayuda. Antes de movilizar donaciones, confirma horarios, ubicación y
            los insumos que están recibiendo.
          </p>
        </div>
        <HandHelping aria-hidden="true" />
      </section>

      <section className="missing-resources" aria-labelledby="collection-centers-title">
        <header className="resource-intro">
          <div>
            <p className="eyebrow">Directorio externo</p>
            <h2 id="collection-centers-title">
              Un canal para ubicar centros de acopio
            </h2>
          </div>
          <p>
            Este enlace abre un sitio independiente. Verifica la información
            antes de compartirla o trasladarte al lugar.
          </p>
        </header>

        <div className="missing-resource-list">
          <a
            className="missing-resource"
            href={collectionCenters.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="resource-number">01</span>
            <div>
              <p>{collectionCenters.displayUrl}</p>
              <h2>{collectionCenters.name}</h2>
              <span>{collectionCenters.description}</span>
            </div>
            <strong>
              {collectionCenters.action}
              <ArrowUpRight aria-hidden="true" />
            </strong>
          </a>
        </div>
      </section>

      <aside className="privacy-notice">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Verifica antes de donar o difundir</strong>
          <p>
            Confirma que el centro sigue activo y revisa la lista de insumos
            solicitados para evitar traslados o publicaciones desactualizadas.
          </p>
        </div>
      </aside>
    </main>
  );
}
