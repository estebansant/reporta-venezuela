import {
  checkRateLimit,
  getClientIp,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import {
  reportInputSchema,
  reportQuerySchema,
  type PublicReport,
} from "@/lib/report-schema";
import { getReportById, rowsToReports } from "@/lib/reports";
import { validateWebpFile } from "@/lib/webp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_SELECT = `SELECT r.*, i.id AS image_id,
  i.width AS image_width, i.height AS image_height,
  i.position AS image_position
  FROM reports r
  LEFT JOIN report_images i ON i.report_id = r.id`;

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
) {
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  if (!response.ok) return false;
  const result = (await response.json()) as TurnstileResponse;
  return result.success;
}

function errorResponse(message: string, status: number, fields?: unknown) {
  return Response.json(
    { error: message, fields },
    { status, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}

function searchParamsToQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = Object.fromEntries(
    searchParams.entries(),
  );
  const damageTypes = searchParams.getAll("damageType");
  if (damageTypes.length) query.damageType = damageTypes;
  return query;
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "reports:get",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const url = new URL(request.url);
  const parsed = reportQuerySchema.safeParse(
    searchParamsToQuery(url.searchParams),
  );
  if (!parsed.success) {
    return errorResponse("Filtros inválidos.", 400, parsed.error.flatten());
  }

  const { DB } = await getCloudflareEnv();
  const filters = [`r.status = 'published'`];
  const bindings: (string | number)[] = [];
  const query = parsed.data;

  if (query.search) {
    filters.push(
      "(r.building_name LIKE ? OR r.address LIKE ? OR r.city LIKE ?)",
    );
    const term = `%${query.search}%`;
    bindings.push(term, term, term);
  }
  if (query.state) {
    filters.push("r.state = ?");
    bindings.push(query.state);
  }
  if (query.damageType?.length) {
    filters.push(
      `r.damage_type IN (${query.damageType.map(() => "?").join(",")})`,
    );
    bindings.push(...query.damageType);
  }
  if (query.verifiedBySatellite) {
    filters.push("r.verified_by_satellite = 1");
  }
  if (
    query.north !== undefined &&
    query.south !== undefined &&
    query.east !== undefined &&
    query.west !== undefined
  ) {
    filters.push(
      "r.latitude BETWEEN ? AND ? AND r.longitude BETWEEN ? AND ?",
    );
    bindings.push(query.south, query.north, query.west, query.east);
  }

  const where = `WHERE ${filters.join(" AND ")}`;
  const offset = (query.page - 1) * query.pageSize;
  const pageIdsStatement = DB.prepare(
    `SELECT r.id FROM reports r ${where}
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, query.pageSize, offset);
  const countStatement = DB.prepare(
    `SELECT COUNT(*) AS total FROM reports r ${where}`,
  ).bind(...bindings);

  const [pageResult, countResult] = await DB.batch([
    pageIdsStatement,
    countStatement,
  ]);
  const ids = (pageResult.results as { id: string }[]).map((row) => row.id);
  const total = Number(
    (countResult.results[0] as { total?: number } | undefined)?.total ?? 0,
  );

  let reports: PublicReport[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const result = await DB.prepare(
      `${REPORT_SELECT}
       WHERE r.id IN (${placeholders})
       ORDER BY r.created_at DESC, i.position ASC`,
    )
      .bind(...ids)
      .all<Parameters<typeof rowsToReports>[0][number]>();
    reports = rowsToReports(result.results);
  }

  return Response.json(
    {
      reports,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    },
    {
      headers: jsonHeaders({
        "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      }),
    },
  );
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "reports:post",
    limit: 3,
    windowMs: 10 * 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("El formulario debe enviarse como multipart/form-data.", 415);
  }

  const formData = await request.formData();
  const parsed = reportInputSchema.safeParse({
    buildingName: formData.get("buildingName"),
    address: formData.get("address"),
    state: formData.get("state"),
    city: formData.get("city"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    damageType: formData.get("damageType"),
    needsHelp: formData.get("needsHelp") ?? "false",
    description: formData.get("description"),
    contactName: formData.get("contactName") ?? "",
    contactPhone: formData.get("contactPhone") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
    contactConsent: formData.get("contactConsent") ?? "false",
    turnstileToken: formData.get("turnstileToken"),
  });

  if (!parsed.success) {
    return errorResponse(
      "Revisa los campos del reporte.",
      400,
      parsed.error.flatten().fieldErrors,
    );
  }

  const images = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File);
  if (images.length < 1 || images.length > 5) {
    return errorResponse("Debes adjuntar entre 1 y 5 imágenes.", 400);
  }

  const env = await getCloudflareEnv();
  if (!env.TURNSTILE_SECRET) {
    return errorResponse("Turnstile no está configurado en el servidor.", 503);
  }
  const isHuman = await verifyTurnstile(
    env.TURNSTILE_SECRET,
    parsed.data.turnstileToken,
    getClientIp(request),
  );
  if (!isHuman) {
    return errorResponse("La verificación de seguridad expiró o no es válida.", 403);
  }

  const validatedImages = [];
  for (const image of images) {
    const validated = await validateWebpFile(image);
    if (!validated) {
      return errorResponse(
        "Cada imagen debe ser un WebP válido y pesar hasta 20 MB.",
        400,
      );
    }
    validatedImages.push(validated);
  }

  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  const uploadedKeys: string[] = [];

  try {
    const imageRecords = [];
    for (let position = 0; position < validatedImages.length; position += 1) {
      const image = validatedImages[position];
      const imageId = crypto.randomUUID();
      const key = `reports/${reportId}/${imageId}.webp`;
      await env.REPORT_IMAGES.put(key, image.bytes, {
        httpMetadata: {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: { reportId, imageId },
      });
      uploadedKeys.push(key);
      imageRecords.push({ imageId, key, position, ...image });
    }

    const value = parsed.data;
    const statements = [
      env.DB.prepare(
        `INSERT INTO reports (
          id, building_name, address, state, city, latitude, longitude,
          damage_type, needs_help, description, contact_name, contact_phone,
          contact_email, contact_consent, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`,
      ).bind(
        reportId,
        value.buildingName,
        value.address,
        value.state,
        value.city,
        value.latitude,
        value.longitude,
        value.damageType,
        value.needsHelp ? 1 : 0,
        value.description,
        value.contactName || null,
        value.contactPhone || null,
        value.contactEmail || null,
        value.contactConsent ? 1 : 0,
        now,
        now,
      ),
      ...imageRecords.map((image) =>
        env.DB.prepare(
          `INSERT INTO report_images (
            id, report_id, r2_key, mime_type, size_bytes,
            width, height, position, created_at
          ) VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?)`,
        ).bind(
          image.imageId,
          reportId,
          image.key,
          image.bytes.byteLength,
          image.width,
          image.height,
          image.position,
          now,
        ),
      ),
    ];
    await env.DB.batch(statements);
    const report = await getReportById(env.DB, reportId);
    return Response.json(
      { report },
      { status: 201, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  } catch (error) {
    if (uploadedKeys.length) {
      await env.REPORT_IMAGES.delete(uploadedKeys);
    }
    console.error("Unable to create report", error);
    return errorResponse("No fue posible guardar el reporte. Inténtalo de nuevo.", 500);
  }
}
