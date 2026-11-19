"use client";
import { useEffect } from "react";
import { setAdapter } from "@/lib/engleski-simulator/analytics";
import { createClient } from "@/lib/supabase/client";

// Keep these route categories and event kinds in sync with record_operational_event.
const operationalRoutes = new Set([
  "dashboard", "discere", "skripte", "plan-ucenja", "prijemni", "kalkulator",
  "termini", "ai-profesor", "roditelji", "admin",
]);
const errorBuckets = new Map();
let documentMeasured = false;

function routeCategory(pathname) {
  if (pathname === "/") return "home";
  const segment = pathname.split("/")[1];
  return operationalRoutes.has(segment) ? segment : "other";
}

function scheduleOperationalEvent(route, kind, timeMs) {
  async function send() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getSession();
      const user = data?.session?.user;
      if (error || !user || user.is_anonymous === true) return;
      await supabase.rpc("record_operational_event", {
        route_name: route,
        event_kind: kind,
        time_ms: timeMs,
      });
    } catch {
      // Operational telemetry never interrupts the page or retries.
    }
  }

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => { void send(); }, { timeout: 2000 });
  } else {
    window.setTimeout(() => { void send(); }, 0);
  }
}

function captureDocumentLoad() {
  if (documentMeasured) return;
  const navigation = window.performance?.getEntriesByType?.("navigation")?.[0];
  if (!navigation || navigation.loadEventEnd <= 0) return;
  const timeMs = Math.round(navigation.loadEventEnd - navigation.startTime);
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > 120000) return;

  let route;
  try {
    route = routeCategory(new URL(navigation.name).pathname);
  } catch {
    return;
  }
  documentMeasured = true;
  scheduleOperationalEvent(route, "document_load", timeMs);
}

function captureOperationalError(kind) {
  const route = routeCategory(window.location.pathname);
  const key = `${route}:${kind}`;
  const bucket = Math.floor(Date.now() / 60000);
  if (errorBuckets.get(key) === bucket) return;
  errorBuckets.set(key, bucket);
  scheduleOperationalEvent(route, kind, null);
}

/**
 * Wires the analytics module to the real tracking back-end.
 *
 * Priority order:
 *   1. window.gtag  — Google Analytics (GA4) if NEXT_PUBLIC_GA_MEASUREMENT_ID is set
 *   2. window.plausible — Plausible Analytics if the script is loaded
 *
 * Add script tags for your chosen provider in app/layout.jsx <head>.
 * This component only wires the adapter; it never loads external scripts itself.
 */
export default function AnalyticsInitializer() {
  useEffect(() => {
    // GA4 via gtag.js
    if (
      typeof window.gtag === "function" &&
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    ) {
      setAdapter((name, props) => {
        window.gtag("event", name, props);
      });
      return;
    }

    // Plausible — fires a custom event
    if (typeof window.plausible === "function") {
      setAdapter((name, props) => {
        window.plausible(name, { props });
      });
      return;
    }

    // No provider loaded — adapter stays null (console.debug in dev, silent in prod)
  }, []);

  useEffect(() => {
    let loadTimer;
    function afterLoad() {
      // The timing entry gets its loadEventEnd after all load listeners finish.
      loadTimer = window.setTimeout(captureDocumentLoad, 0);
    }
    function onError(event) {
      const target = event.target;
      if (target instanceof Element && target.matches("img, audio, video, picture source, audio source, video source")) {
        captureOperationalError("media_error");
      } else if (target === window && event instanceof ErrorEvent) {
        captureOperationalError("client_error");
      }
    }
    function onUnhandledRejection() {
      captureOperationalError("client_error");
    }

    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.clearTimeout(loadTimer);
      window.removeEventListener("load", afterLoad);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
