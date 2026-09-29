#!/usr/bin/env bash
#
# Release @geekity/cms: publish the package to npm and push the image to
# ghcr.io, from the commit that was released.
#
# This is how a release goes out. Nothing in CI publishes either half, on
# purpose: a release reaches npm when a maintainer decides it should, not when
# a pull request lands, and GitHub's runners are amd64 only, so they could
# build only half of the image a site may need.
#
# It runs the two scripts that do each half, so they stay the one place each
# publish is done. Every preflight check of both runs first, so a missing login
# or an unreleased HEAD turns up before minutes of gates, not after the npm
# half. The quality gates of both then run once, and each script runs with
# --skip-gates. The usual order is: merge the release pull request, `git pull`
# on main, then run this.
#
# Usage (from the repository root):
#
#   scripts/release.sh [--dry-run] [CUSTOM_TAG]
#   pnpm release [CUSTOM_TAG]
#   pnpm release:dry-run [CUSTOM_TAG]
#
# CUSTOM_TAG is passed to docker-build-push.sh. --dry-run prints what each step
# would do, and checks, publishes, builds and runs the quality gates not at all.
set -euo pipefail

readonly VERSION_FILE="packages/cms/package.json"
readonly NPM_SCRIPT="scripts/npm-publish.sh"
readonly DOCKER_SCRIPT="scripts/docker-build-push.sh"
# shellcheck source=scripts/lib/quality-gates.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib/quality-gates.sh"

log() {
  printf '\033[1m==> %s\033[0m\n' "$*"
}

fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: scripts/release.sh [--dry-run] [CUSTOM_TAG]

Publish the package in ${VERSION_FILE} to npm and push its image to ghcr.io,
tagged with CUSTOM_TAG too when one is given. Runs every preflight check of
both, the quality gates once, then ${NPM_SCRIPT} and ${DOCKER_SCRIPT}.

Options:
  --dry-run   Print what each step would do without doing any of it
  -h, --help  Show this help

Run it from the repository root, after merging the release pull request and
pulling main.
EOF
}

dry_run=false
custom_tag=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --dry-run)
      dry_run=true
      ;;
    # pnpm passes the -- in `pnpm release -- beta` through.
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

# Both scripts refuse to run anywhere but the repository root, so this does
# too, before either of them has done anything.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$(pwd -P)" != "$root" || ! -f "package.json" || ! -f "$VERSION_FILE" ]]; then
  fail "run this from the repository root (${root}), for example with pnpm release"
fi

# Every gate either script runs, once, in the order the scripts run them.
GATES=()
for gate in "${NPM_GATES[@]}" "${DOCKER_GATES[@]}"; do
  case " ${GATES[*]-} " in
    *" ${gate} "*) ;;
    *) GATES+=("$gate") ;;
  esac
done
readonly GATES

# The arguments a script gets for the image half: the custom tag, if any.
docker_args=()
[[ -z "$custom_tag" ]] || docker_args+=("$custom_tag")

main() {
  if [[ "$dry_run" == true ]]; then
    dry_run_plan
    return 0
  fi

  local package
  package="$(node -p "const p = require('./${VERSION_FILE}'); p.name + '@' + p.version")"

  log "Preflight checks for npm"
  "$NPM_SCRIPT" --check-only || fail "the npm preflight checks failed; nothing was published or pushed"
  log "Preflight checks for Docker"
  "$DOCKER_SCRIPT" --check-only "${docker_args[@]+"${docker_args[@]}"}" ||
    fail "the Docker preflight checks failed; nothing was published or pushed"

  run_gates

  "$NPM_SCRIPT" --skip-gates || fail "the npm publish failed; no image was built or pushed"

  "$DOCKER_SCRIPT" --skip-gates "${docker_args[@]+"${docker_args[@]}"}" ||
    fail "$(
      echo "${package} was published to npm, but the Docker build and push failed."
      echo "Fix what went wrong, then finish the release with:"
      echo "  pnpm docker:build-push -- --skip-gates${custom_tag:+ ${custom_tag}}"
    )"

  log "Released ${package} to npm and ghcr.io"
}

dry_run_plan() {
  local tag_arg="${custom_tag:+ ${custom_tag}}"
  log "Dry run: nothing will be checked, published, built or pushed"
  echo "Would run, stopping at the first failure:"
  echo "  1. ${NPM_SCRIPT} --check-only"
  echo "     ${DOCKER_SCRIPT} --check-only${tag_arg}"
  echo "  2. The quality gates, once: ${GATES[*]}"
  echo "  3. ${NPM_SCRIPT} --skip-gates"
  echo "  4. ${DOCKER_SCRIPT} --skip-gates${tag_arg}"
  echo
  "$NPM_SCRIPT" --dry-run --skip-gates
  echo
  "$DOCKER_SCRIPT" --dry-run --skip-gates "${docker_args[@]+"${docker_args[@]}"}"
}

run_gates() {
  local gate
  for gate in "${GATES[@]}"; do
    log "Quality gate: pnpm ${gate}"
    pnpm "$gate" || fail "quality gate 'pnpm ${gate}' failed; nothing was published or pushed"
  done
}

main
