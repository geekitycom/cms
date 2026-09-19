#!/usr/bin/env bash
#
# Boot the Docker image on empty volumes and check it serves the default theme.
#
# The image is published by hand (scripts/docker-build-push.sh), so without this
# a broken Dockerfile would surface only on a maintainer's workstation at
# release time. This is the body of the `docker-smoke` job in
# .github/workflows/ci.yml, so CI and a laptop run the same steps:
#
#   scripts/docker-smoke.sh [IMAGE]
#   pnpm docker:smoke [IMAGE]
#
# With IMAGE, that image is tested as it is; CI builds it first with the buildx
# GitHub Actions cache and passes the tag in. With no argument the Dockerfile at
# the repository root is built for GEEKITY_SMOKE_PLATFORM (default linux/amd64)
# with `--load`, tested, and the tag removed again on the way out.
#
# Either way nothing is pushed anywhere and no registry is logged in to.
#
# The container gets two fresh named volumes on /site/content and /site/data,
# so it boots the way a first deploy does: the image's GEEKITY_SEED_CONTENT
# fills the empty content volume with the starter site. The container publishes
# port 3000 on a free loopback port. It must answer GET /healthz with 200, and
# GET / with the starter site in the packaged default theme, whose stylesheet
# must be the bytes of packages/cms/themes/default/static/style.css. Any other
# outcome fails the run and prints the container's log. The container and the
# volumes are removed however the run ends.
#
# GEEKITY_SMOKE_PREFIX names the container, volumes and built tag (default
# geekity-smoke); a unique suffix is added so parallel runs do not collide.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly PLATFORM="${GEEKITY_SMOKE_PLATFORM:-linux/amd64}"
readonly PREFIX="${GEEKITY_SMOKE_PREFIX:-geekity-smoke}"
readonly NAME="${PREFIX}-$$-${RANDOM}"
readonly STYLE="${ROOT}/packages/cms/themes/default/static/style.css"

# How long to wait for /healthz: 90 tries, a second apart. The image boots in a
# couple of seconds; the rest is headroom for a slow runner.
readonly READY_TRIES=90
readonly READY_SLEEP=1

image=""
built_image=""
container=""
volumes=()
scratch=""

log() {
  printf '\n\033[1m==> %s\033[0m\n' "$*"
}

fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?

  if [[ -n "${container}" ]]; then
    # The container's own output is only interesting when something went wrong.
    if [[ "${status}" -ne 0 ]]; then
      log "the container said:"
      docker logs "${container}" 2>&1 || true
    fi
    docker rm -f "${container}" >/dev/null 2>&1 || true
  fi

  local volume
  for volume in "${volumes[@]+"${volumes[@]}"}"; do
    docker volume rm -f "${volume}" >/dev/null 2>&1 || true
  done

  if [[ -n "${built_image}" ]]; then
    docker image rm -f "${built_image}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${scratch}" && -d "${scratch}" ]]; then
    rm -rf "${scratch}"
  fi

  if [[ "${status}" -eq 0 ]]; then
    log "docker smoke passed"
  fi
  return "${status}"
}
trap cleanup EXIT

if [[ $# -gt 1 ]]; then
  fail "usage: scripts/docker-smoke.sh [IMAGE]"
fi

docker info >/dev/null 2>&1 || fail "Docker is not running; start it and try again"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-XXXXXX")"

if [[ $# -eq 1 && -n "$1" ]]; then
  image="$1"
  docker image inspect "${image}" >/dev/null 2>&1 || fail "no local image ${image}; build it with --load first"
else
  image="${NAME}:local"
  log "building ${image} for ${PLATFORM} from ${ROOT}/Dockerfile"
  built_image="${image}"
  docker buildx build \
    --platform "${PLATFORM}" \
    --file "${ROOT}/Dockerfile" \
    --tag "${image}" \
    --load \
    "${ROOT}" || fail "docker buildx build failed"
fi

log "starting ${image} on empty content and data volumes"
for role in content data; do
  volume="${NAME}-${role}"
  volumes+=("${volume}")
  docker volume create "${volume}" >/dev/null
done

# Port 0 on the host side (the empty field) lets Docker pick a free one.
container="$(docker run --detach \
  --name "${NAME}" \
  --publish 127.0.0.1::3000 \
  --volume "${NAME}-content:/site/content" \
  --volume "${NAME}-data:/site/data" \
  --env GEEKITY_BASE_URL=http://localhost:3000 \
  "${image}")"

hostport="$(docker port "${container}" 3000/tcp | head -n 1)"
[[ -n "${hostport}" ]] || fail "the container published no port for 3000"
base="http://${hostport}"
echo "container ${NAME} is listening on ${base}"

log "waiting for GET /healthz to answer 200"
ready=""
code=""
for _ in $(seq "${READY_TRIES}"); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "${container}")" != "true" ]]; then
    fail "the container exited before /healthz answered"
  fi
  # Silent while it is still starting: "connection refused" is the expected
  # answer for the first second or two.
  code="$(curl -s -o /dev/null -w '%{http_code}' "${base}/healthz" 2>/dev/null || true)"
  if [[ "${code}" == "200" ]]; then
    ready=1
    break
  fi
  sleep "${READY_SLEEP}"
done
[[ -n "${ready}" ]] || fail "/healthz did not answer 200 after ${READY_TRIES} tries (last status: ${code:-none})"
echo "ok  GET /healthz"

# `curl -f` exits non-zero on any status that is not a success, and the script
# is `set -e`, so a 404 or a 500 fails the run here.
log "checking the home page is the starter site in the default theme"
home="$(curl -fsS "${base}/")"
for expected in 'Hello, world' 'href="/theme/style.css"' 'data-is-root-path'; do
  if ! grep -qF -- "${expected}" <<<"${home}"; then
    fail "GET / answered 200 but did not contain '${expected}'"
  fi
done
echo "ok  GET /"

curl -fsS -o "${scratch}/style.css" "${base}/theme/style.css"
if ! cmp -s "${STYLE}" "${scratch}/style.css"; then
  fail "GET /theme/style.css is not packages/cms/themes/default/static/style.css"
fi
echo "ok  GET /theme/style.css is the default theme's stylesheet"
