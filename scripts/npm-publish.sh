#!/usr/bin/env bash
#
# Publish @geekity/cms to npm from the commit that was released.
#
# This is the only way the package gets published. Nothing in CI publishes one,
# on purpose: a release reaches npm when a maintainer decides it should, not
# when a pull request lands.
#
# The version comes from packages/cms/package.json, which release-please bumps
# when its release pull request is merged. release-please then tags that
# release commit, so main right after the merge already is v<version>: the
# script refuses unless HEAD carries that tag, rather than checking the tag out
# into a detached HEAD. The usual order is: merge the release pull request,
# `git pull` on main, then run this.
#
# A release normally publishes the image too, and scripts/release.sh does both
# in one run, with the quality gates run once. This script on its own is for
# publishing only to npm, or for finishing a release whose npm half failed.
#
# Usage (from the repository root):
#
#   scripts/npm-publish.sh [--dry-run] [--check-only | --skip-gates]
#   pnpm npm:publish
#   pnpm npm:dry-run
#
# --dry-run prints what would be published, and publishes, checks and runs the
# quality gates not at all. --check-only runs the preflight checks and stops.
# --skip-gates runs everything but the quality gates.
set -euo pipefail

readonly VERSION_FILE="packages/cms/package.json"
# shellcheck source=scripts/lib/quality-gates.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib/quality-gates.sh"
readonly GATES=("${NPM_GATES[@]}")

log() {
  printf '\033[1m==> %s\033[0m\n' "$*"
}

fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: scripts/npm-publish.sh [--dry-run] [--check-only | --skip-gates]

Publish the package in ${VERSION_FILE} to npm, from the commit its version was
released as.

Options:
  --dry-run     Print what would be published without publishing any of it
  --check-only  Run the preflight checks and nothing else
  --skip-gates  Publish without running the quality gates. Warning: it
                assumes the quality gates just passed on this commit. Use it
                to finish a release whose gates already ran, as
                scripts/release.sh does
  -h, --help    Show this help

A normal release publishes to npm and ghcr.io together with pnpm release.

Run it from the repository root, after merging the release pull request and
pulling main.
EOF
}

dry_run=false
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
    # pnpm passes the -- in `pnpm npm:publish -- --skip-gates` through.
    --) ;;
    *)
      usage >&2
      fail "unknown option: $1"
      ;;
  esac
  shift
done

# Every path below is relative to the repository root, so anywhere else is
# refused rather than guessed at.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$(pwd -P)" != "$root" || ! -f "package.json" || ! -f "$VERSION_FILE" ]]; then
  fail "run this from the repository root (${root}), for example with pnpm npm:publish"
fi

# The name and version release-please wrote into the package.
read_field() {
  node -p "require('./${VERSION_FILE}').$1"
}

main() {
  local package version tag
  package="$(read_field name)"
  version="$(read_field version)"
  tag="v${version}"

  if [[ "$dry_run" == true ]]; then
    log "Dry run: nothing will be published"
    echo "Package:  ${package}"
    echo "Version:  ${version} (from ${VERSION_FILE})"
    echo "Tag:      ${tag} (HEAD must carry it)"
    case "$mode" in
      check-only)
        echo "Would run the preflight checks only: no quality gates, nothing published"
        return 0
        ;;
      skip-gates) echo "Would skip the quality gates (--skip-gates)" ;;
      full) echo "Would run the quality gates: ${GATES[*]}" ;;
    esac
    echo "Would publish with:"
    echo "  pnpm publish --filter ${package} --access public"
    return 0
  fi

  check_clean_tree
  check_head_is_tagged "$tag"
  check_login
  check_unpublished "$package" "$version"
  case "$mode" in
    check-only)
      log "Preflight checks passed: ${package}@${version} is ready to publish from ${tag}"
      return 0
      ;;
    skip-gates) log "Skipping the quality gates (--skip-gates)" ;;
    full) run_gates ;;
  esac
  publish "$package"

  log "Published ${package}@${version} from ${tag}"
  echo "Confirm it is on the registry with:"
  echo "  npm view ${package}@${version}"
}

# pnpm publishes the working tree, not the commit, so anything uncommitted
# would go to npm as part of the release without appearing in it anywhere.
check_clean_tree() {
  log "Checking the working tree is clean"
  if [[ -n "$(git status --porcelain)" ]]; then
    fail "the working tree is not clean; commit or stash your changes and try again"
  fi
}

# release-please tags the release commit and merges it, so main right after
# that merge already carries the tag. Checking for it proves the commit about
# to be published is the released one, and needs no detached HEAD to do it.
check_head_is_tagged() {
  local tag="$1" tags
  log "Checking HEAD is ${tag}"
  tags="$(git tag --points-at HEAD)"
  if ! printf '%s\n' "$tags" | grep -qx -- "$tag"; then
    fail "HEAD is not ${tag}; pull main after the release pull request was merged (HEAD carries: ${tags:-no tags})"
  fi
}

# `npm whoami` asks the registry who the stored token belongs to, so it fails
# both when there is no token and when the one there is has expired. The script
# does not log in for you: `npm login` opens a browser, and a publish should
# not be the thing that starts that.
check_login() {
  log "Checking who is logged in to npm"
  local who
  if ! who="$(npm whoami 2>/dev/null)" || [[ -z "$who" ]]; then
    fail "nobody is logged in to npm; run 'npm login' and try again"
  fi
  echo "Logged in as ${who}"
}

# npm refuses a version it already has, and says so in a way that reads like a
# permissions problem. Better to say it plainly before the gates take minutes.
check_unpublished() {
  local package="$1" version="$2" found
  log "Checking ${package}@${version} is not on the registry"
  found="$(npm view "${package}@${version}" version 2>/dev/null || true)"
  if [[ -n "$found" ]]; then
    fail "${package}@${version} is already published; release-please must bump the version first"
  fi
}

run_gates() {
  local gate
  for gate in "${GATES[@]}"; do
    log "Quality gate: pnpm ${gate}"
    pnpm "$gate" || fail "quality gate 'pnpm ${gate}' failed; nothing was published"
  done
}

# `--access public` because the scope is private by default. No
# `--no-git-checks`: HEAD is the tagged commit on the publish branch and the
# tree is clean, so pnpm's own checks have nothing to complain about, and
# leaving them on is one more thing that has to agree before this goes out.
publish() {
  local package="$1"
  log "Publishing ${package}"
  pnpm publish --filter "$package" --access public || fail "pnpm publish failed"
}

main
