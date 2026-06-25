import type { Metadata } from "next";
import {
  ExternalLink,
  Phone,
  ShieldAlert,
} from "lucide-react";

type Center = {
  name: string;
  kind: string;
  address: string;
  source: string;
  phone?: string;
  phoneHref?: string;
};

const directories: { city: string; state: string; centers: Center[] }[] = [
  {
    city: "Caracas",
    state: "Distrito Capital",
    centers: [
      { name: "Protección Civil Distrito Capital", kind: "Protección civil", address: "Cobertura en Caracas", phone: "(0212) 575-1829", phoneHref: "tel:+582125751829", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Distrito Capital", kind: "Protección civil", address: "Cobertura en Caracas", phone: "(0212) 575-3332", phoneHref: "tel:+582125753332", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Distrito Capital", kind: "Protección civil", address: "Cobertura en Caracas", phone: "(0212) 575-1823", phoneHref: "tel:+582125751823", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Distrito Capital", kind: "Protección civil", address: "Cobertura en Caracas", phone: "(0212) 377-4019", phoneHref: "tel:+582123774019", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Bomberos de Caracas — Central", kind: "Bomberos", address: "Central de emergencias de Caracas", phone: "(0212) 545-4545", phoneHref: "tel:+582125454545", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Hospital de Clínicas Caracas", kind: "Clínica privada · emergencia", address: "Av. Alameda, San Bernardino", phone: "(0212) 508-6111", phoneHref: "tel:+582125086111", source: "https://www.openstreetmap.org/way/227368315" },
      { name: "Centro Médico de Caracas", kind: "Clínica privada · emergencia", address: "Av. Los Erasos, San Bernardino", phone: "(0212) 555-9111", phoneHref: "tel:+582125559111", source: "https://www.openstreetmap.org/way/273399815" },
    ],
  },
  {
    city: "La Guaira",
    state: "La Guaira",
    centers: [
      { name: "Hospital José María Vargas — IVSS", kind: "Hospital público · emergencia", address: "Av. Carlos Soublette, Punta de Mulatos", phone: "(0212) 331-6555", phoneHref: "tel:+582123316555", source: "https://www.openstreetmap.org/way/269634199" },
      { name: "Hospital San José", kind: "Hospital · emergencia", address: "Calle Real de Maiquetía, Maiquetía", phone: "(0212) 303-4451", phoneHref: "tel:+582123034451", source: "https://www.openstreetmap.org/way/269631171" },
    ],
  },
  {
    city: "Valencia",
    state: "Carabobo",
    centers: [
      { name: "Protección Civil Carabobo", kind: "Protección civil", address: "Cobertura en el estado Carabobo", phone: "(0241) 859-3969", phoneHref: "tel:+582418593969", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Carabobo", kind: "Protección civil", address: "Cobertura en el estado Carabobo", phone: "(0241) 859-2171", phoneHref: "tel:+582418592171", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Carabobo", kind: "Protección civil", address: "Cobertura en el estado Carabobo", phone: "(0241) 859-3801", phoneHref: "tel:+582418593801", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Protección Civil Valencia", kind: "Protección civil", address: "Cobertura en Valencia", phone: "(0412) 827-4252", phoneHref: "tel:+584128274252", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Bomberos de Valencia", kind: "Bomberos", address: "Cobertura en Valencia", phone: "(0414) 433-3952", phoneHref: "tel:+584144333952", source: "https://www.instagram.com/yanisbert.s/" },
      { name: "Hospital de la Cruz Roja", kind: "Hospital", address: "Av. 104, Camoruco, Prebo", source: "https://www.openstreetmap.org/way/384262194" },
      { name: "Hospital Metropolitano del Norte", kind: "Hospital privado", address: "Av. 181 Valencia, Naguanagua", source: "https://www.openstreetmap.org/way/392110732" },
    ],
  },
  {
    city: "Coro",
    state: "Falcón",
    centers: [
      { name: "Hospital Universitario de Coro", kind: "Hospital público", address: "Av. Ruiz Pineda, Urb. Cruz Verde", source: "https://www.openstreetmap.org/way/815953467" },
      { name: "Hospital Materno Infantil José María Espinoza", kind: "Hospital materno infantil", address: "Av. Los Médanos, Coro", source: "https://www.openstreetmap.org/node/13622866501" },
    ],
  },
  {
    city: "Puerto La Cruz",
    state: "Anzoátegui",
    centers: [
      { name: "Policlínica Puerto La Cruz", kind: "Clínica privada", address: "Av. 5 de Julio, Urb. Los Yaques", source: "https://www.openstreetmap.org/node/9783959772" },
    ],
  },
  {
    city: "Puerto Cabello",
    state: "Carabobo",
    centers: [
      { name: "Hospital Dr. Adolfo Prince Lara", kind: "Hospital público · emergencia", address: "Av. La Paz, Cumboto Norte", source: "https://www.openstreetmap.org/way/156709880" },
      { name: "Hospital Dr. José Francisco Molina Sierra — IVSS", kind: "Hospital público · emergencia", address: "Av. Circunvalación del Mar, San Millán", source: "https://www.openstreetmap.org/node/1694026494" },
    ],
  },
  {
    city: "Barquisimeto",
    state: "Lara",
    centers: [
      { name: "Hospital Central Universitario Antonio María Pineda", kind: "Hospital público · emergencia 24 horas", address: "Carrera 33, Barquisimeto", source: "https://www.openstreetmap.org/way/188952851" },
      { name: "Policlínica de Barquisimeto", kind: "Clínica privada", address: "Av. Madrid, sector este", source: "https://www.openstreetmap.org/way/188952855" },
    ],
  },
  {
    city: "San Felipe",
    state: "Yaracuy",
    centers: [
      { name: "Hospital Dr. Plácido Daniel Rodríguez Rivero — IVSS", kind: "Hospital público · emergencia", address: "Sector La Mosca, San Felipe", source: "https://www.openstreetmap.org/way/103601022" },
    ],
  },
];

const confirmedDirectories = directories
  .map((directory) => ({
    ...directory,
    centers: directory.centers.filter(
      (center) => center.phone && center.phoneHref
    ),
  }))
  .filter((directory) => directory.centers.length > 0);

export const metadata: Metadata = {
  title: "Teléfonos de emergencia en Venezuela",
  description:
    "Directorio de emergencia, hospitales y clínicas en ciudades de Venezuela.",
  alternates: {
    canonical: "/emergencias",
  },
};

function CallLink({
  href,
  children,
  compact = false,
}: {
  href: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <a className={compact ? "emergency-call compact" : "emergency-call"} href={href}>
      <Phone aria-hidden="true" />
      <span>{children}</span>
    </a>
  );
}

export default function EmergenciesPage() {
  return (
    <main className="emergency-page">
      <section className="emergency-hero">
        <div>
          <p className="eyebrow eyebrow-light">Directorio de ayuda inmediata</p>
          <h1>Teléfonos de emergencia</h1>
          <p>
            Si existe peligro inmediato, llama primero al servicio nacional. Luego
            contacta el centro asistencial más cercano para confirmar atención.
          </p>
        </div>
        <ShieldAlert aria-hidden="true" />
      </section>

      <section className="national-emergency" aria-labelledby="national-title">
        <div className="national-emergency-heading">
          <p className="eyebrow">Cobertura nacional</p>
          <h2 id="national-title">Números prioritarios</h2>
          <p>Disponibles para emergencias en todo el país.</p>
        </div>
        <CallLink href="tel:911">
          <strong>911</strong>
          <small>VEN911 · emergencias</small>
        </CallLink>
        <CallLink href="tel:08007248451">
          <strong>0800-7248451</strong>
          <small>Protección Civil</small>
        </CallLink>
      </section>

      <nav className="directory-index" aria-label="Ciudades disponibles">
        {confirmedDirectories.map(({ city }) => (
          <a href={`#${city.toLowerCase().replaceAll(" ", "-")}`} key={city}>
            {city}
          </a>
        ))}
      </nav>

      <section className="city-directory">
        <div className="directory-intro">
          <p className="eyebrow">Servicios locales</p>
          <h2>Directorio por ciudad</h2>
          <p>
            Cada tarjeta reúne hospitales, clínicas y servicios de emergencia de
            una ciudad. Toca un número para llamar.
          </p>
        </div>

        <div className="city-card-grid">
        {confirmedDirectories.map(({ city, state, centers }) => (
          <article className="city-card" id={city.toLowerCase().replaceAll(" ", "-")} key={city}>
            <div className="city-heading">
              <div>
                <p>Servicios locales</p>
                <h3>{city}</h3>
                <span>{state}</span>
              </div>
              <span>{centers.length}</span>
            </div>
            <div className="city-service-list">
              {centers.map((center) => (
                <div className="city-service" key={`${center.name}-${center.phone}`}>
                  <div className="service-copy">
                    <span>{center.kind}</span>
                    <h4>{center.name}</h4>
                    <p>{center.address}</p>
                  </div>
                  <div className="service-phone">
                    <CallLink compact href={center.phoneHref!}>{center.phone}</CallLink>
                  </div>
                  <a className="source-link" href={center.source} target="_blank" rel="noreferrer">
                    Fuente <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </article>
        ))}
        </div>
      </section>

      <aside className="directory-notice">
        <strong>Antes de trasladarte</strong>
        <p>
          Confirma que el centro está operativo. Evita ascensores y no ingreses a
          estructuras visiblemente dañadas.
        </p>
        <span>Directorio revisado el 25 de junio de 2026.</span>
      </aside>
    </main>
  );
}
