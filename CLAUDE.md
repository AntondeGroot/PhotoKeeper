# Working in this repo

Things that are not obvious from the code, and that cost time when discovered by trial and
error. Keep this short — it is read at the start of every session.

## Running it

Two processes, and they are not interchangeable:

- **Frontend:** `cd frontend && npm start` → **http://localhost:6200** (not 4200). This is the
  app. `adobe.frontend-url` in `application.properties` points here, so Adobe's login redirect
  lands here.
- **Backend:** `cd backend && mvn spring-boot:run` → `https://localhost:8080` (TLS, self-signed).
  The port is fixed: the Adobe redirect URI is registered against it, so it cannot simply be moved
  if something else is holding 8080.

**The backend does not hot-reload.** There is no spring-boot-devtools on the classpath, so a
running server keeps serving the code it started with — recompiling changes nothing until you
restart it. A whole debugging round was once spent reasoning about a backend that had been running
since the previous day. When backend behaviour does not match the source, check the process start
time before checking the code.

`https://localhost:8080/` also serves a _built_ copy of the frontend, left there by `deploy.sh`.
It is usually stale and its `<base href="/photokeeper/">` does not resolve locally, so its assets 500. Use 6200; treat anything served from 8080 as an artefact, not the app.

The developer detection lab is at **http://localhost:6200/?lab**, and needs a live Lightroom
session — it renders only when authenticated.

## Tests and gates

- **Run frontend tests from `frontend/`.** Several specs (pano fixtures, the celebration catalog)
  resolve paths relative to the working directory, so running them from anywhere else fails about
  seven of them for reasons that have nothing to do with the change under test.
- `ng test` is the entry point; invoking `vitest` directly fails with `describe is not defined`,
  because the Angular builder supplies the environment.
- Both sides have pre-commit hooks. Backend formatting is enforced by spotless — `mvn spotless:apply`
  fixes it. Frontend runs prettier + `eslint --max-warnings=0` on staged files.

## Gotchas that bite silently

- **Review units are persisted** (`reviewBuffer`, `dailyFeed` in IndexedDB). Changing the shape of
  a `ReviewItem` — or of anything stored on one — needs a `STALE_AT` entry and a version bump in
  `storage/photokeeper-db.ts`. Skip it and the app keeps serving units built under the old rules
  for weeks, which looks like the change never worked.
- **What Lightroom's partner API will and will not accept** is documented in the README under
  "Lightroom write-back: what the API allows", including the probes behind each finding. Read it
  before assuming a write is possible; several obvious-looking ones are not.
