import type { Metadata } from "next";
import { ArrowUpRight, Search, ShieldCheck } from "lucide-react";

const services = [
  {
    name: "Desaparecidos Terremoto Venezuela",
    url: "https://desaparecidosterremotovenezuela.com/",
    displayUrl: "desaparecidosterremotovenezuela.com",
    description:
      "Consulta los reportes publicados y registra información sobre una persona cuyo paradero se desconoce.",
    action: "Ir al registro de desaparecidos",
  },
  {
    name: "Venezuela Te Busca",
    url: "https://venezuelatebusca.com/",
    displayUrl: "venezuelatebusca.com",
    description:
      "Publica un reporte o revisa la información disponible para ayudar a localizar y conectar personas.",
    action: "Ir a Venezuela Te Busca",
  },
] as const;

export const metadata: Metadata = {
  title: "Personas desaparecidas",
  description:
    "Enlaces a plataformas para consultar y reportar personas desaparecidas tras el terremoto en Venezuela.",
  alternates: {
    canonical: "/personas-desaparecidas",
  },
};

export default function MissingPeoplePage() {
  return (
    <main className="resource-page missing-people-page">
      <section className="resource-hero">
        <div className="resource-hero-copy">
          <p className="eyebrow eyebrow-light">Recursos de búsqueda y reencuentro</p>
          <h1>Personas desaparecidas</h1>
          <p>
            Consulta o reporta a una persona en las plataformas disponibles. Antes
            de publicar, reúne una foto reciente, nombre completo, último lugar
            conocido y un medio de contacto verificable.
          </p>
        </div>
        <Search aria-hidden="true" />
      </section>

      <section className="missing-resources" aria-labelledby="platforms-title">
        <header className="resource-intro">
          <div>
            <p className="eyebrow">Plataformas externas</p>
            <h2 id="platforms-title">Dos canales para publicar y consultar</h2>
          </div>
          <p>
            Estos enlaces abren sitios independientes. Revisa si la persona ya
            fue reportada antes de crear una publicación duplicada.
          </p>
        </header>

        <div className="missing-resource-list">
          {services.map((service, index) => (
            <a
              className="missing-resource"
              href={service.url}
              key={service.name}
              rel="noreferrer"
              target="_blank"
            >
              <span className="resource-number">0{index + 1}</span>
              <div>
                <p>{service.displayUrl}</p>
                <h2>{service.name}</h2>
                <span>{service.description}</span>
              </div>
              <strong>
                {service.action}
                <ArrowUpRight aria-hidden="true" />
              </strong>
            </a>
          ))}
        </div>
      </section>

      <aside className="privacy-notice">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Protege la información personal</strong>
          <p>
            No publiques documentos de identidad, direcciones privadas ni datos
            sensibles. Usa un teléfono o correo destinado a recibir información.
          </p>
        </div>
      </aside>
    </main>
  );
}
