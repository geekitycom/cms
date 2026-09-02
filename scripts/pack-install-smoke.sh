#!/usr/bin/env bash
#
# Install the package the way npm would, and boot what comes out.
#
# Every other gate tests the workspace: `apps/demo` reaches `@geekity/cms`
# through a symlink, so it sees the whole source tree whether or not `files` in
# package.json would have shipped it. This script tests the artefact instead —
# pack a tarball, scaffold a site with `geekity init`, install the tarball into
# it, boot it, and ask it for three URLs — which is the last consequence of
# decision-6 that nothing else covers.
#
# It is the body of the `pack-install` job in .github/workflows/ci.yml, so CI
# and a laptop run the same steps. Usage:
#
#   scripts/pack-install-smoke.sh [scratch-directory]
#
# The scratch directory is created if it does not exist; a unique subdirectory
# is made inside it and removed on the way out, whether the run passed or not.
# With no argument, a temporary directory is used. GEEKITY_SMOKE_PORT chooses
# the port (default 3456).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly PORT="${GEEKITY_SMOKE_PORT:-3456}"
readonly BASE="http://127.0.0.1:${PORT}"

# How long to wait for the site to answer: 60 tries, half a second apart.
readonly READY_TRIES=60
readonly READY_SLEEP=0.5

scratch=""
server_pid=""
server_log=""

log() {
  printf '\n\033[1m==> %s\033[0m\n' "$*"
}

# Signal a process and everything below it, deepest first.
#
# There are three processes between this script and the listening socket —
# `pnpm start`, the tsx CLI, and the node it runs the site in — and only the
# last one holds the port. Killing the top of that tree would orphan the
# bottom, which on a CI runner means a step that never finishes.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "${pid}" 2>/dev/null); do
    kill_tree "${child}"
  done
  kill "${pid}" 2>/dev/null || true
}

cleanup() {
  local status=$?

  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    log "stopping the site (pid ${server_pid})"
    kill_tree "${server_pid}"
    wait "${server_pid}" 2>/dev/null || true
  fi

  # The site's own output is only interesting when something went wrong.
  if [[ "${status}" -ne 0 && -n "${server_log}" && -s "${server_log}" ]]; then
    log "the site said:"
    cat "${server_log}"
  fi

  if [[ -n "${scratch}" && -d "${scratch}" ]]; then
    rm -rf "${scratch}"
  fi

  return "${status}"
}
trap cleanup EXIT

# Where the tarball and the scratch site go. A subdirectory of its own, so the
# cleanup can be a plain `rm -rf` even when it was handed $RUNNER_TEMP.
if [[ $# -gt 0 && -n "$1" ]]; then
  mkdir -p "$1"
  scratch="$(mktemp -d "${1%/}/geekity-pack-XXXXXX")"
else
  scratch="$(mktemp -d "${TMPDIR:-/tmp}/geekity-pack-XXXXXX")"
fi
readonly site="${scratch}/scratch-site"

log "building ${ROOT}/packages/cms"
# `pnpm pack` ships whatever is in dist/, so a stale build would make this
# whole script test the wrong bytes.
pnpm --dir "${ROOT}" --filter @geekity/cms build

log "packing the tarball into ${scratch}"
pnpm --dir "${ROOT}" --filter @geekity/cms pack --pack-destination "${scratch}" >/dev/null
tarball="$(find "${scratch}" -maxdepth 1 -name '*.tgz' -print -quit)"
if [[ -z "${tarball}" ]]; then
  echo "pnpm pack wrote no tarball into ${scratch}" >&2
  exit 1
fi
echo "packed ${tarball}"

log "geekity init ${site}"
# The bin is run from dist/ rather than through a workspace link, so this is
# also a check that the compiled CLI resolves its own templates directory.
node "${ROOT}/packages/cms/dist/cli.js" init "${site}"

log "pointing the new site at the tarball"
node --input-type=commonjs -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const [manifestPath, tarball] = process.argv.slice(1);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies["@geekity/cms"] = "file:" + tarball;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
' "${site}/package.json" "${tarball}"
grep '@geekity/cms' "${site}/package.json"

log "installing"
pnpm --dir "${site}" install

log "booting on port ${PORT}"
# The site's output goes to a file rather than to this script's stdout. That is
# not tidiness: a background process holding a CI step's stdout open is how a
# step hangs after its command has finished.
server_log="${scratch}/server.log"
(
  cd "${site}"
  GEEKITY_PORT="${PORT}" exec pnpm start
) >"${server_log}" 2>&1 &
server_pid=$!

ready=""
for _ in $(seq "${READY_TRIES}"); do
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    echo "the site exited before it answered" >&2
    exit 1
  fi
  # Silent while it is still starting: "connection refused" is the expected
  # answer for the first second or so, and it is not worth printing.
  if curl -fs -o /dev/null "${BASE}/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep "${READY_SLEEP}"
done

if [[ -z "${ready}" ]]; then
  echo "the site did not answer on ${BASE} after ${READY_TRIES} tries" >&2
  exit 1
fi

# `curl -f` exits non-zero on any status that is not a success, and the whole
# script is `set -e`, so a 404 or a 500 fails the job here.
check() {
  local path="$1" expected="$2" body
  body="$(curl -fsS "${BASE}${path}")"
  if ! grep -qF -- "${expected}" <<<"${body}"; then
    echo "GET ${path} answered 200 but did not contain \"${expected}\"" >&2
    exit 1
  fi
  echo "ok  GET ${path}"
}

log "asking the installed site for three URLs"
check "/" "Hello, world"
check "/2026/01/hello-world/" "Hello, world"
check "/hello/" "a route of my own"

log "type checking the scratch site against the published declarations"
(cd "${site}" && npx tsc --noEmit)

log "pack-install smoke passed"
