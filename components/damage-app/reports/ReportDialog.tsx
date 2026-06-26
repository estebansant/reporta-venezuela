import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Camera,
  Images,
  LocateFixed,
  MapPin,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import PhoneInput, {
  type Value as PhoneNumberValue,
} from "react-phone-number-input";
import phoneInputLabels from "react-phone-number-input/locale/es";

import {
  contactPhoneCountries,
  damageLabels,
} from "@/components/damage-app/constants";
import { DamageMapClient } from "@/components/damage-app/map/DamageMapClient";
import {
  emptyReportDraft,
  type ReportCreatedHandler,
  type ReportDraft,
} from "@/components/damage-app/types";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProcessedImage } from "@/lib/process-images";
import { damageTypes, reportInputSchema } from "@/lib/report-schema";
import { cn } from "@/lib/utils";

const ReportLocationFields = dynamic(
  () =>
    import("./ReportLocationFields").then(
      (module) => module.ReportLocationFields
    ),
  {
    ssr: false,
    loading: () => (
      <div className="location-fields-loading">Cargando ubicación…</div>
    ),
  }
);

const REPORT_DRAFT_STORAGE_KEY = "damage-report-draft:v1";

type StoredReportDraft = {
  version: 1;
  savedAt: string;
  draft: ReportDraft;
};

type ReportFieldErrors = Partial<
  Record<keyof ReportDraft | "turnstileToken" | "damageType", string>
>;

function isReportDraft(value: unknown): value is ReportDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<keyof ReportDraft, unknown>;
  return (
    typeof draft.buildingName === "string" &&
    typeof draft.address === "string" &&
    typeof draft.state === "string" &&
    typeof draft.city === "string" &&
    typeof draft.latitude === "string" &&
    typeof draft.longitude === "string" &&
    damageTypes.includes(draft.damageType as (typeof damageTypes)[number]) &&
    typeof draft.needsHelp === "boolean" &&
    typeof draft.description === "string" &&
    typeof draft.contactName === "string" &&
    typeof draft.contactPhone === "string" &&
    typeof draft.contactEmail === "string" &&
    typeof draft.contactConsent === "boolean"
  );
}

