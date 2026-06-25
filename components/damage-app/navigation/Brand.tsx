import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/#mapa" aria-label="Ir al mapa">
      <span className="brand-mark">VE</span>
      <span>
        <strong>Mapa de Daños</strong>
        <small>Terremoto 24·06·2026</small>
      </span>
    </Link>
  );
}
