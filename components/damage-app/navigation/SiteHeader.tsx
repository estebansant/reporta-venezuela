import Link from "next/link";

import { navItems } from "@/components/damage-app/constants";
import { Brand } from "@/components/damage-app/navigation/Brand";
import { MobileNav } from "@/components/damage-app/navigation/MobileNav";
import { ReportDialog } from "@/components/damage-app/reports/ReportDialog";
import type { ReportCreatedHandler } from "@/components/damage-app/types";

export function SiteHeader({ onCreated }: { onCreated: ReportCreatedHandler }) {
  return (
    <header className="site-header">
      <Brand />
      <div className="header-actions">
        <nav className="desktop-nav" aria-label="Navegación principal">
          {navItems.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
          <Link href="/infografias">Infografías</Link>
          <Link href="/centros-de-acopio">Centros de acopio</Link>
          <Link href="/personas-desaparecidas">Personas desaparecidas</Link>
          <Link href="/emergencias">Emergencias</Link>
        </nav>
        <div className="desktop-header-report">
          <ReportDialog compact onCreated={onCreated} />
        </div>
        <div className="mobile-header-report">
          <ReportDialog compact onCreated={onCreated} />
        </div>
        <MobileNav onCreated={onCreated} />
      </div>
    </header>
  );
}
