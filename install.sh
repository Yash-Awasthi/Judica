#!/usr/bin/env bash
# =============================================================================
# Judica — One-Command Installer
# Usage: curl -fsSL https://judica.app/install.sh | bash
#   or:  bash install.sh [--dir <path>] [--branch <branch>] [--no-build]
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/yourusername/judica.git"
INSTALL_DIR="${JUDICA_DIR:-./judica}"
BRANCH="${JUDICA_BRANCH:-main}"
BUILD=true

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}[judica]${RESET} $*"; }
success() { echo -e "${GREEN}[judica]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[judica]${RESET} $*"; }
error()   { echo -e "${RED}[judica] ERROR:${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──────────────────────────────────────────────${RESET}"; }

# ── Arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)      INSTALL_DIR="$2"; shift 2 ;;
    --branch)   BRANCH="$2"; shift 2 ;;
    --no-build) BUILD=false; shift ;;
    *)          shift ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed. See: $2"
  fi
  info "  $1 ✓"
}

require_cmd docker  "https://docs.docker.com/get-docker/"
require_cmd git     "https://git-scm.com/downloads"
require_cmd openssl "https://www.openssl.org/"

# Docker Compose v2 check
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  error "Docker Compose not found. Install: https://docs.docker.com/compose/install/"
fi
info "  docker compose ✓ ($COMPOSE)"

# Docker daemon running?
docker info &>/dev/null 2>&1 || error "Docker daemon is not running. Start Docker and try again."
info "  docker daemon ✓"

# ── Clone or update ───────────────────────────────────────────────────────────
step "Fetching Judica"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH"
  success "Updated to latest $BRANCH"
