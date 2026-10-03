# CreatorAi: local-first dev commands. Run `make help` for the list.
SHELL := /bin/bash
PYTHON ?= python3
VENV := backend/.venv
PY := $(VENV)/bin/python
HAS_WEB := $(wildcard frontend/package.json)

.DEFAULT_GOAL := help
.PHONY: help docs-check doctor setup models models-asr dev seed demo-media migrate test lint reset reset-password clean gen-api e2e

help: ## Show this help
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-15s %s\n", $$1, $$2}'
	@echo ""
	@echo "  First time:  make setup && make seed && make dev   (then open http://localhost:3000)"
	@echo "  Ports:       make dev API_PORT=8010 WEB_PORT=3010   (CORS is adjusted automatically)"

doctor: ## Check prerequisites (Python 3.11+, Node 20+, ffmpeg (libass optional), ports, network)
	@$(PYTHON) scripts/doctor.py

setup: ## One-time (re-runnable): doctor, venv, deps, .env, migrations, model download
	@$(PYTHON) scripts/doctor.py
	$(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -e "backend[dev]"
	@# Repair venvs created before the scenedetect pin: a stray full opencv-python 5 hides the Haar face detector.
	@$(PY) -c "import cv2,sys; sys.exit(0 if hasattr(cv2,'CascadeClassifier') else 1)" || { echo "Repairing the OpenCV install (need 4.x headless)"; $(PY) -m pip uninstall -y -q opencv-python opencv-python-headless; $(PY) -m pip install -q "opencv-python-headless>=4.9,<5"; }
	@if [ -n "$(HAS_WEB)" ]; then \
	  if [ frontend/node_modules/.package-lock.json -nt frontend/package-lock.json ]; then echo "frontend dependencies up to date"; \
	  else (cd frontend && npm ci --no-audit --no-fund); fi; \
	else echo "frontend/ not present, skipping npm ci"; fi
	@[ -f .env ] || cp .env.example .env
	$(PY) backend/scripts/migrate.py
	@$(PY) backend/scripts/download_models.py || echo "WARNING: model download failed (offline?). Embeddings use a labelled heuristic fallback until you run 'make models' while online."
	@echo ""
	@echo "Setup done. Next: make seed (demo data), then make dev, then open http://localhost:3000"
	@echo "AI features need one free key in .env (GEMINI_API_KEY, GROQ_API_KEY or OLLAMA_API_KEY); without it they report 'not configured'."

models: ## Download the embedding model (needs internet once)
	$(PY) backend/scripts/download_models.py

models-asr: ## Download embedding + faster-whisper models (needs internet once)
	$(PY) backend/scripts/download_models.py --asr

dev: ## Start API (:8000) and web (:3000) together (override: API_PORT=, WEB_PORT=)
	$(PY) scripts/dev.py

seed: ## Load demo data: demo user, board, analytics, hero project (ARGS="--reset --render")
	cd backend && .venv/bin/python scripts/seed_demo.py $(ARGS)

demo-media: ## Generate synthetic DEMO footage + words.json sidecar in data/demo (needs ffmpeg)
	$(PY) backend/scripts/make_demo_media.py --out data/demo

migrate: ## Apply pending SQL migrations
	$(PY) backend/scripts/migrate.py

test: ## Backend pytest (+ frontend typecheck, lint and unit tests)
	cd backend && .venv/bin/python -m pytest
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run typecheck && npm run lint && npm test --if-present; fi

lint: ## ruff check + format check (+ frontend eslint)
	cd backend && .venv/bin/ruff check --config pyproject.toml . ../scripts && .venv/bin/ruff format --config pyproject.toml --check . ../scripts
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run lint; fi

docs-check: ## Check relative links and anchors in all Markdown files
	@$(PYTHON) scripts/check_links.py

e2e: ## Playwright end-to-end tests on a throwaway seeded data dir (API :8100, web :3100)
	$(PY) scripts/e2e.py $(ARGS)

reset: ## Wipe the local database and media (keeps data/.secret), then re-migrate
	rm -rf data/creatorai.db data/creatorai.db-wal data/creatorai.db-shm data/media data/renders data/tmp
	$(PY) backend/scripts/migrate.py

reset-password: ## Set the account password (prompts; ARGS="--email you@x.com --password ...")
	cd backend && .venv/bin/python scripts/reset_password.py $(ARGS)

gen-api: ## Dump OpenAPI and regenerate the frontend types (frontend/src/lib/api/schema.d.ts)
	$(PY) backend/scripts/dump_openapi.py frontend/openapi.json
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run gen:api; fi

clean: ## Remove caches and build output (keeps data/ and node_modules)
	find . -name __pycache__ -type d -not -path "*/node_modules/*" -not -path "*/.venv/*" -prune -exec rm -rf {} +
	rm -rf backend/.pytest_cache backend/.ruff_cache frontend/.next
