# Cloud Run Deployment Design

## Context

Three independent applications in this repo need to deploy to Google Cloud Run (project
`sameerv`) whenever main is updated, via GitHub Actions:

- `frontend/` — Vite/React static app
- `backend/` — Node/Express API
- `invoice-generator-backend/` — Python/FastAPI extraction service ("AI backend")

Repo: https://github.com/sameervaghela2121/extraction

## Decisions

1. **GCP auth for GitHub Actions**: a GCP service account JSON key, stored as the GitHub
   Actions secret `GCP_SA_KEY`. (Workload Identity Federation was offered as the more
   secure, keyless alternative; a long-lived key was chosen for simplicity.)
2. **Trigger scope**: one workflow, three path-filtered jobs — a push to main only
   rebuilds/redeploys the service(s) whose directory actually changed.
3. **Cross-service URLs**: no custom domains. Each job looks up the *current* live
   `*.run.app` URL of the service(s) it depends on via `gcloud run services describe`
   immediately before its own build/deploy, rather than hard-`needs:`-chaining on
   whether that other job ran this trigger. This means a frontend-only change deploys
   just the frontend, using whatever backend URL already exists.
4. **Secret values**: Secret Manager entries are seeded from the values already in
   `backend/.env` and `invoice-generator-backend/api/.env` on this machine (same
   MongoDB Atlas cluster, same Gemini key, etc. as local dev). Can be rotated later
   independently of the workflow.
5. **AI backend access**: deployed with `--allow-unauthenticated`. It's only ever
   called server-to-server by the Node backend today, but is reachable by anyone with
   the URL — gated only by its own internal `/login` token system, not GCP IAM. (Restricting
   it to the backend's service account via Cloud Run IAM invoker was offered as the more
   locked-down alternative.)

## Architecture

```
GitHub push to main
  -> GitHub Actions workflow (path-filtered jobs)
       -> deploy-ai-backend (if invoice-generator-backend/** changed)
            build -> push to Artifact Registry -> gcloud run deploy (--allow-unauthenticated)
       -> deploy-backend (if backend/** changed)
            look up ai-backend's current URL -> build -> push -> gcloud run deploy
            (env: INVOICE_GENERATOR_BASE_URL=<ai-backend url>, secrets from Secret Manager)
       -> deploy-frontend (if frontend/** changed)
            look up backend's current URL -> vite build with VITE_API_BASE_URL=<url>/api
            -> build -> push -> gcloud run deploy (--allow-unauthenticated)
       -> update-cors (after deploy-frontend, if it ran)
            gcloud run services update backend --update-env-vars FRONTEND_ORIGIN=<frontend url>
```

## GCP resources (one-time provisioning)

- Region: `asia-south1` (matches the existing `sameerv-docflow-invoices` bucket).
- Artifact Registry Docker repo: `asia-south1-docker.pkg.dev/sameerv/extraction/*`
- Cloud Run services: `docflow-frontend`, `docflow-backend`, `docflow-ai-backend`
- Service accounts:
  - `deployer@sameerv.iam.gserviceaccount.com` — used by GitHub Actions. Roles:
    `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`.
  - `backend-runtime@sameerv.iam.gserviceaccount.com` — runs `docflow-backend`. Gets
    `roles/secretmanager.secretAccessor` scoped to its own secrets.
  - `ai-backend-runtime@sameerv.iam.gserviceaccount.com` — runs `docflow-ai-backend`.
    Gets `roles/secretmanager.secretAccessor` scoped to its own secrets, plus the
    existing GCS bucket IAM binding for `sameerv-docflow-invoices`.
  - `docflow-frontend` runs as the Cloud Run default compute service account — it's a
    static file server with no secrets to access.

## Secret Manager

- Backend: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SMTP_USER`,
  `SMTP_PASSWORD`, `INVOICE_GENERATOR_APP_USER`, `INVOICE_GENERATOR_APP_PASSWORD`
- AI backend: `GEMINI_API_KEY`, `MONGODB_URI`, plus its own copies of the login
  credentials it needs to validate against (`APP_USER`/`APP_PASSWORD` env vars) —
  duplicated as separate `ai-backend-app-user`/`ai-backend-app-password` secrets
  rather than widening access to the backend's `backend-invoice-generator-app-*`
  secrets, so each service's IAM stays scoped to secrets it actually owns.
- Everything else (`NODE_ENV`, collection names, JWT expiry strings, `SMTP_HOST`/`PORT`,
  `GCS_BUCKET`) stays as plain Cloud Run env vars, not secrets.

## Containers

Each app gets its own multi-stage `Dockerfile` (build stage → slim runtime stage):
- `frontend/Dockerfile` — `npm run build` in a Node build stage, then serve `dist/`
  with `nginx` (buildpacks don't have a clean story for static output, so hand-written
  Dockerfiles were chosen over `gcloud run deploy --source` for all three, for
  consistency).
- `backend/Dockerfile` — `npm run build` (tsc), then `node dist/server.js` in a slim
  Node runtime image.
- `invoice-generator-backend/Dockerfile` — Python slim base, installs
  `api/requirements.txt`, runs `python api/main.py` (already reads `$PORT`).

## Error handling / rollback

Cloud Run only routes traffic to a new revision once it passes its startup health
check, so a broken deploy doesn't take down the previously-working revision. Each
GitHub Actions job fails loudly (non-zero exit) on any build/push/deploy error. Manual
rollback, if ever needed, is `gcloud run services update-traffic <service>
--to-revisions=<old-revision>=100`. No automated staged-rollout/rollback tooling is
being built — out of scope for what was asked.

## Verification

1. Bootstrap: manually build+push+deploy all three services once via `gcloud`, so real
   `*.run.app` URLs exist before the workflow ever runs.
2. Confirm the frontend loads and can log in (round-trips through the backend).
3. Confirm a document upload round-trips through the AI backend and GCS.
4. Push a trivial change under each of the three directories independently; confirm
   only the matching job runs each time.
