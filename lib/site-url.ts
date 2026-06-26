const defaultSiteUrl = "https://reportavenezuela.org";

export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    defaultSiteUrl
  ).replace(/\/$/, "");
}

