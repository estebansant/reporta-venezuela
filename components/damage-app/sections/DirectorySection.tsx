import { Search, ShieldAlert } from "lucide-react";

import {
  damageLabels,
  venezuelanStates,
} from "@/components/damage-app/constants";
import { ReportCard } from "@/components/damage-app/reports/ReportCard";
import { ReportDialog } from "@/components/damage-app/reports/ReportDialog";
import type { ReportCreatedHandler } from "@/components/damage-app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  damageTypes,
  type DamageType,
  type PublicReport,
} from "@/lib/report-schema";

export function DirectorySection({
  reports,
  search,
  state,
  damageType,
  page,
  pageSize,
  total,
  totalPages,
  loading,
  loadError,
  onSearchChange,
  onStateChange,
  onDamageTypeChange,
  onPageChange,
  onRetry,
  onCreated,
  onHelpResolved,
}: {
  reports: PublicReport[];
  search: string;
  state: string;
  damageType: "all" | DamageType;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  loading: boolean;
  loadError: string;
  onSearchChange: (search: string) => void;
  onStateChange: (state: string) => void;
  onDamageTypeChange: (damageType: "all" | DamageType) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onCreated: ReportCreatedHandler;
  onHelpResolved: (report: PublicReport) => void;
}) {
  const pageNumbers = getPageNumbers(page, totalPages);
  const firstResult = total ? (page - 1) * pageSize + 1 : 0;
  const lastResult = Math.min(page * pageSize, total);

  return (
    <section className="directory section-pad" id="directorio">
      <div className="directory-heading">
        <div>
          <p className="eyebrow">Directorio público</p>
          <h1>Edificios y casas reportados</h1>
        </div>
        <div className="directory-controls">
          <div className="search-field">
            <Search />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar por nombre o dirección…"
            />
          </div>
          <Select
            value={state}
            onValueChange={(value) => onStateChange(value ?? "all")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Todos los estados</SelectItem>
                {venezuelanStates.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="filter-row">
        <Button
          variant={damageType === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => onDamageTypeChange("all")}
        >
          Todos
        </Button>
        {damageTypes.map((type) => (
          <Button
            key={type}
            variant={damageType === type ? "default" : "outline"}
            size="sm"
            onClick={() => onDamageTypeChange(type)}
          >
            {damageLabels[type]}
          </Button>
        ))}
      </div>
      {loadError ? (
        <div className="no-results">
          <ShieldAlert />
          <strong>{loadError}</strong>
          <Button onClick={onRetry}>Reintentar</Button>
        </div>
      ) : null}
      {!loadError && loading ? (
        <div className="no-results">
          <strong>Cargando reportes…</strong>
        </div>
      ) : null}
      {!loadError && !loading && reports.length ? (
        <>
          <div className="directory-results-summary" aria-live="polite">
            Mostrando {firstResult}–{lastResult} de {total} reportes
          </div>
          <div className="report-grid">
            {reports.map((report) => (
              <ReportCard
                report={report}
                key={report.id}
                onHelpResolved={onHelpResolved}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <Pagination className="directory-pagination">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#directorio"
                    text="Anterior"
                    aria-disabled={page === 1}
                    tabIndex={page === 1 ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      if (page > 1) onPageChange(page - 1);
                    }}
                  />
                </PaginationItem>
                {pageNumbers.map((item, index) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href="#directorio"
                        isActive={item === page}
                        aria-label={`Ir a la página ${item}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onPageChange(item);
                        }}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#directorio"
                    text="Siguiente"
                    aria-disabled={page === totalPages}
                    tabIndex={page === totalPages ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      if (page < totalPages) onPageChange(page + 1);
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </>
      ) : null}
      {!loadError && !loading && !reports.length ? (
        <div className="no-results">
          <Search />
          <strong>No hay reportes con estos filtros.</strong>
          <ReportDialog compact onCreated={onCreated} />
        </div>
      ) : null}
    </section>
  );
}

function getPageNumbers(
  currentPage: number,
  totalPages: number
): Array<number | "ellipsis"> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) pages.push("ellipsis");
  for (let item = start; item <= end; item += 1) pages.push(item);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);

  return pages;
}
