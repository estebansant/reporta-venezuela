# Mapa de Daños Venezuela

Aplicación Next.js 16 desplegada en Cloudflare Workers mediante OpenNext. Los
reportes se almacenan en D1 y sus imágenes WebP en R2.

## Desarrollo

1. Copia `.dev.vars.example` a `.dev.vars`.
2. Aplica la migración local con `pnpm db:migrate:local`.
3. Ejecuta `pnpm dev`.

Para probar el build dentro del runtime `workerd`, usa `pnpm preview`.

## Cloudflare

Antes de desplegar:

- Crea las bases D1 y buckets R2 de preview y producción.
- Sustituye los valores `REPLACE_WITH_*` en `wrangler.jsonc`.
- Configura `TURNSTILE_SECRET` con `wrangler secret put`.
- Configura las site keys públicas para cada ambiente.
- Ejecuta las migraciones remotas.

Despliegues:

```bash
pnpm deploy:preview
pnpm deploy
```

Las imágenes no se almacenan en D1. Las claves R2 siguen el formato
`reports/{reportId}/{imageId}.webp`.
