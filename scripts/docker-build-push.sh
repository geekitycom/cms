#!/usr/bin/env bash
#
# Build the Geekity CMS image for linux/amd64 and linux/arm64 and push it to
# the GitHub Container Registry as ghcr.io/geekitycom/cms.
#
# This is the only way an image gets published. Nothing in CI pushes one, on
# purpose: GitHub's runners are amd64 only and the box a site runs on may be
# arm64, so an automated publish could only ship half of what is needed. buildx
# builds both platforms here and pushes them as one manifest list.
#
# The version tag comes from packages/cms/package.json, which release-please
# bumps when its release pull request is merged. The usual order is: merge the
# release pull request, `git pull` on main, then run this. `latest` is pushed
# alongside the version, and so is a custom tag when one is given.
#
# A release normally pushes the image as the last step of scripts/release.ts,
# with the quality gates run once. This script on its own is for pushing only
# an image, or for finishing a release whose image push failed.
#
# Usage (from the repository root):
#
#   scripts/docker-build-push.sh [--dry-run] [--check-only | --skip-gates] [CUSTOM_TAG]
#   pnpm docker:build-push [CUSTOM_TAG]
#   pnpm docker:dry-run [CUSTOM_TAG]
#
# --dry-run prints what would be built and pushed, and builds, pushes, logs in
# and runs the quality gates not at all. --check-only runs the preflight checks
# and stops. --skip-gates runs everything but the quality gates.
set -euo pipefail

readonly IMAGE="ghcr.io/geekitycom/cms"
readonly REGISTRY="ghcr.io"
readonly PLATFORMS="linux/amd64,linux/arm64"
readonly BUILDER="multiplatform"
readonly DOCKERFILE="Dockerfile"
readonly VERSION_FILE="packages/cms/package.json"
readonly GATES=(lint format:check typecheck test)

log() {
  printf '\033[1m==> %s\033[0m\n' "$*"
}

fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: scripts/docker-build-push.sh [--dry-run] [--check-only | --skip-gates] [CUSTOM_TAG]

Build ${IMAGE} for ${PLATFORMS} and push it tagged with the version in
${VERSION_FILE}, latest, and CUSTOM_TAG when one is given.

Options:
  --dry-run     Print what would be built and pushed without doing any of it
  --check-only  Run the preflight checks and nothing else
  --skip-gates  Build and push without running the quality gates. Warning: it
                assumes the quality gates just passed on this commit. Use it
                to finish a release whose gates already ran, as
                scripts/release.ts does
  -h, --help    Show this help

A normal release publishes to npm and ghcr.io together with pnpm release.

Run it from the repository root, after merging the release pull request and
pulling main.
EOF
}

dry_run=false
custom_tag=""
# full, check-only or skip-gates.
mode=full

set_mode() {
  if [[ "$mode" != full && "$mode" != "$1" ]]; then
    fail "--check-only and --skip-gates cannot be used together"
  fi
  mode="$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --dry-run)
      dry_run=true
      ;;
    --check-only)
      set_mode check-only
      ;;
    --skip-gates)
      set_mode skip-gates
      ;;
    # pnpm passes the -- in `pnpm docker:build-push -- --skip-gates` through.
    --) ;;
    -*)
      usage >&2
      fail "unknown option: $1"
      ;;
    *)
      [[ -z "$custom_tag" ]] || fail "only one custom tag may be given (got '$custom_tag' and '$1')"
      custom_tag="$1"
      ;;
  esac
  shift
done

# A tag Docker accepts: up to 128 word characters, dots and dashes, not
# starting with a dot or a dash.
if [[ -n "$custom_tag" && ! "$custom_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  fail "'${custom_tag}' is not a valid tag; use letters, digits, '_', '.' and '-'"
fi

# The build context and every path below are relative to the repository root,
# so anywhere else is refused rather than guessed at.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$(pwd -P)" != "$root" || ! -f "$DOCKERFILE" || ! -f "$VERSION_FILE" ]]; then
  fail "run this from the repository root (${root}), for example with pnpm docker:build-push"
fi

# The version release-please wrote into the package.
read_version() {
  node -p "require('./${VERSION_FILE}').version"
}

main() {
  local version tag
  version="$(read_version)"

  local tags=("${IMAGE}:${version}" "${IMAGE}:latest")
  [[ -z "$custom_tag" ]] || tags+=("${IMAGE}:${custom_tag}")

  if [[ "$dry_run" == true ]]; then
    log "Dry run: nothing will be built or pushed"
    echo "Image:     ${IMAGE}"
    echo "Version:   ${version} (from ${VERSION_FILE})"
    echo "Platforms: ${PLATFORMS}"
    case "$mode" in
      check-only)
        echo "Would run the preflight checks only: no quality gates, nothing built or pushed"
        return 0
        ;;
      skip-gates) echo "Would skip the quality gates (--skip-gates)" ;;
      full) echo "Would run the quality gates: ${GATES[*]}" ;;
    esac
    echo "Would build and push:"
    for tag in "${tags[@]}"; do
      echo "  ${tag}"
    done
    return 0
  fi

  check_docker
  check_login
  case "$mode" in
    check-only)
      log "Preflight checks passed: ready to build and push:"
      for tag in "${tags[@]}"; do
        echo "  ${tag}"
      done
      return 0
      ;;
    skip-gates) log "Skipping the quality gates (--skip-gates)" ;;
    full) run_gates ;;
  esac
  build_and_push "${tags[@]}"

  log "Pushed ${IMAGE} for ${PLATFORMS}:"
  for tag in "${tags[@]}"; do
    echo "  ${tag}"
  done
  echo "Confirm both platforms are in the manifest list with:"
  echo "  docker buildx imagetools inspect ${IMAGE}:${version}"
}

check_docker() {
  log "Checking Docker is running"
  docker info >/dev/null 2>&1 || fail "Docker is not running; start it and try again"
}

# `docker login` writes the registry under "auths" in the docker config, even
# when a credential helper holds the secret itself.
check_login() {
  log "Checking ${REGISTRY} login"
  local config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
  if ! grep -q "\"${REGISTRY}\"" "$config" 2>/dev/null; then
    echo "Not logged in to ${REGISTRY}; running docker login ${REGISTRY}"
    echo "(use a GitHub personal access token with write:packages as the password)"
    docker login "$REGISTRY" || fail "could not log in to ${REGISTRY}; run 'docker login ${REGISTRY}' and try again"
  fi
}

run_gates() {
  local gate
  for gate in "${GATES[@]}"; do
    log "Quality gate: pnpm ${gate}"
    pnpm "$gate" || fail "quality gate 'pnpm ${gate}' failed; nothing was built or pushed"
  done
}

# Build both platforms and push every tag as one manifest list. A dedicated
# docker-container builder is made on first use and reused after that, so the
# build does not depend on how the local Docker's default builder and image
# store are set up.
build_and_push() {
  if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    log "Using buildx builder ${BUILDER}"
  else
    log "Creating buildx builder ${BUILDER}"
    docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
  fi

  local args=() tag
  for tag in "$@"; do
    args+=(--tag "$tag")
  done

  log "Building and pushing ${PLATFORMS}"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORMS" \
    --file "$DOCKERFILE" \
    --pull \
    --no-cache \
    "${args[@]}" \
    --push \
    . || fail "docker buildx build failed"
}

main
