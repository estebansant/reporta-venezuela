"use client";

import Image from "next/image";
import { Check, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { useState } from "react";

import { damageLabels } from "@/components/damage-app/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PublicReport } from "@/lib/report-schema";
import {
  normalizeVenezuelanCity,
  normalizeVenezuelanState,
} from "@/lib/venezuelan-locations";

const reportDateFormatter = new Intl.DateTimeFormat("es-VE", {
  dateStyle: "medium",
  timeStyle: "short",
});

function ReportGallery({
  report,
  detail = false,
}: {
  report: PublicReport;
  detail?: boolean;
}) {
  const images = report.images.length
    ? report.images
    : [
        {
          id: "placeholder",
          url: "/window.svg",
          width: 3,
          height: 4,
          position: 0,
        },
      ];
  const gallery = (
    <Carousel opts={{ loop: images.length > 1 }}>
      <CarouselContent className="-ml-0">
        {images.map((image, index) => (
          <CarouselItem className="pl-0" key={image.id}>
            <div className="report-image">
              <Image
                src={image.url}
                alt={`Daño reportado en ${report.buildingName}, foto ${index + 1}`}
                fill
                sizes={
                  detail
                    ? "(max-width: 767px) 100vw, 560px"
                    : "(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
                }
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      {images.length > 1 ? (
        <>
          <CarouselPrevious className="report-carousel-previous" />
          <CarouselNext className="report-carousel-next" />
        </>
      ) : null}
    </Carousel>
  );

  return (
    <div
      className={detail ? "report-gallery detail" : "report-gallery"}
      onClick={(event) => {
        if ((event.target as Element).closest("button")) {
          event.stopPropagation();
        }
      }}
    >
      {gallery}
      <Badge className={`severity-${report.damageType}`}>
        {damageLabels[report.damageType]}
      </Badge>
      {report.needsHelp ? (
        <Badge className="needs-help-badge">
          <ShieldAlert aria-hidden="true" />
          Se necesita ayuda
        </Badge>
      ) : null}
    </div>
  );
}

export function ReportCard({
  report,
  onHelpResolved,
}: {
  report: PublicReport;
  onHelpResolved: (report: PublicReport) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const contact = [report.contactName, report.contactPhone, report.contactEmail]
    .filter(Boolean)
    .join(" · ");
  const city = normalizeVenezuelanCity(report.city);
  const state = normalizeVenezuelanState(report.state);

  async function resolveHelpRequest() {
    setUpdating(true);
    setUpdateError("");

    try {
      const response = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ needsHelp: false }),
      });
      const result = (await response.json()) as {
        report?: PublicReport;
        error?: string;
      };
      if (!response.ok || !result.report) {
        throw new Error(result.error ?? "No se pudo actualizar el reporte.");
      }
      onHelpResolved(result.report);
      setConfirming(false);
    } catch (caught) {
      setUpdateError(
        caught instanceof Error
          ? caught.message
          : "No se pudo actualizar el reporte.",
      );
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Card
        className="report-card"
        role="button"
        tabIndex={0}
        aria-label={`Ver detalles de ${report.buildingName}`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ReportGallery report={report} />
        <CardHeader>
          <CardTitle>{report.buildingName}</CardTitle>
          <p className="report-location">
            {report.address} · {city ? `${city}, ` : ""}
            {state}
          </p>
        </CardHeader>
        <CardContent>
          <p className="report-description">{report.description}</p>
          {contact ? (
            <p className="public-contact">
              <strong className="report-contact-label">Contacto</strong>
              <span>{contact}</span>
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <div className="report-meta">
            <time dateTime={new Date(report.createdAt).toISOString()}>
              {reportDateFormatter.format(new Date(report.createdAt))}
            </time>
            <span>
              {report.images.length}{" "}
              {report.images.length === 1 ? "foto" : "fotos"}
            </span>
          </div>
        </CardFooter>
      </Card>

      <DialogContent className="report-detail-dialog" showCloseButton={false}>
        <DialogClose
          className="report-detail-close"
          render={
            <Button
              variant="secondary"
              size="icon"
              aria-label="Cerrar detalles del reporte"
            />
          }
        >
          <X aria-hidden="true" />
        </DialogClose>
        <ReportGallery report={report} detail />
        <div className="report-detail-copy">
          <DialogHeader>
            <DialogTitle>{report.buildingName}</DialogTitle>
            <DialogDescription className="report-location">
              {report.address} · {city ? `${city}, ` : ""}
              {state}
            </DialogDescription>
          </DialogHeader>
          <p className="report-description">{report.description}</p>
          {contact ? (
            <p className="public-contact">
              <strong className="report-contact-label">Contacto</strong>
              <span>{contact}</span>
            </p>
          ) : null}
          <div className="report-meta">
            <time dateTime={new Date(report.createdAt).toISOString()}>
              {reportDateFormatter.format(new Date(report.createdAt))}
            </time>
            <span>
              {report.images.length}{" "}
              {report.images.length === 1 ? "foto" : "fotos"}
            </span>
          </div>
          {report.needsHelp ? (
            <div className="help-resolution">
              {confirming ? (
                <div className="help-confirmation">
                  <span>¿Confirmas que ya fue atendida?</span>
                  <div>
                    <Button
                      size="sm"
                      onClick={resolveHelpRequest}
                      disabled={updating}
                    >
                      {updating ? (
                        <LoaderCircle
                          data-icon="inline-start"
                          className="help-spinner"
                        />
                      ) : (
                        <Check data-icon="inline-start" />
                      )}
                      Confirmar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirming(false);
                        setUpdateError("");
                      }}
                      disabled={updating}
                    >
                      <X data-icon="inline-start" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="resolve-help-button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(true)}
                >
                  <Check data-icon="inline-start" />
                  Ya no se necesita ayuda
                </Button>
              )}
              {updateError ? (
                <p className="help-update-error" role="alert">
                  {updateError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
