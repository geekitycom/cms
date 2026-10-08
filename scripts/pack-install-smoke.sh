#!/usr/bin/env bash
#
# Install the package the way npm would, and boot what comes out.
#
# Every other gate tests the workspace: `apps/demo` reaches `@geekity/cms`
# through a symlink, so it sees the whole source tree whether or not `files` in
# package.json would have shipped it. This script tests the artefact instead —
# pack a tarball, scaffold a site with `geekity init`, install the tarball into
# it, boot it, and ask it for three URLs — which is the last consequence of
# decision-6 that nothing else covers. Every plugin package is packed and
# installed beside it the same way (decision-33), and exercised through the
# installed bin and the booted site.
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
tarball="$(find "${scratch}" -maxdepth 1 -name 'geekity-cms-*.tgz' -print -quit)"
if [[ -z "${tarball}" ]]; then
  echo "pnpm pack wrote no tarball into ${scratch}" >&2
  exit 1
fi
echo "packed ${tarball}"

log "building and packing @geekity/plugin-wordpress"
pnpm --dir "${ROOT}" --filter @geekity/plugin-wordpress build
pnpm --dir "${ROOT}" --filter @geekity/plugin-wordpress pack --pack-destination "${scratch}" >/dev/null
wordpress_tarball="$(find "${scratch}" -maxdepth 1 -name 'geekity-plugin-wordpress-*.tgz' -print -quit)"
if [[ -z "${wordpress_tarball}" ]]; then
  echo "pnpm pack wrote no plugin tarball into ${scratch}" >&2
  exit 1
fi
echo "packed ${wordpress_tarball}"

log "building and packing @geekity/plugin-llm"
pnpm --dir "${ROOT}" --filter @geekity/plugin-llm build
pnpm --dir "${ROOT}" --filter @geekity/plugin-llm pack --pack-destination "${scratch}" >/dev/null
llm_tarball="$(find "${scratch}" -maxdepth 1 -name 'geekity-plugin-llm-*.tgz' -print -quit)"
if [[ -z "${llm_tarball}" ]]; then
  echo "pnpm pack wrote no plugin-llm tarball into ${scratch}" >&2
  exit 1
fi
echo "packed ${llm_tarball}"

log "geekity init ${site}"
# The bin is run from dist/ rather than through a workspace link, so this is
# also a check that the compiled CLI resolves its own templates directory.
node "${ROOT}/packages/cms/dist/cli.js" init "${site}"

log "pointing the new site at the tarballs"
node --input-type=commonjs -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const [manifestPath, tarball, wordpress, llm] = process.argv.slice(1);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies["@geekity/cms"] = "file:" + tarball;
  manifest.dependencies["@geekity/plugin-wordpress"] = "file:" + wordpress;
  manifest.dependencies["@geekity/plugin-llm"] = "file:" + llm;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
' "${site}/package.json" "${tarball}" "${wordpress_tarball}" "${llm_tarball}"
grep '@geekity/' "${site}/package.json"

log "installing the WordPress and LLM plugins in the site config"
node --input-type=commonjs -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const [configPath] = process.argv.slice(1);
  const config = readFileSync(configPath, "utf8")
    .replace(/^/, "import wordpress from \"@geekity/plugin-wordpress\";\nimport llm from \"@geekity/plugin-llm\";\n")
    .replace("export default defineConfig({", "export default defineConfig({\n  plugins: [wordpress, llm],");
  writeFileSync(configPath, config);
' "${site}/geekity.config.ts"
grep -n 'wordpress\|llm' "${site}/geekity.config.ts"

log "installing"
pnpm --dir "${site}" install

log "importing @geekity/cms/plugin from the installed tarball"
# The subpath export is the boundary every plugin imports (decision-33), so it
# has to resolve from the artefact, not only through the workspace link. The
# file below is also type checked with the site at the end.
(
  cd "${site}"
  node --input-type=module -e '
    const plugin = await import("@geekity/cms/plugin");
    if (typeof plugin.definePlugin !== "function" || !Number.isInteger(plugin.HOST_API_VERSION)) {
      console.error("@geekity/cms/plugin resolved without definePlugin and HOST_API_VERSION");
      process.exit(1);
    }
    console.log("ok  @geekity/cms/plugin, host API version " + plugin.HOST_API_VERSION);
  '
)
cat >"${site}/plugin-check.ts" <<'TS'
import { definePlugin } from '@geekity/cms/plugin';
import type { Plugin, PluginHost } from '@geekity/cms/plugin';
import llm from '@geekity/plugin-llm';
import wordpress from '@geekity/plugin-wordpress';

