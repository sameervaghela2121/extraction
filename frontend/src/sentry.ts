import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import * as Sentry from "@sentry/react";

/**
 * Error and performance reporting.
 *
 * The DSN comes from an env var rather than being hardcoded. Vite bakes VITE_* values into
 * the bundle at build time (see Dockerfile), so this is supplied as a --build-arg the same
 * way VITE_API_BASE_URL is. With no DSN nothing initialises at all — a developer running
 * the app locally does not post their stack traces into the production project, and every
 * Sentry call elsewhere stays a safe no-op.
 */

const dsn = import.meta.env.VITE_SENTRY_DSN;
const isProduction = import.meta.env.PROD;

/**
 * Where distributed tracing headers may be attached. Derived from the API base rather than
 * hardcoded: it is "/api" behind the dev proxy and the Cloud Run backend's URL in a built
 * image, and sending trace headers to any other origin would leak them to third parties.
 */
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";
const apiTarget = apiBaseUrl.startsWith("http") ? new URL(apiBaseUrl).origin : /^\//;

export function initSentry(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,

    integrations: [
      // The data-router variant: without it every document id becomes its own transaction
      // name, so "/documents/68b3f1…" never groups with "/documents/68b3f2…" and the
      // performance data is unreadable. This reports them as "/documents/:id".
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      // This portal renders invoices — GST numbers, seller and buyer names, amounts — plus
      // the signed-in user's own name and email. A replay is a DOM recording, so all three
      // masks stay on: text and inputs are replaced with blocks, and media (invoice page
      // previews, roll photos) is not recorded at all.
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],

    // Sampled down in production: 100% tracing bills for every navigation on a panel that
    // is used all day. Full rate in development, where the volume is a handful of page
    // loads and seeing them all is the point.
    tracesSampleRate: isProduction ? 0.2 : 1.0,
    tracePropagationTargets: ["localhost", apiTarget],

    // Sessions are sampled thinly; sessions that actually hit an error are always kept,
    // which is the recording anyone ever goes looking for. Off entirely in development.
    replaysSessionSampleRate: isProduction ? 0.05 : 0,
    replaysOnErrorSampleRate: isProduction ? 1.0 : 0,

    // No IP addresses or request bodies attached automatically. What identifies a user is
    // set deliberately in setSentryUser below instead.
    sendDefaultPii: false,
  });
}

/**
 * Who is signed in, for the error report.
 *
 * Deliberately not the email: this is an internal panel with a handful of accounts, so the
 * user id and role are enough to find the person, and there is no reason to ship an address
 * to a third party to do it.
 */
export function setSentryUser(user: { userId: string; role: string } | null): void {
  if (!dsn) return;
  Sentry.setUser(user ? { id: user.userId, role: user.role } : null);
}
