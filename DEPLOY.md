# GCP backend deployment

The existing VM is `pba-backend`, `34.67.138.114`, in project `freelanceprojects-511015`, zone `us-central1-f`. Access is `ssh -i ~/.ssh/id_ed25519 nika@34.67.138.114`. Do not use the locally signed-in gcloud account: it is a different Google account.

Run `npm run deploy` from this repository. It builds the API and connectors locally, deploys the **current working tree including uncommitted changes**, installs only the server workspaces' production dependencies on Linux, upgrades the known legacy schema, and starts the existing `pba-api` and `pba-connectors` services. `REVISION` records the source commit and deployment time; local changes are included, so a commit ID alone does not identify the full deployment. Services are stopped during upload/install/migration; a failed deployment needs investigation before restart. No backup or database reset is performed.

| Resource | Path |
| --- | --- |
| Current monorepo backend | `/opt/postorca` |
| API service working directory | `/opt/postorca/apps/api` |
| Connectors working directory | `/opt/postorca/apps/connectors` |
| API secret source, retained from the previous deployment | `/opt/pba/.env` |
| Connector secret source | `/opt/pba/connectors/.env` |
| API/connector environment files | Symlinks to the existing secret sources above |
| User files, unchanged | `/var/lib/pba/storage` |
| PostgreSQL database, unchanged | `pba` on localhost |
| Public API | `http://34.67.138.114/api` |

Caddy continues proxying port 80 to API port 3001. Connectors stay on loopback port 3100. The old code directory is retained as the source of the existing environment files; the services execute the new compiled entry points. Secrets are neither copied to the local repository nor included in the upload. `POSTORCA_DEPLOY_HOST` and `POSTORCA_DEPLOY_KEY` override SSH access for the script.

`deploy/legacy-baseline.sql` recognizes only the inspected legacy schema through `019_refresh_tokens.sql`. It validates migration history and required columns, registers the already-equivalent new baseline, and lets the ordinary migrations add projects, publishing, refresh-token changes, usage accounting, and billing. Existing accounts/work are retained. Unrecognized or partially upgraded legacy layouts are refused. On a new database or an already adopted one it uses normal migrations. Integration tests rebuild the legacy 019 schema and verify the upgrade, account/password/task/session preservation, and repeatability.

Build the macOS desktop for this server with:

```sh
npm run desktop:package:gcp
```

This bakes `VITE_API_URL=http://34.67.138.114/api` into the renderer and its connection policy. The ordinary `desktop:package` remains a local/default-environment build. Rebuild when changing the API address.

The inherited VM endpoint uses HTTP. HTTPS/domain setup and Google OAuth callback configuration remain separate deployment work. Stripe is test-only and checkout remains disabled until its key, price IDs, webhook secret, and an accessible HTTPS webhook destination (or test forwarding) are configured. Register webhook callbacks at `/api/billing/webhook`. Never reuse production credentials or another project's credentials implicitly.
