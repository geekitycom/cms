# Developing Geekity CMS

## Workspace layout

```
packages/cms/          published as @geekity/cms
  src/
    index.ts           public API: createCms(config), defineConfig, types
    config.ts          config schema, defaults, environment overrides
    cli.ts             the `geekity` bin
    *.test.ts          node:test suites, run through tsx, excluded from the build
  editor/              the admin editor's browser code, bundled by esbuild
  admin/               admin templates and static files, editor.js among them
    pages/             one folder per admin menu section, a file per screen
    layouts/           the chrome a page extends: base, shell, settings-page
    components/        DaisyUI component macros, the flash and the admin bar
    src/admin.css      its stylesheet's Tailwind and DaisyUI source;
                       static/admin.css is the compiled output, gitignored
  themes/default/      default theme, shipped inside the package
    src/style.css      its stylesheet's Tailwind source; static/style.css is
                       the compiled output, gitignored
  templates/site/      files `geekity init` copies into a new site
  dist/                tsc output (JS + .d.ts), gitignored
apps/demo/             private site that consumes the package via workspace:*
  geekity.config.ts
  server.ts
  content/           the seed: six posts, three pages and _data/site.json
    _includes/       the two layouts an Eleventy build of the same files needs
  playground/        the copy of content/ that `pnpm dev` serves, gitignored
  playground.ts      makes playground/ when it is missing; --reset remakes it
  themes/demo/       a theme to activate in Appearance: post.njk, style.css, theme.json
  eleventy.config.js re-exports the documented example config
  test/              boots the demo over HTTP, and builds it with Eleventy
scripts/               pack-install-smoke.sh and docker-smoke.sh, the bodies of those CI jobs,
                       release.ts, which publishes a release, docker-build-push.sh,
                       which publishes the image, and check-doc-links.ts, which
                       `pnpm lint` runs over the Markdown
docs/                  the documentation, one topic per page; docs/README.md is the index
deploy/compose.yaml    the compose file a Docker deployment starts from
backlog/               tasks, docs and decisions (Backlog.md)
```

## Requirements

