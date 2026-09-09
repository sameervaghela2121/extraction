import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { initSentry } from "./sentry";
import { router } from "./router";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import "./styles/global.css";

// Before anything else runs: an error thrown while the providers mount is exactly the kind
// worth catching, and Sentry can only report what happens after it is initialised.
initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* A crash in render leaves a white page and no clue. This reports it and says so. */}
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 32, maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something broke on this page</h1>
          <p className="muted" style={{ marginBottom: 20 }}>
            The problem has been reported. Reloading usually gets you moving again.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      }
    >
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
