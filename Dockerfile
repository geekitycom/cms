# The generic Geekity image: @geekity/cms running `geekity serve`, configured
# entirely by environment variables and volumes. Nothing a site owns is baked in:
# content/ and data/ are mounted, themes/ is optional, and with no `theme` in
# site.json the site wears the packaged default theme.
#
# The base tag is PINNED to the Node .node-version names (24), at the minor and
# patch the workspace is developed on. `node:24-*` floats, and a rebuild months
# from now would silently pull a different Node under node:sqlite.
#
# Debian slim, not Alpine, because of sharp. sharp is the one native module here
# and it loads a prebuilt libvips from @img/sharp-linux-<arch> on glibc, or from
# @img/sharp-linuxmusl-<arch> on musl. Both exist for amd64 and arm64, but the
# glibc builds are the ones sharp's own CI and most of its users run, and on
# glibc nothing falls back to compiling from source when a musl build lags a
# release: an image that would need python, make and g++ to install on one
# architecture is exactly what this base rules out. The size cost over Alpine
# is a few tens of megabytes.
ARG NODE_IMAGE=node:24.18.0-trixie-slim


FROM ${NODE_IMAGE} AS build

WORKDIR /workspace

# pnpm at the version packageManager in package.json names.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The dependency layer. `pnpm fetch` reads only the lockfile, so this layer, and
# the store it fills, is reused by every build until pnpm-lock.yaml changes, even
# when release-please bumps a version in a package.json.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

# Every workspace manifest, because a frozen install checks each importer the
# lockfile names. apps/demo contributes its package.json and nothing else, and
# only to this stage.
COPY packages/cms/package.json packages/cms/package.json
COPY apps/demo/package.json apps/demo/package.json

# --ignore-scripts: the root `prepare` is `husky && pnpm build`, and husky has
# no .git to install into. The build runs explicitly below instead. esbuild,
# the only dependency with a build script, finds its platform binary without
# its postinstall.
RUN pnpm install --offline --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/cms packages/cms

# tsc into dist/ and the admin editor bundle into admin/static/editor.js.
RUN pnpm --filter @geekity/cms build

# The package as npm would publish it (package.json `files`: dist, admin,
# themes, templates) with its production dependencies and nothing else: no
# sources, no tests, no devDependencies, no apps/demo and no demo theme.
#
# The one devDependency --prod cannot keep out is @types/node: sharp declares it
# an optional peer, and pnpm resolves an optional peer from whatever the
# importer has installed, devDependencies included, so the lockfile pins sharp
# to it. It is type declarations with no runtime code, and nothing requires it,
# so it is removed along with undici-types, which only it depends on.
RUN pnpm --filter @geekity/cms deploy --prod --ignore-scripts /prod/cms \
  && rm -rf /prod/cms/node_modules/.pnpm/@types+node@* \
    /prod/cms/node_modules/.pnpm/undici-types@* \
    /prod/cms/node_modules/.pnpm/*/node_modules/@types


FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /prod/cms ./

# `geekity` on PATH, so the operator commands are `docker exec <container>
# geekity user add ...` and read the same environment, and so the same
# directories, as the server. tsc does not set the executable bit, and without
# it the node image's entrypoint would treat `geekity` as a script path.
RUN chmod +x /app/dist/cli.js \
  && ln -s /app/dist/cli.js /usr/local/bin/geekity \
  && mkdir -p /site/content /site/data /site/themes \
  && chown -R node:node /site

# One root for everything a site owns. A fresh named volume mounted on any of
# these starts owned by node; a bind mount has to be owned by uid 1000 on the
# host.
ENV GEEKITY_CONTENT_DIR=/site/content \
  GEEKITY_DATA_DIR=/site/data \
  GEEKITY_THEMES_DIR=/site/themes \
  GEEKITY_SEED_CONTENT=true

# The working directory holds no geekity.config.*, so serve runs on defaults and
# the environment above. GEEKITY_BASE_URL is the deployer's to set: the seeded
# site.json and every canonical URL, feed and ActivityPub id are built from it.
WORKDIR /site

# Runs unprivileged, as the uid 1000 the base image ships as `node`.
USER node

EXPOSE 3000

# Only the status code is read, which is why /healthz answers 503 rather than a
# 200 carrying an error when the site cannot serve. start_period covers boot, so
# the first scan of a large content directory does not burn the retries.
#
# The port is read inside node, from GEEKITY_PORT then PORT as config.ts reads
# it. A hardcoded 3000 would test a port nothing listens on once an operator
# sets either variable, and would report a healthy site as broken. A `$PORT`
# shell expansion is no better: in compose, `$PORT` is substituted by compose
# itself at parse time, from the host environment, before the container sees it.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --start-interval=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.GEEKITY_PORT||process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["geekity", "serve"]