Node 24 or newer and pnpm, for the reason
[Requirements](getting-started.md#requirements) gives. Node 24 is also the
development target: `.node-version` pins
24, so fnm, nvm and similar tools pick it in this checkout, and CI reads the same
file. CI also runs the suite on the current line so the next LTS holds no
surprises. The pnpm version is pinned in `packageManager`, so
Corepack picks the right one:

```sh
corepack enable
pnpm install
```

## Commands

Run from the repository root.

| Command                  | What it does                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | Installs both workspace packages and links `apps/demo` to `packages/cms`.                                                                                                                                                                                                                                 |
| `pnpm dev`               | Starts the demo site with `tsx watch` (`pnpm --filter demo dev`). It listens on every interface and prints the network address a phone on the same Wi-Fi can open; set `GEEKITY_BASE_URL` to that address when testing feeds, IndieAuth or Micropub from the phone, since those links carry the base URL. |
| `pnpm start`             | Starts the demo site once, without watching.                                                                                                                                                                                                                                                              |
| `pnpm demo:reset`        | Replaces the demo's `playground/` with a fresh copy of `content/`.                                                                                                                                                                                                                                        |
| `pnpm build`             | Compiles `packages/cms`, bundles the editor, compiles theme and admin CSS.                                                                                                                                                                                                                                |
| `pnpm test`              | Builds every package once, then runs the `node:test` suites in every package through `tsx`.                                                                                                                                                                                                               |
| `pnpm test:coverage`     | The same build and suites with `--experimental-test-coverage`.                                                                                                                                                                                                                                            |
| `pnpm test:11ty`         | Builds the fixtures and the demo content with Eleventy, comparing URLs.                                                                                                                                                                                                                                   |
| `pnpm typecheck`         | `tsc --noEmit` across the workspace, tests included.                                                                                                                                                                                                                                                      |
| `pnpm lint`              | Lints the root scripts, checks that every relative link and anchor in the READMEs and `docs/` resolves, then fans out to each package's lint script.                                                                                                                                                      |
| `pnpm lint:fix`          | The same, with eslint's fixes applied.                                                                                                                                                                                                                                                                    |
| `pnpm format`            | Rewrites every file prettier owns.                                                                                                                                                                                                                                                                        |
| `pnpm format:check`      | Fails if any of them is not already formatted.                                                                                                                                                                                                                                                            |
| `pnpm clean`             | Removes build output.                                                                                                                                                                                                                                                                                     |
| `pnpm docker:dry-run`    | Prints the image tags a Docker publish would push, and builds nothing.                                                                                                                                                                                                                                    |
| `pnpm docker:build-push` | Builds the image for amd64 and arm64 and pushes it to ghcr.io.                                                                                                                                                                                                                                            |
| `pnpm docker:smoke`      | Builds the image locally, boots it on empty volumes and checks it serves.                                                                                                                                                                                                                                 |
| `pnpm release:dry-run`   | Prints which packages a release would publish and whether it would push the image, and why. Checks no login and runs no gate.                                                                                                                                                                             |
| `pnpm release`           | Publishes every package whose version is not on npm, then core's image if it has none, with the quality gates run once.                                                                                                                                                                                   |

Package-scoped variants work too, for example
`pnpm --filter @geekity/cms test` or `pnpm --filter demo dev`. A plugin package and the demo test against the built `@geekity/cms`,
so run `pnpm build` before testing one of them on its own.

## Quality gates

The three checks of decision-8 run the same way locally and in CI:
`pnpm lint` (eslint 9 flat config with typescript-eslint's type-checked rules,
`eslint-config-prettier` last), `pnpm typecheck`, and `pnpm test`.

`pnpm install` installs husky's hooks through the root `prepare` script, and
they run the checks where they are cheapest:

| Hook         | What it runs                                                 |
| ------------ | ------------------------------------------------------------ |
| `commit-msg` | commitlint, so every message is a Conventional Commit.       |
| `pre-commit` | lint-staged: eslint and prettier over the staged files only. |
| `pre-push`   | `pnpm typecheck` only; the test suite is CI's gate.          |

The suite is not in the hook because it takes about fourteen minutes, longer
than GitHub keeps an idle push connection open, so a push that ran it first
died after the tests had passed (decision-21). CI runs the suite on every push
and pull request as a required check, and that is the gate.

Commit messages are Conventional Commits and drive release-please; the format
and the allowed scopes are in [`CLAUDE.md`](../CLAUDE.md) and
`commitlint.config.js`.

The same gates run in GitHub Actions on every pull request and every push to
`main`; see [Continuous integration](#continuous-integration).

One wrinkle to know about: TypeScript 7 is a native compiler and no longer
ships the JavaScript compiler API that typescript-eslint reads types through,
so the workspace root keeps TypeScript 6 as a lint-only dependency while each
package builds and type checks with TypeScript 7. This is the side-by-side
arrangement TypeScript 7 documents, and the root pin goes away once
typescript-eslint supports TypeScript 7.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Each gate is its own job so it can be named as a required status check:

| Job            | What it runs                                        |
| -------------- | --------------------------------------------------- |
| `lint`         | `pnpm lint`, then `pnpm format:check`.              |
| `typecheck`    | `pnpm typecheck`.                                   |
| `test`         | `pnpm test` on Node 24.                             |
| `test-node-26` | The same suite on Node 26, the current line.        |
| `build`        | `pnpm build`.                                       |
| `test-11ty`    | `pnpm test:11ty`, the Eleventy compatibility suite. |
| `pack-install` | `scripts/pack-install-smoke.sh`.                    |
| `docker-smoke` | Builds the image, then `scripts/docker-smoke.sh`.   |

The four steps every job shares — install pnpm from the pinned
`packageManager`, install Node with the pnpm store cached, run
`pnpm install --frozen-lockfile` — live in the local composite action
`.github/actions/setup-workspace`. A new job is a `uses:` line, not another copy
of the setup.

Two things about that install are worth knowing. `pnpm install` runs the root
`prepare` script, which is `husky && pnpm build`, so `dist/` exists in every job
before its own command runs; the `build` job is still there on its own because a
required check needs something to point at. And `HUSKY=0` is set, because CI has
no git hooks to install.

`pack-install` is the one job that does not test the workspace. Every other job
reaches `@geekity/cms` through a symlink, which shows the whole source tree
whether or not `files` in `package.json` would have shipped it; this one runs
`pnpm pack`, scaffolds a site with `geekity init`, rewrites its dependency to
the tarball, installs, boots the site and asks it for `/`, the sample post and
the custom route in `server.ts`, then type checks the site with `tsc --noEmit`.
Its steps live in `scripts/pack-install-smoke.sh` rather than in the workflow,
so the same sequence can be run on a laptop:

```sh
scripts/pack-install-smoke.sh          # or: … /some/scratch/directory
```

The script builds the package first, makes its scratch directory, and removes
it and the tarball on the way out however it exits. `GEEKITY_SMOKE_PORT`
changes the port it boots on, which defaults to 3456.

`docker-smoke` builds the Docker image for `linux/amd64` on an amd64 runner,
loads it into the runner's Docker and pushes it nowhere, with the buildx GitHub
Actions cache keeping the rebuild quick. `scripts/docker-smoke.sh` then starts
it on two fresh, empty named volumes for `/site/content` and `/site/data`,
waits for `GET /healthz` to answer 200, and checks that `/` is the seeded
starter site in the default theme and that `/theme/style.css` is byte for byte
`packages/cms/themes/default/static/style.css`. A Dockerfile that does not
build, a container that exits, or a site that does not answer fails the job,
and the container's log is printed. On a laptop, with Docker running:

```sh
pnpm docker:smoke                  # builds linux/amd64 from the Dockerfile
GEEKITY_SMOKE_PLATFORM=linux/arm64 pnpm docker:smoke   # native on Apple silicon
pnpm docker:smoke some-image:tag   # tests an image that is already built
```

The script removes its container, its volumes and any image it built however it
exits.

`.github/dependabot.yml` opens weekly grouped update pull requests for the
GitHub Actions and npm ecosystems, whose commits are `ci(deps): …` and
`chore(deps): …`, so release-please reads them like any other commit.

### Branch protection

On GitHub, under Settings → Rules → Rulesets (or Settings → Branches), protect
`main` with:

- **Require a pull request before merging.** Direct pushes to `main` are what
  the release flow assumes never happen.
- **Require status checks to pass**, and select exactly these, spelled as the
  job names above: `lint`, `typecheck`, `test`, `test-node-26`, `build`,
  `test-11ty`, `pack-install`. Tick "Require branches to be up to date
  before merging".
- Allow only **merge commits** in Settings → General → Pull Requests. A merge
  keeps every commit of the branch, and release-please reads each one, so every
  change gets its own changelog line. GitHub puts the pull request title in the
  merge commit's body, and release-please reads any Conventional Commit line
  there too, so pull request titles are plain prose: a `feat(cms): …` title
  would list the branch's work a second time.
- Leave "Allow specified actors to bypass" empty except for administrators, and
  do **not** require signed commits: release-please commits with the Actions
  token, which does not sign.

Also enable Settings → Actions → General → "Allow GitHub Actions to create and
approve pull requests", which release-please needs to open its release pull
request.

## Releasing

Five packages are released from this repository: `@geekity/cms` in
`packages/cms` and the four plugin packages in `packages/plugin-*`. Each has
its own version, changelog and tag. Core's tags read `v0.26.0`, and a plugin's
tags carry its component, as `plugin-llm-v0.2.0`. `apps/demo` is private and
unversioned, so it is not tracked.

release-please writes the versions, the changelogs and the tags (decision-7).
One command, run by a maintainer from main, publishes to npm and pushes the
image. CI never publishes.

`packages/cms` publishes only `dist`, `admin`, `themes`, `templates`,
`README.md` and `LICENSE`, and a plugin package only `dist`, `README.md` and
`LICENSE`. Check what a package would publish with:

```sh
pnpm build
pnpm --filter @geekity/cms pack
```

### How a release flows

1. A pull request whose branch holds the commit
   `feat(cms): serve Atom and JSON feeds for posts` is merged into `main` with a
   merge commit, which keeps that commit as it is.
2. `.github/workflows/release-please.yml` runs on the push. release-please
   reads every Conventional Commit since each package's last release and
   opens or updates **one release pull request**,
   `chore(release): release main`. It bumps the version in the `package.json`
   of every package with releasable changes, writes each one's
   `CHANGELOG.md`, and updates `.release-please-manifest.json`. A package with
   no releasable changes keeps its version. Nothing is published while the
   pull request is open.
3. Merging the release pull request pushes the version bumps to `main`.
   release-please runs again, sees its own release commit, and creates a git
   tag and a GitHub release for every package the pull request bumped.
4. The maintainer pulls main and runs `pnpm release`, as
   [Publishing a release](#publishing-a-release) describes.

The bumps are the pre-1.0 rules of decision-7, configured in
`release-please-config.json`: `fix` takes a patch, `feat` takes a minor, and
`bump-minor-pre-major` keeps a breaking change on a minor until a package
reaches 1.0. `bump-patch-for-minor-pre-major` is off, so a feature really is a
minor. `initial-version` is `0.1.0`, because release-please otherwise starts a
package with no prior tag at 1.0.0 whatever the pre-major rules say.
`include-component-in-tag` is off for core, so its tags stay `v0.x.y`, and on
for each plugin.

Two settings keep the grouped release pull request working:

- `separate-pull-requests` is off, so every package goes in one pull request
  on the branch `release-please--branches--main`. Its title comes from
  `group-pull-request-title-pattern`, `chore(release): release ${branch}`,
  which commitlint accepts and which leaves the changelogs alone, because
  release-please lists no `chore`.
- Core's `package-name` is the empty string. release-please names a package's
  branch component after its package name, here `cms`. A grouped release pull
  request that bumps only core lists core's release without a component,
  because core's tags have none. release-please then compares the component of
  the merged branch, which has none, with `cms`, finds they differ, and cuts
  no tag (release-please issue 2214). With an empty package name, the two
  match. A grouped pull request that bumps two or more packages, or only
  plugins, is tagged either way. The package name `package.json` gives to npm
  is unaffected: release-please reads `package-name` only to name branches and
  components.

`.release-please-manifest.json` is the current released version of each tracked
package and must agree with each `package.json`. release-please writes both,
so do not edit either by hand.

### After the first grouped release merges

Until core 0.25.0 and the first plugin releases, release-please opened one
release pull request per package. The first grouped release pull request is
the first to use the settings above, so check its tags before publishing:

```sh
git pull --prune --tags
git tag --points-at HEAD
```

Every package the release pull request bumped needs its tag on that list:
`v<version>` for core and `<component>-v<version>` for a plugin. The bumped
packages are the ones the pull request's description lists, and the ones
whose `CHANGELOG.md` it changed. `pnpm release` refuses to publish a version
whose tag is missing, and names it.

If release-please did not cut a tag, the Actions log of the
`release-please` run on the merge commit says why. Tag the release by hand,
create its GitHub release, and mark the pull request tagged, so that
release-please does not hold back the next release pull request behind an
untagged one:

```sh
git tag v0.26.0 <merge commit>
git push origin v0.26.0
gh release create v0.26.0 --verify-tag --notes-file <(sed -n '/^## \[0.26.0\]/,/^## \[/p' packages/cms/CHANGELOG.md | sed '$d')
gh pr edit <release pull request> --remove-label "autorelease: pending" --add-label "autorelease: tagged"
```

### Publishing a release

`pnpm release` publishes every package whose version is not on npm yet, and
then pushes the image of `@geekity/cms` when its version has no image yet. Run
it on main after merging the release pull request:

```sh
git checkout main
git pull --prune --tags
pnpm release:dry-run   # the plan, and why
pnpm release           # npm, then <version> and latest on ghcr.io
pnpm release beta      # the same, plus a custom image tag
```

`scripts/release.ts` first works out the plan. It reads the packages from
`release-please-config.json` and asks npm whether each one's version is
published (`npm view <name>@<version>`). It asks the registry whether
`ghcr.io/geekitycom/cms:<core version>` exists, with
`docker manifest inspect`, which pulls nothing. A plugin-only release pushes no
image. With nothing to publish and the image in place, it says so and exits 0.

For every version it will publish, and for core when it will push the image,
the plan then needs the version's release tag to:

- exist, which is why the pull fetches tags
- be in the history of HEAD
- show no change to the package's folder between the tag and HEAD
  (`git diff <tag> HEAD -- packages/<package>` is empty)

The last rule means what is published is exactly what was released. When
another change to a package has landed on main after its release, the script
refuses that package. Merge the next release pull request and publish that.
`pnpm release:dry-run` prints the plan, each package with the reason it is or
is not published, and whether the image would be pushed. It checks no login,
runs no gate, and exits non-zero if the plan refuses a package.

A real run then goes through these steps and stops at the first failure:

1. Preflight checks: HEAD is `main`, the working tree is clean, `main` is level
   with its upstream, and `npm whoami` names someone (run `npm login` yourself;
   the script will not). When the image is due,
   `docker-build-push.sh --check-only` checks Docker is running and that you
   are logged in to ghcr.io.
2. The quality gates, once: `pnpm lint`, `pnpm format:check`,
   `pnpm typecheck`, `pnpm test` and `pnpm test:11ty`. The typecheck and the
   tests build every package first. A gate that leaves the working tree changed
   also stops the release.
3. `pnpm pack` for each package to publish, and a check of each tarball: its
   `package.json` carries the package's name and version, and a plugin's
   tarball holds `dist/bundle/index.js` and a `dist/bundle/plugin.json` with
   the same name and version, which is what `geekity plugin add` installs.
   Every tarball is checked before anything is published.
4. `npm publish <tarball> --access public` for each package, dependencies
   first. The order comes from each package's `dependencies`,
   `peerDependencies` and `geekity.requires`: core, then `plugin-llm` before
   the plugins that require it. Every package also sets
   `publishConfig.access` to `public`, because a scoped package is private by
   default, and the npm scope `@geekity` must be owned by the project
   (decision-6).
5. `docker-build-push.sh --skip-gates`, when the image is due.

Publishing the tarball that was checked, rather than letting a publish command
pack again, keeps the check and the upload on the same bytes. It also leaves
pnpm's own git checks out of the way.

A failed run is safe to repeat. The plan is read from npm and the registry,
so `pnpm release` again publishes only what npm does not have yet, then pushes
the image if it is still missing. It runs the gates again. To push the image
alone after a run whose gates passed, use the command the script prints:

```sh
pnpm docker:build-push -- --skip-gates
```

The `pack-install` CI job has already proven core's tarball installs and boots,
and that each plugin installs and loads, so the publish itself is the only
untested step.

### Core releases and the plugins' core range

A plugin accepts every core from the one it was built against up to 1.0. A
plugin package built while core was 0.26.0 publishes the peer range
`>=0.26.0 <1.0.0`, in its `package.json` and in its bundle's `plugin.json`.
It stays available on core 0.27.0 and every later 0.x release, so a core minor
release does not need a release of every plugin. A core older than the one the
plugin was built against is refused. A folder install shows the plugin as
unavailable, with the reason, and `geekity plugin add` says so when it
installs it. npm reports a peer dependency conflict.

Each plugin package writes its core peer dependency as `workspace:^`. pnpm
publishes that as a caret range, and before 1.0 a caret range accepts a single
core minor. The `beforePacking` hook in `.pnpmfile.mjs` replaces it with
`>=<core version> <1.0.0` on every `pnpm pack`, which is how `pnpm release`
builds the tarballs it publishes.
`scripts/build-plugin-bundle.js` writes the same range into `plugin.json`, and
`pnpm release` refuses a plugin tarball whose `plugin.json` ranges differ from
its `package.json`. The lower bound is the core version in the workspace when
the plugin is packed. release-please bumps that version in the release pull
request, so a plugin released with core is built against the new core.

A plugin's range of another plugin is written out in full, the same in
`geekity.requires`, in the plugin's `requires` and in the peer dependency as
`workspace:>=0.2.0 <1.0.0`. pnpm publishes the range after `workspace:` as it
is. The bundle build refuses a peer range that differs from `geekity.requires`.
Raise the lower bound when the plugin starts to use something that a later
release of the required plugin added.

The host API version is the gate that marks a break. `HOST_API_VERSION` in
`packages/cms/src/plugin.ts` goes up in the core release that changes
`@geekity/cms/plugin` so a plugin written for the current version would fail:
a type, method or field removed or renamed, an argument or return value
reshaped, or a behavior a plugin relies on changed. Adding a method, an
optional field or an extension point keeps the number. A plugin runs only on a
core that provides exactly the host API version it targets. A release that
raises the number therefore needs a release of every plugin, built against the
new host API. Land a commit in each plugin's folder before merging the release
pull request, so that all of them go out in the same grouped release pull
request.

### Publishing the Docker image

The image is `ghcr.io/geekitycom/cms`, built from the `Dockerfile` at the
repository root for `linux/amd64` and `linux/arm64`. CI never pushes it.
GitHub's runners are amd64 only and the machine a site runs on may be arm64,
so a CI publish could ship only half of what is needed. A maintainer publishes
it from a workstation as the last step of `pnpm release`. To push only an
image, or to finish a release whose image push failed, use
`scripts/docker-build-push.sh`. What CI does do is
build the amd64 image on every pull request and boot it (the `docker-smoke`
job), so a broken Dockerfile fails on its pull request rather than at release.

```sh
git checkout main
git pull --prune --tags
pnpm docker:dry-run          # check the version and tags first
pnpm docker:build-push       # pushes <version> and latest
pnpm docker:build-push beta  # the same, plus a custom tag
pnpm docker:build-push -- --skip-gates beta  # after a release whose gates passed
```

The version tag is read from `packages/cms/package.json`, which is why the
pull comes first: release-please bumps it in the release pull request.

The script refuses to run from anywhere but the repository root. It checks that
Docker is running and that you are logged in to ghcr.io (it runs
`docker login ghcr.io` if the Docker config has no entry for it; the password is
a GitHub personal access token with `write:packages`), then runs the quality
gates `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test`. A
failing gate stops it before anything is built. It then builds both platforms
with `--pull --no-cache` on a buildx builder called `multiplatform`, which it
creates with the `docker-container` driver the first time, and pushes every tag
as one manifest list. `--dry-run` prints the image, the version and the tags,
and builds, pushes, logs in and runs nothing. `--check-only` stops after the
Docker and login checks, and `--skip-gates` builds and pushes without running
the gates.

Confirm the push carried both platforms:

```sh
docker buildx imagetools inspect ghcr.io/geekitycom/cms:<version>
```

The output lists a manifest for `linux/amd64` and one for `linux/arm64`.

### Repository secrets

| Secret                 | Required? | What it is for                                              |
| ---------------------- | --------- | ----------------------------------------------------------- |
| `RELEASE_PLEASE_TOKEN` | optional  | A fine-grained PAT, so CI runs on the release pull request. |

No npm credential lives in the repository, because CI never publishes.

**`RELEASE_PLEASE_TOKEN` is optional.** GitHub deliberately does not trigger
workflows from events raised with the default `GITHUB_TOKEN`, so a release pull
request opened by release-please gets no CI checks. Adding a fine-grained
personal access token with **Contents: read and write** and **Pull requests:
read and write** on this repository, stored as `RELEASE_PLEASE_TOKEN`, restores
them. Without it the release still works; the release pull request just shows no
checks, so merging it needs an administrator override if the checks are
required.
