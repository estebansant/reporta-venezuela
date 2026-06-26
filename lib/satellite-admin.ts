/**
 * Shared guard for the satellite review endpoints. Approving a candidate
 * publishes a public pin, so these routes require a shared secret. The secret
 * is provided via the `SATELLITE_ADMIN_SECRET` binding (set with
 * `wrangler secret put`). When the secret is unset, the routes are disabled.
 */
export function isAuthorizedAdmin(
  request: Request,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const header =
    request.headers.get("x-satellite-admin-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header) return false;
  // Constant-time-ish comparison: lengths must match first.
  if (header.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < header.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}
