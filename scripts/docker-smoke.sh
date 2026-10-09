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
# must be the bytes of the image's own themes/default/static/style.css. That
# file is compiled by `pnpm build` inside the image and is not in the checkout
# (decision-22), so it is read out of the image rather than off the disk; it
# must also hold the theme's colour tokens, so an empty or stray file fails
# too. Any other
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
readonly STYLE="/app/themes/default/static/style.css"

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
for role in content data plugins; do
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
  --volume "${NAME}-plugins:/site/plugins" \
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
for expected in 'Hello, world' 'href="/theme/style.css?v=' 'data-is-root-path'; do
  if ! grep -qF -- "${expected}" <<<"${home}"; then
    fail "GET / answered 200 but did not contain '${expected}'"
  fi
done
echo "ok  GET /"

docker run --rm --entrypoint cat "${image}" "${STYLE}" >"${scratch}/packaged.css" \
  || fail "the image has no ${STYLE}"
grep -qF -- '--color-body:' "${scratch}/packaged.css" \
  || fail "${STYLE} in the image is not the default theme's compiled stylesheet"
curl -fsS -o "${scratch}/style.css" "${base}/theme/style.css"
if ! cmp -s "${scratch}/packaged.css" "${scratch}/style.css"; then
  fail "GET /theme/style.css is not ${STYLE} from the image"
fi
echo "ok  GET /theme/style.css is the default theme's stylesheet"

readonly PLUGIN="@geekity-smoke/plugin-hello"
readonly REGISTRY_PORT=4873

log "installing ${PLUGIN} with geekity plugin add while the container runs"
started="$(docker inspect --format '{{.State.StartedAt}}' "${container}")"
docker cp "${ROOT}/scripts/lib/fake-npm-registry.mjs" "${container}:/tmp/fake-npm-registry.mjs"
docker exec --detach "${container}" node /tmp/fake-npm-registry.mjs "${REGISTRY_PORT}"
registry=""
for _ in $(seq 20); do
  if docker exec "${container}" node -e "fetch('http://127.0.0.1:${REGISTRY_PORT}/').then(()=>process.exit(0),()=>process.exit(1))"; then
    registry=1
    break
  fi
  sleep 0.5
done
[[ -n "${registry}" ]] || fail "the fake registry did not start in the container"

added="$(docker exec --env "npm_config_registry=http://127.0.0.1:${REGISTRY_PORT}" "${container}" \
  geekity plugin add "${PLUGIN}@1.0.0")" || fail "geekity plugin add failed"
echo "${added}"
grep -qF "Added ${PLUGIN} 1.0.0 to /site/plugins/${PLUGIN}." <<<"${added}" \
  || fail "geekity plugin add did not say it added ${PLUGIN}"
docker exec "${container}" test -f "/site/plugins/${PLUGIN}/index.js" \
  || fail "/site/plugins/${PLUGIN}/index.js is not in the plugins volume"
echo "ok  geekity plugin add"

jar="${scratch}/cookies"
csrf() {
  sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' | head -n 1
}
token="$(curl -fsS -c "${jar}" -b "${jar}" "${base}/admin/setup" | csrf)"
[[ -n "${token}" ]] || fail "the setup form carried no CSRF token"
curl -fsS -o /dev/null -c "${jar}" -b "${jar}" \
  --data-urlencode "csrf_token=${token}" \
  --data-urlencode "username=smoke" \
  --data-urlencode "password=correct horse battery" \
  --data-urlencode "password_confirmation=correct horse battery" \
  "${base}/admin/setup" || fail "the setup form refused the first admin"

screen="$(curl -fsS -b "${jar}" "${base}/admin/plugins")"
grep -qF 'action="/admin/plugins/reload"' <<<"${screen}" \
  || fail "the Plugins screen did not offer Reload after plugin add"
token="$(csrf <<<"${screen}")"

log "pressing Reload on the Plugins screen"
curl -fsS -o /dev/null -b "${jar}" --data-urlencode "csrf_token=${token}" \
  "${base}/admin/plugins/reload" || fail "POST /admin/plugins/reload failed"
loaded=""
for _ in $(seq 30); do
  screen="$(curl -fsS -b "${jar}" "${base}/admin/plugins")"
  if grep -qF 'Hello from the smoke registry' <<<"${screen}" \
    && ! grep -qF 'action="/admin/plugins/reload"' <<<"${screen}"; then
    loaded=1
    break
  fi
  sleep 1
done
[[ -n "${loaded}" ]] || fail "the Plugins screen did not show ${PLUGIN} after Reload"
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${container}")" == "${started}" ]] \
  || fail "the container restarted"
[[ "$(docker inspect --format '{{.RestartCount}}' "${container}")" == "0" ]] \
  || fail "the container restarted"
echo "ok  ${PLUGIN} is on the Plugins screen after Reload, with no container restart"

upgraded="$(docker exec --env "npm_config_registry=http://127.0.0.1:${REGISTRY_PORT}" "${container}" \
  geekity plugin upgrade)" || fail "geekity plugin upgrade failed"
echo "${upgraded}"
grep -qF "${PLUGIN}: upgraded from 1.0.0 to 1.1.0." <<<"${upgraded}" \
  || fail "geekity plugin upgrade did not upgrade ${PLUGIN} to 1.1.0"
docker exec "${container}" grep -qF '"version":"1.1.0"' "/site/plugins/${PLUGIN}/plugin.json" \
  || fail "/site/plugins/${PLUGIN}/plugin.json is not 1.1.0 after plugin upgrade"
echo "ok  geekity plugin upgrade"

removed="$(docker exec "${container}" geekity plugin remove "${PLUGIN}")" \
  || fail "geekity plugin remove failed"
grep -qF "Removed ${PLUGIN}" <<<"${removed}" || fail "geekity plugin remove did not say so"
docker exec "${container}" test ! -e "/site/plugins/${PLUGIN}" \
  || fail "/site/plugins/${PLUGIN} is still there"
echo "ok  geekity plugin remove"