function readStoredReportDraft() {
  try {
    const stored = window.localStorage.getItem(REPORT_DRAFT_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredReportDraft>;
    if (parsed.version !== 1 || !isReportDraft(parsed.draft)) return null;
    return parsed.draft;
  } catch {
    return null;
  }
}

function hasReportDraftContent(draft: ReportDraft) {
  return Object.keys(emptyReportDraft).some((key) => {
    const field = key as keyof ReportDraft;
    return draft[field] !== emptyReportDraft[field];
  });
}

function writeStoredReportDraft(draft: ReportDraft) {
  try {
    if (!hasReportDraftContent(draft)) {
      window.localStorage.removeItem(REPORT_DRAFT_STORAGE_KEY);
      return;
    }

    const stored: StoredReportDraft = {
      version: 1,
      savedAt: new Date().toISOString(),
      draft,
    };
    window.localStorage.setItem(
      REPORT_DRAFT_STORAGE_KEY,
      JSON.stringify(stored),
    );
  } catch {
    // Ignore storage failures so private browsing/quota errors do not block reporting.
  }
}

function clearStoredReportDraft() {
  try {
    window.localStorage.removeItem(REPORT_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures so private browsing/quota errors do not block reporting.
  }
}

export function ReportDialog({
  compact = false,
  onCreated,
}: {
  compact?: boolean;
  onCreated: ReportCreatedHandler;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReportDraft>(() => {
    if (typeof window === "undefined") return emptyReportDraft;
    return readStoredReportDraft() ?? emptyReportDraft;
  });
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [selectingLocation, setSelectingLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState("");
  const [locationFieldsKey, setLocationFieldsKey] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReportFieldErrors>({});
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<ProcessedImage[]>([]);
  const lastAutoLocationRef = useRef<{
    latitude: string;
    longitude: string;
  } | null>(null);
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  const canGeocodeAddress =
    draft.address.trim().length >= 5 &&
    draft.city.trim().length >= 2 &&
    draft.state.trim().length >= 2;
  const selectedPosition =
    draft.latitude !== "" &&
    draft.longitude !== "" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
      ? { latitude, longitude }
      : null;
  const locationHelpMessage = !canGeocodeAddress
    ? selectedPosition
      ? `Pin ubicado en ${draft.latitude}, ${draft.longitude}. Verifica o ajusta la posición en el mapa.`
      : "Ingresa ambas coordenadas, usa tu ubicación o elige un punto en el mapa."
    : geocoding
    ? "Buscando la dirección en el mapa…"
    : geocodeMessage
      ? geocodeMessage
      : selectedPosition
        ? `Pin ubicado en ${draft.latitude}, ${draft.longitude}. Verifica o ajusta la posición en el mapa.`
        : "Ingresa ambas coordenadas, usa tu ubicación o elige un punto en el mapa.";

  const setToken = useCallback((token: string) => setTurnstileToken(token), []);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    writeStoredReportDraft(draft);
  }, [draft]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl)
      );
    };
  }, []);

  useEffect(() => {
    const address = draft.address.trim();
    const city = draft.city.trim();
    const state = draft.state.trim();
    if (address.length < 5 || city.length < 2 || state.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setGeocoding(true);
      setGeocodeMessage("");
      try {
        const params = new URLSearchParams({ address, city, state });
        const response = await fetch(`/api/geocode?${params}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          found?: boolean;
          latitude?: number;
          longitude?: number;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "No fue posible buscar la dirección.");
        }
        if (
          result.found &&
          typeof result.latitude === "number" &&
          typeof result.longitude === "number"
        ) {
          const nextLatitude = result.latitude.toFixed(6);
          const nextLongitude = result.longitude.toFixed(6);
          lastAutoLocationRef.current = {
            latitude: nextLatitude,
            longitude: nextLongitude,
          };
          setDraft((current) => ({
            ...current,
            latitude: nextLatitude,
            longitude: nextLongitude,
          }));
          setGeocodeMessage(
            "Ubicación sugerida a partir de la dirección. Verifica el pin o ajústalo en el mapa.",
          );
          return;
        }

        setDraft((current) => {
          const autoLocation = lastAutoLocationRef.current;
          if (
            autoLocation &&
            current.latitude === autoLocation.latitude &&
            current.longitude === autoLocation.longitude
          ) {
            lastAutoLocationRef.current = null;
            return { ...current, latitude: "", longitude: "" };
          }
          return current;
        });
        setGeocodeMessage(
          "No pudimos encontrar esa dirección en el mapa. Marca la ubicación manualmente en el mapa.",
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setGeocodeMessage(
          caught instanceof Error
            ? `${caught.message} Marca la ubicación manualmente en el mapa.`
            : "No pudimos encontrar esa dirección. Marca la ubicación manualmente en el mapa.",
        );
      } finally {
        if (!controller.signal.aborted) setGeocoding(false);
      }
    }, 800);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [draft.address, draft.city, draft.state]);

  function updateDraft<K extends keyof ReportDraft>(
    field: K,
    value: ReportDraft[K]
  ) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      return { ...current, [field]: undefined };
    });
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function selectLocation(latitude: number, longitude: number) {
    lastAutoLocationRef.current = null;
    setGeocodeMessage("");
    setDraft((current) => ({
      ...current,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }));
    setSelectingLocation(false);
  }

  function useCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Este navegador no permite obtener tu ubicación.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        selectLocation(position.coords.latitude, position.coords.longitude);
        setLocating(false);
      },
      () => {
        setError("No fue posible obtener tu ubicación.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    if (images.length + files.length > 5) {
      setError("Solo puedes adjuntar hasta 5 imágenes.");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const { processImage } = await import("@/lib/process-images");
      const processed: ProcessedImage[] = [];
      for (const file of Array.from(files)) {
        processed.push(await processImage(file));
      }
      setImages((current) => [...current, ...processed]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo procesar la imagen."
      );
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function removeImage(id: string) {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  }

  async function submitReport() {
    setError("");
    setSuccess("");
    setFieldErrors({});
    const validation = reportInputSchema.safeParse({
      ...draft,
      turnstileToken,
    });
    if (!validation.success) {
      const nextFieldErrors: ReportFieldErrors = {};
      for (const issue of validation.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !nextFieldErrors[field as keyof ReportFieldErrors]) {
          nextFieldErrors[field as keyof ReportFieldErrors] = issue.message;
        }
      }
      setFieldErrors(nextFieldErrors);
      setError(validation.error.issues[0]?.message ?? "Revisa los campos marcados.");
      return;
    }
    if (!images.length) {
      setError("Adjunta al menos una foto del daño.");
      return;
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(draft)) {
      formData.set(key, String(value));
    }
    formData.set("turnstileToken", turnstileToken);
    images.forEach((image) => formData.append("images", image.file));

    setSubmitting(true);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        report?: Parameters<ReportCreatedHandler>[0];
        error?: string;
      };
      if (!response.ok || !result.report) {
        throw new Error(result.error ?? "No se pudo enviar el reporte.");
      }
      onCreated(result.report);
      setSuccess("Reporte publicado correctamente.");
      setFieldErrors({});
      setDraft(emptyReportDraft);
      clearStoredReportDraft();
      lastAutoLocationRef.current = null;
      setGeocodeMessage("");
      setLocationFieldsKey((current) => current + 1);
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setImages([]);
      setTurnstileToken("");
      setTurnstileReset((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar el reporte."
      );
      setTurnstileToken("");
      setTurnstileReset((current) => current + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setTurnstileToken("");
        if (nextOpen) {
          const storedDraft = readStoredReportDraft();
          if (storedDraft) {
            setDraft(storedDraft);
            setLocationFieldsKey((current) => current + 1);
          }
          setTurnstileReset((current) => current + 1);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            id={compact ? undefined : "reportar"}
            className={cn("report-button", compact && "report-button-compact")}
            size="lg"
          />
        }
      >
        <MapPin data-icon="inline-start" />
        Crear reporte
      </DialogTrigger>
      <DialogContent className="report-dialog sm:max-w-3xl">
        <DialogHeader className="report-dialog-header">
          <p className="eyebrow eyebrow-light">Nuevo reporte público</p>
          <DialogTitle>Cuéntanos qué ves</DialogTitle>
          <DialogDescription>
            Registra el daño desde un lugar seguro. Los campos con * son
            obligatorios.
          </DialogDescription>
        </DialogHeader>
        <div className="report-form">
          <div className="contact-grid">
            <label>
              <span>Edificio o estructura *</span>
              <Input
                value={draft.buildingName}
                aria-invalid={fieldErrors.buildingName ? true : undefined}
                aria-describedby={
                  fieldErrors.buildingName ? "report-buildingName-error" : undefined
                }
                onChange={(event) =>
                  updateDraft("buildingName", event.target.value)
                }
                placeholder="Ej. Edificio Las Acacias"
              />
              {fieldErrors.buildingName ? (
                <p className="field-help field-error" id="report-buildingName-error">
                  {fieldErrors.buildingName}
                </p>
              ) : null}
            </label>
            <ReportLocationFields
              key={locationFieldsKey}
              resetKey={locationFieldsKey}
              stateValue={draft.state}
              cityValue={draft.city}
              stateError={fieldErrors.state}
              cityError={fieldErrors.city}
              onStateChange={(state) => updateDraft("state", state)}
              onCityChange={(city) => updateDraft("city", city)}
            />
          </div>
          <label>
            <span>Dirección *</span>
            <Input
              value={draft.address}
              aria-invalid={fieldErrors.address ? true : undefined}
              aria-describedby={fieldErrors.address ? "report-address-error" : undefined}
              onChange={(event) => updateDraft("address", event.target.value)}
              placeholder="Av., calle, urbanización y referencia"
              autoComplete="street-address"
            />
            {fieldErrors.address ? (
              <p className="field-help field-error" id="report-address-error">
                {fieldErrors.address}
              </p>
            ) : null}
          </label>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={useCurrentLocation}
              disabled={locating}
            >
              <LocateFixed data-icon="inline-start" />
              {locating ? "Obteniendo ubicación…" : "Usar mi ubicación"}
            </Button>
            <Button
              type="button"
              variant={selectingLocation ? "default" : "outline"}
              onClick={() => setSelectingLocation((current) => !current)}
            >
              {selectingLocation ? "Haz clic en el mapa" : "Elegir en el mapa"}
            </Button>
          </div>
          <div className="coordinates-grid">
            <label>
              <span>Latitud *</span>
              <Input
                type="number"
                inputMode="decimal"
                min={-90}
                max={90}
                step="any"
                value={draft.latitude}
                aria-invalid={fieldErrors.latitude ? true : undefined}
                aria-describedby={
                  fieldErrors.latitude ? "report-latitude-error" : undefined
                }
                onChange={(event) =>
                  updateDraft("latitude", event.target.value)
                }
                placeholder="Ej. 10.480594"
              />
              {fieldErrors.latitude ? (
                <p className="field-help field-error" id="report-latitude-error">
                  {fieldErrors.latitude}
                </p>
              ) : null}
            </label>
            <label>
              <span>Longitud *</span>
              <Input
                type="number"
                inputMode="decimal"
                min={-180}
                max={180}
                step="any"
                value={draft.longitude}
                aria-invalid={fieldErrors.longitude ? true : undefined}
                aria-describedby={
                  fieldErrors.longitude ? "report-longitude-error" : undefined
                }
                onChange={(event) =>
                  updateDraft("longitude", event.target.value)
                }
                placeholder="Ej. -66.903603"
              />
              {fieldErrors.longitude ? (
                <p className="field-help field-error" id="report-longitude-error">
                  {fieldErrors.longitude}
                </p>
              ) : null}
            </label>
          </div>
          <p className="field-help location-help" aria-live="polite">
            {locationHelpMessage}
          </p>
          <div className={cn("location-picker", selectingLocation && "active")}>
            <DamageMapClient
              selecting={selectingLocation}
              selectedPosition={selectedPosition}
              onSelect={selectLocation}
            />
          </div>
          <fieldset>
            <legend>Fotos del daño *</legend>
            <input
              id="report-photo-library"
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => addImages(event.target.files)}
            />
            <input
              id="report-photo-camera"
              ref={cameraInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => addImages(event.target.files)}
            />
            <label
              className={cn(
                "photo-upload",
                (processing || images.length >= 5) && "disabled"
              )}
              htmlFor={
                processing || images.length >= 5
                  ? undefined
                  : "report-photo-library"
              }
            >
              <Images aria-hidden="true" />
              <span>
                <strong>
                  {processing
                    ? "Preparando fotos…"
                    : images.length
                      ? "Agregar más fotos"
                      : "Seleccionar fotos"}
                </strong>
                <small>Elige una o varias imágenes de tu teléfono</small>
              </span>
            </label>
            <div className="photo-upload-actions">
              <Button
                type="button"
                variant="outline"
                disabled={processing || images.length >= 5}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera data-icon="inline-start" />
                Tomar una foto
              </Button>
              <small aria-live="polite">
                {images.length}/5 fotos · máximo 20 MB por foto
              </small>
            </div>
            {images.length ? (
              <div className="image-preview-grid">
                {images.map((image) => (
                  <div key={image.id}>
                    {/* Blob URLs cannot use the Next image optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.previewUrl} alt="Vista previa del daño" />
                    <button
                      type="button"
                      aria-label="Eliminar imagen"
                      onClick={() => removeImage(image.id)}
                    >
                      <Trash2 />
                    </button>
                    <span>{Math.round(image.file.size / 1024)} KB</span>
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>
          <fieldset>
            <legend>Tipo de daño *</legend>
            <div className="severity-options">
              {damageTypes.map((type) => (
                <button
                  className={cn(draft.damageType === type && "selected")}
                  type="button"
                  key={type}
                  aria-invalid={fieldErrors.damageType ? true : undefined}
                  onClick={() => updateDraft("damageType", type)}
                >
                  {damageLabels[type]}
                </button>
              ))}
            </div>
            {fieldErrors.damageType ? (
              <p className="field-help field-error">{fieldErrors.damageType}</p>
            ) : null}
          </fieldset>
          <label
            className={cn("help-needed-field", draft.needsHelp && "selected")}
          >
            <input
              type="checkbox"
              checked={draft.needsHelp}
              onChange={(event) =>
                updateDraft("needsHelp", event.target.checked)
              }
            />
            <span className="help-needed-icon">
              <ShieldAlert aria-hidden="true" />
            </span>
            <span>
              <strong>Se necesita ayuda</strong>
              <small>
                Selecciona esta opción solo en una emergencia: personas
                atrapadas bajo escombros, heridos o una situación que requiera
                rescatistas o equipos de voluntarios.
              </small>
            </span>
          </label>
          <label>
            <span>Descripción *</span>
            <Textarea
              value={draft.description}
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-describedby={
                fieldErrors.description ? "report-description-error" : undefined
              }
              onChange={(event) =>
                updateDraft("description", event.target.value)
              }
              rows={4}
              placeholder="Describe los daños visibles y cualquier riesgo inmediato."
            />
            {fieldErrors.description ? (
              <p className="field-help field-error" id="report-description-error">
                {fieldErrors.description}
              </p>
            ) : null}
          </label>
          <div>
            <strong>Contacto público (opcional)</strong>
            <p className="field-help">
              Estos datos aparecerán en el reporte para que otras personas
              puedan contactarte.
            </p>
          </div>
          <div className="contact-grid">
            <Input
              value={draft.contactName}
              aria-invalid={fieldErrors.contactName ? true : undefined}
              aria-describedby={
                fieldErrors.contactName ? "report-contactName-error" : undefined
              }
              onChange={(event) =>
                updateDraft("contactName", event.target.value)
              }
              placeholder="Nombre"
            />
            {fieldErrors.contactName ? (
              <p className="field-help field-error" id="report-contactName-error">
                {fieldErrors.contactName}
              </p>
            ) : null}
            <PhoneInput
              className={cn(
                "contact-phone",
                fieldErrors.contactPhone && "contact-phone-error"
              )}
              value={
                (draft.contactPhone || undefined) as
                  | PhoneNumberValue
                  | undefined
              }
              onChange={(value) =>
                updateDraft("contactPhone", value?.toString() ?? "")
              }
              defaultCountry="VE"
              countries={contactPhoneCountries}
              labels={phoneInputLabels}
              international
              countryCallingCodeEditable={false}
              limitMaxLength
              autoComplete="tel"
              aria-invalid={fieldErrors.contactPhone ? true : undefined}
              aria-describedby={
                fieldErrors.contactPhone ? "report-contactPhone-error" : undefined
              }
              placeholder="Teléfono o WhatsApp"
            />
            {fieldErrors.contactPhone ? (
              <p className="field-help field-error" id="report-contactPhone-error">
                {fieldErrors.contactPhone}
              </p>
            ) : null}
            <Input
              className="contact-email"
              value={draft.contactEmail}
              aria-invalid={fieldErrors.contactEmail ? true : undefined}
              aria-describedby={
                fieldErrors.contactEmail ? "report-contactEmail-error" : undefined
              }
              onChange={(event) =>
                updateDraft("contactEmail", event.target.value)
              }
              placeholder="Correo electrónico"
              type="email"
            />
            {fieldErrors.contactEmail ? (
              <p
                className="field-help field-error contact-email"
                id="report-contactEmail-error"
              >
                {fieldErrors.contactEmail}
              </p>
            ) : null}
          </div>
          <label className="consent-field">
            <input
              type="checkbox"
              checked={draft.contactConsent}
              aria-invalid={fieldErrors.contactConsent ? true : undefined}
              aria-describedby={
                fieldErrors.contactConsent ? "report-contactConsent-error" : undefined
              }
              onChange={(event) =>
                updateDraft("contactConsent", event.target.checked)
              }
            />
            <span>
              Autorizo la publicación de los datos de contacto que proporcioné.
            </span>
          </label>
          {fieldErrors.contactConsent ? (
            <p className="field-help field-error" id="report-contactConsent-error">
              {fieldErrors.contactConsent}
            </p>
          ) : null}
          {open ? (
            <TurnstileWidget onToken={setToken} resetKey={turnstileReset} />
          ) : null}
          {fieldErrors.turnstileToken ? (
            <p className="field-help field-error">{fieldErrors.turnstileToken}</p>
          ) : null}
          {error ? <p className="form-message form-error">{error}</p> : null}
          {success ? (
            <p className="form-message form-success">{success}</p>
          ) : null}
        </div>
        <DialogFooter className="report-dialog-footer !px-10">
          <p>
            El reporte se publicará inmediatamente después de validarse. Por
            favor asegúrate de haber agregado la información correcta al momento
            de hacer el reporte.
          </p>
          <div className="form-actions">
            <DialogClose render={<Button variant="outline" />}>
              Cerrar
            </DialogClose>
            <Button
              onClick={submitReport}
              disabled={submitting || processing || !turnstileToken}
            >
              {submitting ? "Publicando…" : "Enviar reporte →"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
