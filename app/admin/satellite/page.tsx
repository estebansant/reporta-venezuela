"use client";

import { useCallback, useState } from "react";
import { LoaderCircle, SatelliteDish } from "lucide-react";

import { damageLabels } from "@/components/damage-app/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DamageType } from "@/lib/report-schema";

interface Candidate {
  id: string;
  latitude: number;
  longitude: number;
  suggestedDamageType: DamageType;
  score: number | null;
  sourceName: string;
  sourceId: string;
  state: string | null;
  city: string | null;
  note: string | null;
  createdAt: string;
  chipUrl: string | null;
  chipPreUrl: string | null;
}

function osmEmbedUrl(lat: number, lng: number) {
  const d = 0.01;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export default function SatelliteAdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/satellite/candidates", {
        headers: { "x-satellite-admin-secret": key },
      });
      if (response.status === 401) {
        setAuthed(false);
        setError("Secreto inválido.");
        return;
      }
      if (!response.ok) throw new Error("No se pudo cargar la cola.");
      const data = (await response.json()) as { candidates: Candidate[] };
      setCandidates(data.candidates);
      setAuthed(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error de carga.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function review(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/satellite/candidates/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-satellite-admin-secret": secret,
        },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("La acción falló.");
      setCandidates((current) => current.filter((item) => item.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error.");
    } finally {
      setBusyId(null);
    }
  }

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <SatelliteDish aria-hidden="true" />
          Revisión satelital
        </h1>
        <p className="report-description">
          Introduce el secreto de administración para revisar las detecciones
          pendientes.
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load(secret);
          }}
        >
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="SATELLITE_ADMIN_SECRET"
            className="rounded-md border border-[var(--sand-dark)] bg-[var(--cream-paper)] px-3 py-2"
            autoComplete="off"
          />
          <Button type="submit" disabled={loading || !secret}>
            {loading ? <LoaderCircle className="help-spinner" /> : null}
            Entrar
          </Button>
          {error ? (
            <p className="help-update-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <SatelliteDish aria-hidden="true" />
          Cola de revisión satelital ({candidates.length})
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(secret)}
          disabled={loading}
        >
          {loading ? <LoaderCircle className="help-spinner" /> : null}
          Recargar
        </Button>
      </header>

      {error ? (
        <p className="help-update-error" role="alert">
          {error}
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="report-description">No hay detecciones pendientes.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.id}
              className="flex flex-col gap-3 rounded-lg border border-[var(--sand)] bg-[var(--cream-paper)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`severity-${candidate.suggestedDamageType}`}>
                  {damageLabels[candidate.suggestedDamageType]}
                </Badge>
                <span className="report-description">
                  {candidate.city ?? "—"}
                  {candidate.score != null
                    ? ` · confianza ${Math.round(candidate.score * 100)}%`
                    : ""}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <figure className="flex flex-col gap-1">
                  <figcaption className="report-location">Antes</figcaption>
                  {candidate.chipPreUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={candidate.chipPreUrl}
                      alt="Imagen satelital previa al evento"
                      className="aspect-square w-full rounded-md object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-[var(--cream-soft)] report-location">
                      sin imagen previa
                    </div>
                  )}
                </figure>
                <figure className="flex flex-col gap-1">
                  <figcaption className="report-location">Después</figcaption>
                  {candidate.chipUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={candidate.chipUrl}
                      alt="Imagen satelital posterior al evento"
                      className="aspect-square w-full rounded-md object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-[var(--cream-soft)] report-location">
                      sin imagen
                    </div>
                  )}
                </figure>
              </div>

              <iframe
                title={`Ubicación ${candidate.id}`}
                src={osmEmbedUrl(candidate.latitude, candidate.longitude)}
                className="h-40 w-full rounded-md border border-[var(--sand)]"
                loading="lazy"
              />

              <p className="report-location">
                {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
                {" · "}
                <a
                  href={`https://www.google.com/maps/@${candidate.latitude},${candidate.longitude},19z/data=!3m1!1e3`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  abrir en Maps (satélite)
                </a>
                <br />
                {candidate.sourceName} · {candidate.sourceId}
              </p>

              <div className="mt-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void review(candidate.id, "approve")}
                  disabled={busyId === candidate.id}
                >
                  Aprobar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void review(candidate.id, "reject")}
                  disabled={busyId === candidate.id}
                >
                  Rechazar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
