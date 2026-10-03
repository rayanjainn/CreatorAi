# CreatorAi: local-first dev commands. Run `make help` for the list.
SHELL := /bin/bash
VENV := backend/.venv
PY := $(VENV)/bin/python
HAS_WEB := $(wildcard frontend/package.json)

.DEFAULT_GOAL := help
.PHONY: help setup dev seed migrate test lint reset clean gen-api

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

setup: ## Create the venv, install deps, copy .env, run migrations
	python3 -m venv $(VENV)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -e "backend[dev]"
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm ci; else echo "frontend/ not present yet, skipping npm ci"; fi
	@[ -f .env ] || cp .env.example .env
	$(PY) backend/scripts/migrate.py
	@echo "Setup done. Run: make dev"

dev: ## Start API (:8000) and web (:3000) together
	$(PY) scripts/dev.py

seed: ## Load the demo user, profile, board and hero project
	@if [ -f backend/scripts/seed_demo.py ]; then cd backend && .venv/bin/python scripts/seed_demo.py; \
	else echo "backend/scripts/seed_demo.py not found yet"; exit 1; fi

migrate: ## Apply pending SQL migrations
	$(PY) backend/scripts/migrate.py

test: ## Backend pytest (+ frontend typecheck, lint and tests when present)
	cd backend && .venv/bin/python -m pytest
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run typecheck && npm run lint && npm test --if-present; fi

lint: ## ruff check + format check (+ frontend lint)
	cd backend && .venv/bin/ruff check --config pyproject.toml . ../scripts && .venv/bin/ruff format --config pyproject.toml --check . ../scripts
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run lint; fi

reset: ## Wipe the local database and media (keeps data/.secret), then re-migrate
	rm -rf data/creatorai.db data/creatorai.db-wal data/creatorai.db-shm data/media data/renders data/tmp
	$(PY) backend/scripts/migrate.py

clean: ## Remove caches and build output
	find . -name __pycache__ -type d -not -path "*/node_modules/*" -not -path "*/.venv/*" -prune -exec rm -rf {} +
	rm -rf backend/.pytest_cache backend/.ruff_cache frontend/.next

gen-api: ## Dump OpenAPI and regenerate the frontend types
	$(PY) backend/scripts/dump_openapi.py frontend/openapi.json
	@if [ -n "$(HAS_WEB)" ]; then cd frontend && npm run gen:api; fi
