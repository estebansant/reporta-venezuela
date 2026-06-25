import { Menu } from "lucide-react";
import Link from "next/link";

import { ReportDialog } from "@/components/damage-app/reports/ReportDialog";
import { navItems } from "@/components/damage-app/constants";
import type { ReportCreatedHandler } from "@/components/damage-app/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNav({ onCreated }: { onCreated: ReportCreatedHandler }) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="mobile-menu"
            aria-label="Abrir navegación"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="right" className="mobile-sheet">
        <SheetHeader>
          <SheetTitle>Navegación</SheetTitle>
        </SheetHeader>
        <nav>
          {navItems.map(([label, href]) => (
            <SheetClose
              key={label}
              nativeButton={false}
              render={<a href={href} className="mobile-nav-link" />}
            >
              {label}
            </SheetClose>
          ))}
          <SheetClose
            nativeButton={false}
            render={<Link href="/infografias" className="mobile-nav-link" />}
          >
            Infografías sobre daños
          </SheetClose>
          <SheetClose
            nativeButton={false}
            render={<Link href="/personas-desaparecidas" className="mobile-nav-link" />}
          >
            Personas desaparecidas
          </SheetClose>
          <SheetClose
            nativeButton={false}
            render={<Link href="/emergencias" className="mobile-nav-link" />}
          >
            Teléfonos de emergencias
          </SheetClose>
        </nav>
        <div className="mobile-sheet-report">
          <ReportDialog compact onCreated={onCreated} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
