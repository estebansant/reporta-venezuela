import type { Metadata } from "next";
import Image from "next/image";
import { ExternalLink, ShieldAlert } from "lucide-react";

const infographics = [
  {
    number: "01",
    src: "/images/infografia-1.webp",
    title: "Infografía 1",
    alt: "Infografía uno sobre identificación de daños en estructuras después de un sismo",
  },
  {
    number: "02",
    src: "/images/infografia-2.webp",
    title: "Infografía 2",
    alt: "Infografía dos con recomendaciones ante daños observados en estructuras",
  },
  {
    number: "03",
    src: "/images/infografia-3.webp",
    title: "Infografía 3",
    alt: "Infografía tres sobre medidas de seguridad frente a daños estructurales",
  },
] as const;

export const metadata: Metadata = {
  title: "Infografías sobre daños estructurales",
  description:
    "Guía visual para reconocer daños en estructuras y saber cómo actuar después de un sismo.",
  alternates: {
    canonical: "/infografias",
  },
};

export default function InfographicsPage() {
  return (
    <main className="resource-page infographics-page">
      <section className="resource-hero infographics-hero">
        <div className="resource-hero-copy">
          <p className="eyebrow eyebrow-light">Guía visual de seguridad</p>
          <h1>Qué hacer ante daños en estructuras</h1>
          <p>
            Revisa las infografías en orden. Si observas deformaciones, grietas
            amplias, desprendimientos o riesgo de colapso, aléjate del lugar.
          </p>
        </div>
        <ShieldAlert aria-hidden="true" />
      </section>

      <nav className="infographic-index" aria-label="Índice de infografías">
        <span>Contenido</span>
        {infographics.map((item) => (
          <a href={`#infografia-${item.number}`} key={item.number}>
            {item.number}
          </a>
        ))}
      </nav>

      <section className="infographic-sequence" aria-label="Infografías">
        {infographics.map((item) => (
          <article id={`infografia-${item.number}`} key={item.number}>
            <header>
              <span>{item.number}</span>
              <h2>{item.title}</h2>
              <a href={item.src} target="_blank" rel="noreferrer">
                Abrir imagen
                <ExternalLink aria-hidden="true" />
              </a>
            </header>
            <a
              className="infographic-image"
              href={item.src}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir ${item.title} a tamaño completo`}
            >
              <Image
                src={item.src}
                alt={item.alt}
                width={1055}
                height={1491}
                sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1100px) 78vw, 820px"
              />
            </a>
          </article>
        ))}
      </section>

      <aside className="infographic-warning">
        <strong>
          La observación visual no sustituye una inspección técnica.
        </strong>
        <p>
          No ingreses a una estructura si escuchas crujidos, ves elementos
          inclinados o existen desprendimientos activos.
        </p>
      </aside>
    </main>
  );
}
