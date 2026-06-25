import Link from "next/link";
import { ArrowUpRight, Lightbulb, Phone } from "lucide-react";

const resources = [
  {
    href: "/infografias",
    eyebrow: "Guía visual",
    title: "Infografías de daños",
    description: "Señales de riesgo y recomendaciones para revisar estructuras.",
    icon: Lightbulb,
  },
  {
    href: "/emergencias",
    eyebrow: "Ayuda inmediata",
    title: "Teléfonos de emergencia",
    description: "Directorio nacional y contactos confirmados por ciudad.",
    icon: Phone,
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-intro">
          <p className="site-footer-kicker">Información útil</p>
          <h2>Recursos para actuar con claridad</h2>
          <p>
            Esta plataforma ciudadana facilita información para reportar daños y
            acceder a recursos tras el terremoto. No solicitamos ni gestionamos
            dinero, donaciones o ayudas.
          </p>
        </div>

        <nav className="site-footer-resources" aria-label="Recursos de ayuda">
          {resources.map(({ href, eyebrow, title, description, icon: Icon }) => (
            <Link className="site-footer-resource" href={href} key={href}>
              <Icon aria-hidden="true" />
              <span>
                <small>{eyebrow}</small>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <ArrowUpRight aria-hidden="true" />
            </Link>
          ))}
        </nav>

        <div className="site-footer-bottom">
          <div>
            <strong>Terremoto Venezuela</strong>
            <span>Herramienta ciudadana, voluntaria y no partidista.</span>
          </div>
          <p>
            ¿Encontraste un problema en el sitio o tienes una idea para
            mejorarlo?{" "}
            <a href="mailto:contact@estebansant.com">
              contact@estebansant.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
