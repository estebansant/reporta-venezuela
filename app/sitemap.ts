import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();

const routes = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/emergencias", changeFrequency: "weekly", priority: 0.9 },
  {
    path: "/personas-desaparecidas",
    changeFrequency: "daily",
    priority: 0.9,
  },
  { path: "/infografias", changeFrequency: "monthly", priority: 0.7 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date("2026-06-25"),
    changeFrequency,
    priority,
  }));
}
