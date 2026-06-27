"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  MapPin,
  SatelliteDish,
  X,
} from "lucide-react";

import { damageLabels } from "@/components/damage-app/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DamageType } from "@/lib/report-schema";

// ── Types ────────────────────────────────────────────────────────────────────

type ReviewStatus =
  | "triaged_by_satellite"
  | "externally_corroborated"
  | "verified_damaged"
  | "verified_collapsed";

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

interface ImageryScene {
  sceneId: string;
  provider: string;
  phase: string | null;
  datetime: string | null;
  resolutionM: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VHR_SOURCES = new Set([
  "maxar-open-data",
  "ms-ai-for-good",
  "copernicus-ems",
  "copernicus-ems-area",
  "unosat",
]);

const REVIEW_OPTIONS: {
  value: ReviewStatus;
  label: string;
  desc: string;
  vhrRequired: boolean;
}[] = [
  {
    value: "triaged_by_satellite",
    label: "Hotspot satelital",
    desc: "Señal medium-res confirmada",
    vhrRequired: false,
  },
  {
    value: "externally_corroborated",
    label: "Corroborado",
    desc: "Múltiples fuentes coinciden",
    vhrRequired: false,
  },
  {
    value: "verified_damaged",
    label: "Daño verificado",
    desc: "Requiere imagen VHR",
    vhrRequired: true,
  },
  {
    value: "verified_collapsed",
    label: "Colapso verificado",
    desc: "Requiere imagen VHR",
    vhrRequired: true,
  },
];

function defaultStatus(sourceName: string): ReviewStatus {
  return VHR_SOURCES.has(sourceName) ? "verified_damaged" : "triaged_by_satellite";
}

function osmEmbedUrl(lat: number, lng: number) {
  const d = 0.01;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

// ── Image comparison slider ───────────────────────────────────────────────────

function CompareSlider({ preUrl, postUrl }: { preUrl: string; postUrl: string }) {
  const [split, setSplit] = useState(50);

  return (
    <div
      className="relative overflow-hidden select-none bg-[var(--cream-soft)]"
      style={{ aspectRatio: "1 / 1" }}
    >
      {/* Post-event — clips to show right portion */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={postUrl}
          alt="Imagen satelital — después del evento"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      </div>
      {/* Pre-event — clips to show left portion */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preUrl}
          alt="Imagen satelital — antes del evento"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      </div>
      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_6px_rgba(0,0,0,0.45)] pointer-events-none"
        style={{ left: `${split}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-md">
          <svg
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5 text-[var(--ink)]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M5 8H1M5 8L3 6M5 8L3 10M11 8h4M11 8l2-2M11 8l2 2" />
          </svg>
        </div>
      </div>
      {/* Labels */}
      <div className="absolute top-2 left-2 pointer-events-none">
        <span className="eyebrow bg-[var(--ink)] text-[var(--cream-bg)] px-1.5 py-0.5">
          Antes
        </span>
      </div>
      <div className="absolute top-2 right-2 pointer-events-none">
        <span className="eyebrow bg-[var(--terracotta)] text-[var(--cream-bg)] px-1.5 py-0.5">
          Después
        </span>
      </div>
      {/* Range input — captures pointer + touch drag */}
      <input
        type="range"
        min={1}
        max={99}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        className="absolute inset-0 w-full h-full m-0 opacity-0 cursor-col-resize"
        style={{ appearance: "none" }}
        aria-label="Desliza para comparar imágenes antes y después del evento"
      />
    </div>
  );
}

// ── Candidate list row ────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  selected,
  onClick,
}: {
  candidate: Candidate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-[var(--sand)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--terracotta)] focus-visible:outline-offset-[-2px] ${
        selected
          ? "bg-[var(--cream-soft)]"
          : "bg-[var(--cream-paper)] hover:bg-[var(--cream-bg)]"
      }`}
    >
      {candidate.chipUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={candidate.chipUrl}
          alt=""
          aria-hidden="true"
          className="w-10 h-10 flex-none object-cover rounded-sm mt-0.5"
        />
      ) : (
        <div className="w-10 h-10 flex-none rounded-sm bg-[var(--cream-soft)] flex items-center justify-center mt-0.5">
          <MapPin className="w-4 h-4 text-[var(--ink-mute)]" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          <Badge
            className={`severity-${candidate.suggestedDamageType} text-[0.58rem] px-1 py-0 leading-5`}
          >
            {damageLabels[candidate.suggestedDamageType]}
          </Badge>
          {candidate.score != null && (
            <span className="text-[0.6rem] text-[#68717c] font-mono">
              {Math.round(candidate.score * 100)}%
            </span>
          )}
        </div>
        <p className="text-xs font-semibold text-[var(--ink)] truncate leading-snug">
          {candidate.city ?? candidate.state ?? "Ubicación desconocida"}
        </p>
        <p className="text-[0.62rem] text-[#68717c] mt-0.5 font-mono truncate">
          {candidate.sourceName}
        </p>
      </div>
    </button>
  );
}

// ── Review status picker ──────────────────────────────────────────────────────

function ReviewStatusPicker({
  value,
  onChange,
  isVhr,
}: {
  value: ReviewStatus;
  onChange: (v: ReviewStatus) => void;
  isVhr: boolean;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="eyebrow mb-2 col-span-2 text-[var(--ink)]">
        Estado de verificación
      </legend>
      {REVIEW_OPTIONS.map((opt) => {
        const disabled = opt.vhrRequired && !isVhr;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex flex-col gap-0.5 p-2.5 text-left border rounded-sm min-h-[44px] transition-colors ${
              disabled
                ? "opacity-40 cursor-not-allowed border-[var(--sand)] bg-[var(--cream-soft)]"
                : active
                  ? "border-[var(--terracotta)] bg-[var(--terracotta)] cursor-pointer"
                  : "border-[var(--sand)] bg-[var(--cream-paper)] hover:border-[var(--sand-dark)] cursor-pointer"
            }`}
          >
            <span
              className={`font-semibold text-xs leading-snug ${
                active ? "text-[var(--cream-bg)]" : "text-[var(--ink)]"
              }`}
            >
              {opt.label}
            </span>
            <span
              className={`text-[0.6rem] leading-snug ${
                active ? "text-[var(--cream-warm-text)]" : "text-[#68717c]"
              }`}
            >
              {opt.desc}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

// ── Candidate detail panel ────────────────────────────────────────────────────

function CandidateDetail({
  candidate,
  secret,
  onBack,
  onDone,
}: {
  candidate: Candidate;
  secret: string;
  onBack: () => void;
  onDone: (id: string) => void;
}) {
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(() =>
    defaultStatus(candidate.sourceName),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [scenes, setScenes] = useState<ImageryScene[]>([]);

  const isVhr = VHR_SOURCES.has(candidate.sourceName);

  useEffect(() => {
    const delta = 0.15;
    const params = new URLSearchParams({
      north: String(candidate.latitude + delta),
      south: String(candidate.latitude - delta),
      east: String(candidate.longitude + delta),
      west: String(candidate.longitude - delta),
      limit: "10",
    });
    fetch(`/api/imagery?${params}`)
      .then((r) => (r.ok ? r.json() : { scenes: [] }))
      .then((d: { scenes: ImageryScene[] }) => setScenes(d.scenes))
      .catch(() => {});
  }, [candidate.id, candidate.latitude, candidate.longitude]);

  async function submit(action: "approve" | "reject") {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/satellite/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-satellite-admin-secret": secret,
        },
        body: JSON.stringify({
          action,
          reviewStatus: action === "approve" ? reviewStatus : undefined,
          evidenceNote: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? "La acción falló.");
      }
      onDone(candidate.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error.");
    } finally {
      setBusy(false);
    }
  }

  const hasBoth = Boolean(candidate.chipUrl && candidate.chipPreUrl);
  const hasAny = Boolean(candidate.chipUrl || candidate.chipPreUrl);

  return (
    <article className="flex flex-col h-full overflow-hidden">
      {/* Mobile back */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--sand)] bg-[var(--cream-paper)] lg:hidden flex-none">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)] min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Candidatos
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--sand)] bg-[var(--cream-paper)]">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge className={`severity-${candidate.suggestedDamageType}`}>
              {damageLabels[candidate.suggestedDamageType]}
            </Badge>
            {candidate.score != null && (
              <span className="eyebrow text-[var(--terracotta)]">
                {Math.round(candidate.score * 100)}% confianza
              </span>
            )}
            {isVhr && (
              <span className="eyebrow" style={{ color: "var(--rust)" }}>
                Fuente VHR
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-[var(--ink)] leading-snug">
            {candidate.city ?? candidate.state ?? "Sin ubicación"}
            {candidate.city && candidate.state ? `, ${candidate.state}` : ""}
          </p>
          <p className="report-location mt-0.5 font-mono">
            {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
            {" · "}
            {candidate.sourceName}
          </p>
        </div>

        {/* Image comparison */}
        <div className="border-b border-[var(--sand)]">
          <div className="px-4 pt-3 pb-2">
            <p className="eyebrow text-[var(--ink)]">Imagen satelital</p>
          </div>
          {hasBoth ? (
            <CompareSlider preUrl={candidate.chipPreUrl!} postUrl={candidate.chipUrl!} />
          ) : candidate.chipUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={candidate.chipUrl}
                alt="Imagen satelital posterior al evento"
                className="w-full aspect-square object-cover"
              />
              <div className="absolute top-2 right-2">
                <span className="eyebrow bg-[var(--terracotta)] text-[var(--cream-bg)] px-1.5 py-0.5">
                  Después
                </span>
              </div>
            </div>
          ) : candidate.chipPreUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={candidate.chipPreUrl}
                alt="Imagen satelital previa al evento"
                className="w-full aspect-square object-cover"
              />
              <div className="absolute top-2 left-2">
                <span className="eyebrow bg-[var(--ink)] text-[var(--cream-bg)] px-1.5 py-0.5">
                  Antes
                </span>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-3">
              <iframe
                title={`Mapa de ubicación — candidato ${candidate.id}`}
                src={osmEmbedUrl(candidate.latitude, candidate.longitude)}
                className="w-full h-48 border border-[var(--sand)] rounded-sm"
                loading="lazy"
              />
            </div>
          )}
          {!hasAny && (
            <p className="px-4 pb-3 report-location text-[0.68rem]">
              Sin recortes satelitales. Se muestra mapa de referencia.
            </p>
          )}
        </div>

        {/* Evidence lineage */}
        <div className="px-4 py-3 border-b border-[var(--sand)]">
          <p className="eyebrow text-[var(--ink)] mb-2">Linaje de evidencia</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="report-location font-mono">Fuente</dt>
            <dd className="text-xs font-semibold text-[var(--ink)]">
              {candidate.sourceName}
            </dd>
            <dt className="report-location font-mono">ID externo</dt>
            <dd className="text-xs text-[var(--ink)] break-all">{candidate.sourceId}</dd>
            {candidate.note ? (
              <>
                <dt className="report-location font-mono">Nota</dt>
                <dd className="text-xs text-[var(--ink)]">{candidate.note}</dd>
              </>
            ) : null}
          </dl>

          {scenes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--sand)]">
              <p className="text-[0.68rem] font-semibold text-[var(--ink)] mb-1.5">
                Escenas en el área ({scenes.length})
              </p>
              <ul className="flex flex-col gap-1">
                {scenes.map((scene) => (
                  <li
                    key={scene.sceneId}
                    className="flex items-center gap-2 text-[0.62rem] text-[#68717c]"
                  >
                    <span
                      className={`eyebrow text-[0.5rem] px-1 py-0 ${
                        scene.phase === "pre"
                          ? "bg-[var(--cream-soft)] text-[var(--ink)]"
                          : "bg-[var(--terracotta)] text-[var(--cream-bg)]"
                      }`}
                    >
                      {scene.phase ?? "?"}
                    </span>
                    <span className="font-mono">{scene.provider}</span>
                    {scene.datetime ? (
                      <span>
                        {new Date(scene.datetime).toLocaleDateString("es-VE", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    ) : null}
                    {scene.resolutionM ? (
                      <span>{scene.resolutionM} m/px</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <a
            href={`https://www.google.com/maps/@${candidate.latitude},${candidate.longitude},19z/data=!3m1!1e3`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[0.68rem] text-[var(--terracotta)] underline underline-offset-2"
          >
            <MapPin className="w-3 h-3" aria-hidden="true" />
            Ver en Google Maps (satélite)
          </a>
        </div>

        {/* Moderation */}
        <div className="px-4 py-4 flex flex-col gap-3">
          <ReviewStatusPicker
            value={reviewStatus}
            onChange={setReviewStatus}
            isVhr={isVhr}
          />

          {!isVhr && (
            <p className="text-[0.62rem] text-[#68717c]">
              Fuente medium-res — estado máximo permitido:{" "}
              <em>Hotspot satelital</em> o <em>Corroborado</em>.
            </p>
          )}

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
            <span>
              Nota de verificación{" "}
              <span className="font-normal text-[#68717c]">(opcional)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observaciones, condiciones de imagen, contexto adicional…"
              rows={2}
              className="w-full rounded-sm border border-[var(--sand-dark)] bg-[var(--cream-paper)] px-3 py-2 text-xs font-normal text-[var(--ink)] resize-none focus:border-[var(--terracotta)] focus:outline-none focus:ring-1 focus:ring-[var(--terracotta)] placeholder:text-[var(--ink-mute)]"
            />
          </label>

          {actionError ? (
            <p className="help-update-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => void submit("approve")}
              disabled={busy}
              className="min-h-[44px] gap-1.5"
            >
              {busy ? (
                <LoaderCircle className="help-spinner w-4 h-4" aria-hidden="true" />
              ) : (
                <Check className="w-4 h-4" aria-hidden="true" />
              )}
              Aprobar
            </Button>
            <Button
              variant="outline"
              onClick={() => void submit("reject")}
              disabled={busy}
              className="min-h-[44px] gap-1.5"
            >
              {busy ? (
                <LoaderCircle className="help-spinner w-4 h-4" aria-hidden="true" />
              ) : (
                <X className="w-4 h-4" aria-hidden="true" />
              )}
              Rechazar
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SatelliteAdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/satellite/candidates", {
        headers: { "x-satellite-admin-secret": key },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("Secreto inválido.");
        return;
      }
      if (!res.ok) throw new Error("No se pudo cargar la cola.");
      const data = (await res.json()) as { candidates: Candidate[] };
      setCandidates(data.candidates);
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de carga.");
    } finally {
      setLoading(false);
    }
  }, []);

  function removeDone(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }

  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  // ── Login gate ─────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
        <div>
          <p className="eyebrow mb-1">Consola de verificación</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-[var(--ink)]">
            <SatelliteDish
              className="w-5 h-5 text-[var(--terracotta)]"
              aria-hidden="true"
            />
            Revisión satelital
          </h1>
          <p className="mt-2 text-sm text-[#68717c] leading-relaxed max-w-[38ch]">
            Compara imagen VHR pre/post, asigna estado de verificación y
            construye el linaje de evidencia.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void load(secret);
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
            Secreto de administración
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="SATELLITE_ADMIN_SECRET"
              className="rounded-sm border border-[var(--sand-dark)] bg-[var(--cream-paper)] px-3 py-2 text-sm font-normal text-[var(--ink)] placeholder:text-[var(--ink-mute)] focus:border-[var(--terracotta)] focus:outline-none focus:ring-1 focus:ring-[var(--terracotta)]"
              autoComplete="off"
            />
          </label>
          <Button
            type="submit"
            disabled={loading || !secret}
            className="min-h-[44px] gap-2"
          >
            {loading ? (
              <LoaderCircle className="help-spinner w-4 h-4" aria-hidden="true" />
            ) : null}
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

  // ── Workstation ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <header className="flex-none flex items-center justify-between gap-4 px-4 py-2.5 border-b border-[var(--sand)] bg-[var(--cream-paper)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <SatelliteDish
            className="w-4 h-4 text-[var(--terracotta)] flex-none"
            aria-hidden="true"
          />
          <span className="font-semibold text-sm text-[var(--ink)] truncate">
            Consola de verificación
          </span>
          <span className="eyebrow text-[var(--terracotta)] flex-none hidden sm:block">
            {candidates.length} pendiente{candidates.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(secret)}
          disabled={loading}
          className="min-h-[36px] flex-none gap-1.5"
        >
          {loading ? (
            <LoaderCircle className="help-spinner w-3.5 h-3.5" aria-hidden="true" />
          ) : null}
          Recargar
        </Button>
      </header>

      {error ? (
        <p className="help-update-error flex-none px-4 py-2" role="alert">
          {error}
        </p>
      ) : null}

      {/* Split panel */}
      <div className="flex-1 overflow-hidden flex lg:grid lg:grid-cols-[300px_1fr]">
        {/* Candidate queue */}
        <aside
          className={`flex-col overflow-y-auto border-[var(--sand)] bg-[var(--cream-paper)] ${
            selected ? "hidden lg:flex" : "flex flex-1"
          } lg:border-r lg:flex-none`}
        >
          {candidates.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <SatelliteDish
                className="w-8 h-8 text-[var(--sand-dark)]"
                aria-hidden="true"
              />
              <p className="text-sm text-[#68717c]">
                No hay detecciones pendientes.
              </p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-[var(--sand)] flex-none">
                <p className="eyebrow text-[var(--ink)]">
                  {candidates.length} candidato
                  {candidates.length !== 1 ? "s" : ""} en cola
                </p>
              </div>
              {candidates.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  selected={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </>
          )}
        </aside>

        {/* Detail panel */}
        <main
          className={`overflow-hidden bg-[var(--cream-bg)] ${
            selected
              ? "flex flex-1 flex-col"
              : "hidden lg:flex lg:flex-1 lg:items-center lg:justify-center"
          }`}
        >
          {selected ? (
            <CandidateDetail
              key={selected.id}
              candidate={selected}
              secret={secret}
              onBack={() => setSelectedId(null)}
              onDone={removeDone}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center max-w-xs">
              <SatelliteDish
                className="w-10 h-10 text-[var(--sand-dark)]"
                aria-hidden="true"
              />
              <p className="text-sm text-[#68717c] leading-relaxed">
                Selecciona un candidato de la cola para revisar la evidencia y
                asignar el estado de verificación.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