export const installed: readonly Plugin[] = [wordpress, llm];

export const check: Plugin = definePlugin({
  name: '@scratch/plugin-check',
  version: '0.0.0',
  label: 'Check',
  description: 'Type checks against the published declarations.',
  hostApi: 1,
  requires: {},
  register(host: PluginHost) {
    host.get('/check/', ({ params }) => new Response(String(Object.keys(params).length)));
  },
});
TS

log "running the plugin's command through the installed bin"
(
  cd "${site}"
  pnpm exec geekity --help | grep -F 'geekity import wordpress-actor <username>'
  pnpm exec geekity user add ada --password 'correct horse battery' >/dev/null
  node --input-type=module -e '
    import { generateKeyPairSync } from "node:crypto";
    import { writeFileSync } from "node:fs";
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeFileSync("ada.private.pem", pair.privateKey);
  '
  pnpm exec geekity import wordpress-actor ada --actor-id 'http://localhost:3000/?author=2' \
    --wordpress-id 2 --private-key ada.private.pem --followers none
  node --input-type=commonjs -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const file = "content/_data/site.json";
    const site = JSON.parse(readFileSync(file, "utf8"));
    site.plugins = {
      "@geekity/plugin-wordpress": { enabled: true },
      "@geekity/plugin-llm": { enabled: true },
    };
    writeFileSync(file, JSON.stringify(site, null, 2) + "\n");
  '
)

log "loading each plugin's bundle with no node_modules beside it"
for package in plugin-wordpress plugin-llm; do
  bundle_dir="${scratch}/bundle-only-${package}"
  mkdir -p "${bundle_dir}"
  cp "${site}/node_modules/@geekity/${package}/dist/bundle/index.js" "${bundle_dir}/index.js"
  (
    cd "${bundle_dir}"
    node --input-type=module -e '
      const [expected] = process.argv.slice(1);
      const { default: plugin } = await import("./index.js");
      if (plugin.name !== expected || typeof plugin.register !== "function") {
        console.error("the bundle does not export " + expected);
        process.exit(1);
      }
      console.log("ok  the bundle exports " + plugin.name + " " + plugin.version);
    ' "@geekity/${package}"
  )
done

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

log "asking the enabled WordPress plugin for its old actor path"
actor="$(curl -fsS -H 'accept: application/activity+json' "${BASE}/wp-json/activitypub/1.0/actors/2")"
if ! grep -qF '"id":"http://localhost:3000/?author=2"' <<<"${actor}"; then
  echo "the old actor path did not serve the stored id:" >&2
  echo "${actor}" >&2
  exit 1
fi
echo "ok  GET /wp-json/activitypub/1.0/actors/2"

log "signing in and asking for the LLM plugin's settings screen"
jar="${scratch}/cookies.txt"
login="$(curl -fsS -c "${jar}" -b "${jar}" "${BASE}/admin/login")"
token="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' <<<"${login}" | head -n 1)"
curl -fsS -o /dev/null -c "${jar}" -b "${jar}" \
  --data-urlencode "csrf_token=${token}" --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct horse battery' "${BASE}/admin/login"
llm_screen="$(curl -fsS -b "${jar}" "${BASE}/admin/plugins/@geekity/plugin-llm")"
for expected in 'Base URL' 'https://openrouter.ai/api/v1' '<code>GEEKITY_PLUGIN_LLM__API_KEY</code>' 'Test connection'; do
  if ! grep -qF -- "${expected}" <<<"${llm_screen}"; then
    echo "the LLM screen did not contain \"${expected}\"" >&2
    exit 1
  fi
done
echo "ok  GET /admin/plugins/@geekity/plugin-llm"

log "type checking the scratch site against the published declarations"
(cd "${site}" && npx tsc --noEmit)

log "pack-install smoke passed"