elif [[ -d "$INSTALL_DIR" ]] && [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  info "Found existing Judica directory at $INSTALL_DIR — using as-is"
else
  info "Cloning into $INSTALL_DIR..."
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  success "Cloned $REPO_URL#$BRANCH"
fi

cd "$INSTALL_DIR"

# ── .env setup ────────────────────────────────────────────────────────────────
step "Configuring environment"

if [[ -f ".env" ]]; then
  warn ".env already exists — skipping generation (delete .env to regenerate)"
else
  if [[ ! -f ".env.example" ]]; then
    error ".env.example not found — your checkout may be incomplete"
  fi

  cp .env.example .env

  # Generate required secrets
  JWT_SECRET=$(openssl rand -hex 32)
  MASTER_KEY=$(openssl rand -hex 32)
  REDIS_PASS=$(openssl rand -hex 16)
  PG_PASS=$(openssl rand -hex 16)
  GRAFANA_PASS=$(openssl rand -base64 18 | tr -d '=/')

  # Substitute placeholders in .env
  sed_inplace() {
    if sed --version 2>/dev/null | grep -q GNU; then
      sed -i "$@"
    else
      sed -i '' "$@"   # macOS BSD sed
    fi
  }

  sed_inplace "s|replace_this_with_openssl_rand_hex_32_output|${JWT_SECRET}|" .env
  sed_inplace "s|0000000000000000000000000000000000000000000000000000000000000000|${MASTER_KEY}|" .env
  sed_inplace "s|councilpass|${REDIS_PASS}|g" .env
  # Only replace the postgres password placeholder (not the user or db name)
  sed_inplace "s|POSTGRES_PASSWORD=councilpass|POSTGRES_PASSWORD=${PG_PASS}|" .env
  sed_inplace "s|change_me_strong_grafana_password|${GRAFANA_PASS}|" .env
  # Update DATABASE_URL and REDIS_URL to use generated passwords
  sed_inplace "s|postgresql://council:councilpass@|postgresql://council:${PG_PASS}@|" .env
  sed_inplace "s|redis://:councilpass@|redis://:${REDIS_PASS}@|" .env

  success ".env created with generated secrets"
  info "  JWT_SECRET          = ${JWT_SECRET:0:8}…"
  info "  MASTER_ENCRYPTION_KEY = ${MASTER_KEY:0:8}…"
  info "  REDIS_PASSWORD      = ${REDIS_PASS:0:8}…"
  info "  POSTGRES_PASSWORD   = ${PG_PASS:0:8}…"
  info "  GRAFANA_PASSWORD    = (saved in .env)"
  echo ""
  warn "IMPORTANT: Add at least one AI provider key to .env before starting:"
  warn "  ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY"
  echo ""

  # Prompt to add AI key now
  read -r -p "  Enter an API key to configure now (or press Enter to skip): " USER_KEY
  if [[ -n "$USER_KEY" ]]; then
    if [[ "$USER_KEY" == sk-ant* ]]; then
      sed_inplace "s|# ANTHROPIC_API_KEY=sk-ant-.*|ANTHROPIC_API_KEY=${USER_KEY}|" .env
      success "ANTHROPIC_API_KEY set"
    elif [[ "$USER_KEY" == sk-* ]]; then
      sed_inplace "s|# OPENAI_API_KEY=sk-proj-.*|OPENAI_API_KEY=${USER_KEY}|" .env
      success "OPENAI_API_KEY set"
    elif [[ "$USER_KEY" == sk-or-* ]]; then
      sed_inplace "s|# OPENROUTER_API_KEY=sk-or-v1-.*|OPENROUTER_API_KEY=${USER_KEY}|" .env
      success "OPENROUTER_API_KEY set"
    elif [[ "$USER_KEY" == AIza* ]]; then
      sed_inplace "s|# GOOGLE_API_KEY=AIza.*|GOOGLE_API_KEY=${USER_KEY}|" .env
      success "GOOGLE_API_KEY set"
    else
      warn "Could not detect key type — add it manually to .env"
    fi
  fi
fi

# ── Build & Start ─────────────────────────────────────────────────────────────
step "Starting services"

if [[ "$BUILD" == "true" ]]; then
  info "Building Docker image (first run takes 2–5 minutes)..."
  $COMPOSE build --quiet
  success "Build complete"
fi

info "Running database migrations..."
$COMPOSE --profile migrate run --rm migrate
success "Migrations applied"

info "Starting Judica..."
$COMPOSE up -d --remove-orphans
success "All services started"

# ── Health check ──────────────────────────────────────────────────────────────
step "Health check"

info "Waiting for app to be ready..."
TRIES=0
MAX_TRIES=30
until curl -sf http://localhost:3000/health &>/dev/null; do
  TRIES=$((TRIES + 1))
  if [[ $TRIES -ge $MAX_TRIES ]]; then
    error "App did not become healthy after ${MAX_TRIES} attempts. Check logs: $COMPOSE logs app"
  fi
  sleep 2
done
success "App is healthy"

# ── Done ──────────────────────────────────────────────────────────────────────
GRAFANA_PASS_DISPLAY=$(grep "^GRAFANA_PASSWORD=" .env | cut -d= -f2)

echo ""
echo -e "${BOLD}${GREEN}Judica is running!${RESET}"
echo ""
echo -e "  ${BOLD}App${RESET}        →  http://localhost:3000"
echo -e "  ${BOLD}API docs${RESET}   →  http://localhost:3000/api/docs"
echo -e "  ${BOLD}Grafana${RESET}    →  http://localhost:3001  (admin / ${GRAFANA_PASS_DISPLAY})"
echo -e "  ${BOLD}Prometheus${RESET} →  http://localhost:9090"
echo ""
echo -e "Manage:"
echo -e "  Stop:    ${BOLD}$COMPOSE down${RESET}"
echo -e "  Logs:    ${BOLD}$COMPOSE logs -f app${RESET}"
echo -e "  Restart: ${BOLD}$COMPOSE restart app${RESET}"
echo -e "  Config:  ${BOLD}$INSTALL_DIR/.env${RESET}"
echo ""
