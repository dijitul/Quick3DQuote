# quote-engine

Python 3.11 + FastAPI + trimesh. The authoritative pricing and mesh-analysis
service for Quick3DQuote. Called only by the Next.js app over a private
Fly.io network with a shared-secret `X-Internal-Key` header.

See `docs/architecture.md` §3.2 for the service contract, `docs/api-design.md`
§4 for the wire format, and `CLAUDE.md` §5 for the pricing formula this
implements.

---

## Endpoints

| Method | Path            | Auth                 | Purpose                                        |
|--------|-----------------|----------------------|------------------------------------------------|
| GET    | `/health`       | none                 | Liveness. Returns `{"ok": true, "version": …}` |
| POST   | `/analyze-mesh` | `X-Internal-Key`     | Download mesh from R2, return measurements     |
| POST   | `/price`        | `X-Internal-Key`     | Pure: compute the breakdown from inputs        |

Responses are JSON; errors are `application/problem+json`. Money is encoded
as a JSON string (not a float) to prevent precision loss on the TS side.

---

## Run locally

```bash
cd services/quote-engine
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements-dev.txt

export INTERNAL_KEY=dev-shared-secret-change-me
uvicorn app.main:app --reload --port 8080
# or: make dev
```

Hit it:

```bash
curl -s http://localhost:8080/health | jq
```

For `/analyze-mesh` you need working R2 creds (`R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). For `/price`
nothing else is required — it's pure.

Full smoke:

```bash
INTERNAL_KEY=dev-shared-secret-change-me bash scripts/smoke.sh
```

---

## Tests

```bash
make test
# equivalent to: pytest --cov=app --cov-report=term-missing
```

Target: **>95%** coverage on `app/pricing.py` and `app/auth.py`; **>85%**
overall. Tests run fully offline — R2 is stubbed in `tests/conftest.py::fake_r2`.
The 10 mm cube STL fixture is auto-generated on first run via trimesh so
we don't need to check in binary blobs.

---

## Lint & typecheck

```bash
make lint        # ruff check
make typecheck   # mypy --strict on app/
make format      # ruff format + --fix
```

Both run in CI (`.github/workflows/ci.yml :: engine`). PRs that fail either
don't merge.

---

## Environment variables

See `app/config.py::Settings` for the full list. Critical ones:

| Var                        | Required | Default          | Notes                                          |
|----------------------------|----------|------------------|------------------------------------------------|
| `INTERNAL_KEY`             | **yes**  | —                | Shared secret with the Next.js app.            |
| `R2_ACCOUNT_ID`            | yes      | —                | Cloudflare account. Derives the R2 endpoint.   |
| `R2_ACCESS_KEY_ID`         | yes      | —                | R2 API token id.                               |
| `R2_SECRET_ACCESS_KEY`     | yes      | —                | R2 API token secret.                           |
| `R2_BUCKET`                | yes      | `meshes-dev`     | Bucket for mesh objects.                       |
| `SENTRY_DSN`               | no       | —                | Omit to disable Sentry entirely.               |
| `MAX_MESH_SIZE_MB`         | no       | `100`            | HEAD-check cap before download.                |
| `MAX_TRIANGLES`            | no       | `10000000`       | Parse-time cap.                                |
| `ANALYSIS_TIMEOUT_SECONDS` | no       | `15`             | Wall-clock cap around trimesh load + measure.  |
| `ALLOWED_ORIGINS`          | no       | prod web origins | Comma-separated CORS allowlist.                |

Secrets never go in `fly.toml`. Use `fly secrets set`.

---

## Deploy

The GitHub Action `.github/workflows/deploy-engine.yml` deploys to Fly on
pushes to `main` that touch `services/quote-engine/**`. Manual deploy:

```bash
flyctl deploy --remote-only --config fly.toml
```

First-time:

```bash
fly apps create q3dq-engine
fly secrets set \
  INTERNAL_KEY=... \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET=meshes-prod \
  SENTRY_DSN=https://... \
  -a q3dq-engine
fly deploy
```

---

## Failure-mode cheat sheet

| Symptom                             | Likely cause                                | Fix                                              |
|-------------------------------------|---------------------------------------------|--------------------------------------------------|
| Every request → 401                 | `INTERNAL_KEY` unset or mismatched          | Check Fly secret + Vercel env.                   |
| `/analyze-mesh` → 502               | R2 creds wrong or bucket typo               | `fly ssh console`, check env; try `aws` to R2.   |
| `/analyze-mesh` → 413               | File over `MAX_MESH_SIZE_MB`                | Shop-side cap should block; raise if legit.      |
| `/analyze-mesh` → 504               | Pathological mesh blew `ANALYSIS_TIMEOUT`   | Usually a 5M+ triangle STL; reject or raise cap. |
| `is_watertight: false, is_repairable: false` | Customer exported shell not solid | Widget surfaces "try exporting as solid".        |

For anything else start at `fly logs -a q3dq-engine` and correlate on
`request_id`.
