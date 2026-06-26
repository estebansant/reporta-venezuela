"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

export function TurnstileWidget({
  onToken,
  resetKey,
}: {
  onToken: (token: string) => void;
  resetKey: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [siteKey, setSiteKey] = useState(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  );
  const markLoaded = () => setLoaded(true);

  useEffect(() => {
    if (siteKey) return;
    let active = true;
    fetch("/api/config")
      .then((response) => response.json())
      .then((config: { turnstileSiteKey?: string }) => {
        if (active && config.turnstileSiteKey) setSiteKey(config.turnstileSiteKey);
      })
      .catch(() => {
        if (active) setSiteKey("1x00000000000000000000AA");
      });
    return () => {
      active = false;
    };
  }, [siteKey]);

  useEffect(() => {
    if (!loaded || !siteKey || !containerRef.current || !window.turnstile) return;
    if (widgetRef.current) window.turnstile.remove(widgetRef.current);
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
      "refresh-expired": "auto",
      theme: "light",
    });
    const currentWidget = widgetRef.current;
    return () => {
      if (currentWidget && window.turnstile) {
        window.turnstile.remove(currentWidget);
      }
      widgetRef.current = null;
    };
  }, [loaded, onToken, resetKey, siteKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={markLoaded}
        onReady={markLoaded}
      />
      <div ref={containerRef} className="turnstile-container" />
    </>
  );
}
