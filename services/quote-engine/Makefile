# Developer shortcuts. Usage: `make <target>`
#
# Notes:
#   - `PORT` defaults to 8080 (matches Docker/Fly).
#   - The `docker-*` targets assume you're at the service root.
#   - `fly-deploy` requires `flyctl auth login` + `FLY_API_TOKEN` in env.

PY         ?= python
PIP        ?= pip
APP         = app.main:app
PORT       ?= 8080
IMAGE       = q3dq-engine
INTERNAL_KEY ?= dev-shared-secret-change-me

.PHONY: help install dev test lint typecheck format docker-build docker-run smoke fly-deploy clean

help:
	@echo "Targets:"
	@echo "  install       Install runtime + dev deps into the current env"
	@echo "  dev           Run uvicorn with reload on :$(PORT)"
	@echo "  test          Run pytest with coverage"
	@echo "  lint          Run ruff"
	@echo "  typecheck     Run mypy"
	@echo "  format        Apply ruff formatter + lint fixes"
	@echo "  docker-build  Build the prod image"
	@echo "  docker-run    Run the prod image on :$(PORT)"
	@echo "  smoke         Hit /health and /price on \$$PORT with curl"
	@echo "  fly-deploy    Deploy via flyctl"
	@echo "  clean         Remove caches + build artefacts"

install:
	$(PIP) install -r requirements-dev.txt

dev:
	INTERNAL_KEY=$(INTERNAL_KEY) \
	uvicorn $(APP) --host 0.0.0.0 --port $(PORT) --reload

test:
	pytest --cov=app --cov-report=term-missing

lint:
	ruff check app tests

typecheck:
	mypy app

format:
	ruff check --fix app tests
	ruff format app tests

docker-build:
	docker build -t $(IMAGE):local .

docker-run:
	docker run --rm -p $(PORT):8080 \
		-e INTERNAL_KEY=$(INTERNAL_KEY) \
		-e R2_BUCKET=meshes-dev \
		-e LOG_LEVEL=info \
		$(IMAGE):local

smoke:
	PORT=$(PORT) INTERNAL_KEY=$(INTERNAL_KEY) bash scripts/smoke.sh

fly-deploy:
	flyctl deploy --remote-only --config fly.toml

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +
