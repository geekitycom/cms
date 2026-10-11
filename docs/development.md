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
development target. `.node-version` pins 24, so fnm, nvm and similar tools
pick it in this checkout. CI reads the same file. CI also runs the suite on the
current Node line, to catch breakage before the next LTS. `packageManager` pins
the pnpm version, so Corepack picks the right one:

```sh
corepack enable
pnpm install
```

## Commands

Run from the repository root.

| Command                  | What it does                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | Installs both workspace packages and links `apps/demo` to `packages/cms`.                                                                                                                                                                                                                            |
| `pnpm dev`               | Starts the demo site with `tsx watch` (`pnpm --filter demo dev`). It listens on every interface and prints the network address that a phone on the same Wi-Fi can open. To test feeds, IndieAuth or Micropub from the phone, set `GEEKITY_BASE_URL` to that address. Those links carry the base URL. |
| `pnpm start`             | Starts the demo site once, without watching.                                                                                                                                                                                                                                                         |
| `pnpm demo:reset`        | Replaces the demo's `playground/` with a fresh copy of `content/`.                                                                                                                                                                                                                                   |
| `pnpm build`             | Compiles `packages/cms`, bundles the editor, compiles theme and admin CSS.                                                                                                                                                                                                                           |
| `pnpm test`              | Builds every package once, then runs the `node:test` suites in every package through `tsx`.                                                                                                                                                                                                          |
| `pnpm test:coverage`     | The same build and suites with `--experimental-test-coverage`.                                                                                                                                                                                                                                       |
| `pnpm test:11ty`         | Builds the fixtures and the demo content with Eleventy, comparing URLs.                                                                                                                                                                                                                              |
| `pnpm typecheck`         | `tsc --noEmit` across the workspace, tests included.                                                                                                                                                                                                                                                 |
| `pnpm lint`              | Lints the root scripts, checks that every relative link and anchor in the READMEs and `docs/` resolves, then fans out to each package's lint script.                                                                                                                                                 |
| `pnpm lint:fix`          | The same, with eslint's fixes applied.                                                                                                                                                                                                                                                               |
| `pnpm format`            | Rewrites every file prettier owns.                                                                                                                                                                                                                                                                   |
| `pnpm format:check`      | Fails if any of them is not already formatted.                                                                                                                                                                                                                                                       |
| `pnpm clean`             | Removes build output.                                                                                                                                                                                                                                                                                |
| `pnpm docker:dry-run`    | Prints the image tags a Docker publish would push, and builds nothing.                                                                                                                                                                                                                               |
| `pnpm docker:build-push` | Builds the image for amd64 and arm64 and pushes it to ghcr.io.                                                                                                                                                                                                                                       |
| `pnpm docker:smoke`      | Builds the image locally, boots it on empty volumes and checks it serves.                                                                                                                                                                                                                            |
| `pnpm release:dry-run`   | Prints which packages a release would publish and whether it would push the image, and why. Checks no login and runs no gate.                                                                                                                                                                        |
| `pnpm release`           | Publishes every package whose version is not on npm, then core's image if it has none, with the quality gates run once.                                                                                                                                                                              |

Package-scoped variants work too, for example
`pnpm --filter @geekity/cms test` or `pnpm --filter demo dev`. A plugin package
and the demo test against the built `@geekity/cms`. Run `pnpm build` before you
test one of them on its own.

## Quality gates

The three checks of decision-8 run the same way locally and in CI:
`pnpm lint` (eslint 9 flat config with typescript-eslint's type-checked rules,
`eslint-config-prettier` last), `pnpm typecheck`, and `pnpm test`.

`pnpm install` installs husky's hooks through the root `prepare` script. Each
hook runs the cheapest checks for its step:

| Hook         | What it runs                                                 |
| ------------ | ------------------------------------------------------------ |
| `commit-msg` | commitlint, so every message is a Conventional Commit.       |
| `pre-commit` | lint-staged: eslint and prettier over the staged files only. |
| `pre-push`   | `pnpm typecheck` only. The test suite is CI's gate.          |

The test suite is not in the hook (decision-21). It takes about fourteen
minutes, longer than GitHub keeps an idle push connection open. A push that ran
the suite first failed after the tests had passed. CI runs the suite on every
push and pull request as a required check.

Commit messages are Conventional Commits, and release-please reads them. The
format and the allowed scopes are in [`CLAUDE.md`](../CLAUDE.md) and
`commitlint.config.js`.

The same gates run in GitHub Actions on every pull request and every push to
`main`. See [Continuous integration](#continuous-integration).

TypeScript 7 is a native compiler. It no longer ships the JavaScript compiler
API that typescript-eslint uses to read types. The workspace root keeps
TypeScript 6 as a lint-only dependency, and each package builds and type checks
with TypeScript 7. TypeScript 7 documents this side-by-side setup. Remove the
root pin when typescript-eslint supports TypeScript 7.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Each gate is a separate job, so each one can be a required status check:

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

The three steps every job shares live in the local composite action
`.github/actions/setup-workspace`. They install pnpm from the pinned
`packageManager`, install Node with the pnpm store cached and run
`pnpm install --frozen-lockfile`. To add a job, add a `uses:` line for the
action. Do not copy the setup.

`pnpm install` runs the root `prepare` script, which is `husky && pnpm build`.
So `dist/` exists in every job before the job's own command runs. The `build`
job still exists because a required check needs a job to name. CI sets
`HUSKY=0`, because CI has no git hooks to install.

`pack-install` is the one job that does not test the workspace. Every other job
reaches `@geekity/cms` through a symlink. A symlink exposes the whole source
tree, whether or not `files` in `package.json` would ship it. `pack-install`
does the following:

1. runs `pnpm pack`
2. scaffolds a site with `geekity init`
3. rewrites the site's dependency to the tarball and installs it
4. boots the site and requests `/`, the sample post and the custom route in
   `server.ts`
5. type checks the site with `tsc --noEmit`

The steps live in `scripts/pack-install-smoke.sh`, not in the workflow, so you
can run the same sequence on a laptop:

```sh
scripts/pack-install-smoke.sh          # or: … /some/scratch/directory
```

The script builds the package first and creates its scratch directory. On
exit, whether it succeeds or fails, it removes the directory and the tarball.
`GEEKITY_SMOKE_PORT` sets the port it boots on. The default is 3456.

`docker-smoke` builds the Docker image for `linux/amd64` on an amd64 runner and
loads it into the runner's Docker. It pushes the image nowhere. The buildx
GitHub Actions cache keeps the rebuild fast. `scripts/docker-smoke.sh` then:

- starts the image on two fresh, empty named volumes for `/site/content` and
  `/site/data`
- waits for `GET /healthz` to answer 200
- checks that `/` is the seeded starter site in the default theme
- checks that `/theme/style.css` is byte for byte
  `packages/cms/themes/default/static/style.css`

The job fails if the Dockerfile does not build, the container exits, or the
site does not answer. The script then prints the container's log. To run it on
a laptop, with Docker running:

```sh
pnpm docker:smoke                  # builds linux/amd64 from the Dockerfile
GEEKITY_SMOKE_PLATFORM=linux/arm64 pnpm docker:smoke   # native on Apple silicon
pnpm docker:smoke some-image:tag   # tests an image that is already built
```

On exit, whether it succeeds or fails, the script removes its container, its
volumes and any image it built.

`.github/dependabot.yml` opens weekly grouped update pull requests for the
GitHub Actions and npm ecosystems. Their commits are `ci(deps): …` and
`chore(deps): …`, and release-please reads them like any other commit.

### Branch protection

On GitHub, under Settings → Rules → Rulesets (or Settings → Branches), protect
`main` with:

- **Require a pull request before merging.** The release flow assumes no
  direct pushes to `main`.
- **Require status checks to pass.** Select exactly these job names from the
  table above: `lint`, `typecheck`, `test`, `test-node-26`, `build`,
  `test-11ty`, `pack-install`. Tick "Require branches to be up to date before
  merging".
- Allow only **merge commits** in Settings → General → Pull Requests. A merge
  keeps every commit of the branch. release-please reads each one, so every
  change gets its own changelog line. GitHub puts the pull request title in the
  merge commit's body, and release-please reads any Conventional Commit line
  there too. Write pull request titles as plain prose. A `feat(cms): …` title
  would list the branch's work a second time.
- Leave "Allow specified actors to bypass" empty except for administrators.
  Do **not** require signed commits. release-please commits with the Actions
  token, which does not sign.

Also enable Settings → Actions → General → "Allow GitHub Actions to create and
approve pull requests". release-please needs it to open its release pull
request.

## Releasing

Five packages are released from this repository: `@geekity/cms` in
`packages/cms` and the four plugin packages in `packages/plugin-*`. Each has
its own version, changelog and tag. Core's tags look like `v0.26.0`. A
plugin's tags include its component, for example `plugin-llm-v0.2.0`.
`apps/demo` is private and unversioned, so release-please does not track it.

release-please writes the versions, the changelogs and the tags (decision-7).
One command, run by a maintainer from main, publishes to npm and pushes the
image. CI never publishes.

`packages/cms` publishes only `dist`, `admin`, `themes`, `templates`,
`README.md` and `LICENSE`. A plugin package publishes only `dist`, `README.md`
and `LICENSE`. To check what a package would publish, run:

```sh
pnpm build
pnpm --filter @geekity/cms pack
```

### How a release flows

1. A pull request whose branch holds the commit
   `feat(cms): serve Atom and JSON feeds for posts` is merged into `main` with a
   merge commit. The merge keeps that commit unchanged.
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
`release-please-config.json`:

- `fix` takes a patch.
- `feat` takes a minor.
- `bump-minor-pre-major` keeps a breaking change on a minor until a package
  reaches 1.0.
- `bump-patch-for-minor-pre-major` is off, so a feature takes a minor.
- `initial-version` is `0.1.0`. Without it, release-please starts a package
  with no prior tag at 1.0.0, whatever the pre-major rules say.
- `include-component-in-tag` is off for core, so its tags stay `v0.x.y`. It is
  on for each plugin.

Two settings keep the grouped release pull request working:

- `separate-pull-requests` is off, so every package goes in one pull request
  on the branch `release-please--branches--main`. Its title comes from
  `group-pull-request-title-pattern`, `chore(release): release ${branch}`.
  commitlint accepts this title. The title adds nothing to the changelogs,
  because release-please lists no `chore`.
- Core's `package-name` is the empty string. Why: release-please names a
  package's branch component after its package name, here `cms`. A grouped
  release pull request that bumps only core lists core's release without a
  component, because core's tags have none. release-please then compares the
  component of the merged branch, which has none, with `cms`. They differ, so
  it cuts no tag (release-please issue 2214). With an empty package name, the
  two match. A grouped pull request that bumps two or more packages, or only
  plugins, is tagged either way. The package name that `package.json` gives to
  npm does not change. release-please reads `package-name` only to name
  branches and components.

`.release-please-manifest.json` holds the current released version of each
tracked package and must agree with each `package.json`. release-please writes
both. Do not edit either by hand.

### After the first grouped release merges

Until core 0.25.0 and the first plugin releases, release-please opened one
release pull request per package. The first grouped release pull request is
the first to use the settings above, so check its tags before publishing:

```sh
git pull --prune --tags
git tag --points-at HEAD
```

Every package the release pull request bumped needs its tag on that list.
The tag is `v<version>` for core and `<component>-v<version>` for a plugin.
The bumped packages are the ones the pull request's description lists, and the
ones whose `CHANGELOG.md` it changed. `pnpm release` refuses to publish a
version whose tag is missing, and names it.

If release-please did not cut a tag, the Actions log of the `release-please`
run on the merge commit gives the reason. Tag the release by hand, create its
GitHub release, and mark the pull request as tagged. Otherwise release-please
holds back the next release pull request behind the untagged one:

```sh
git tag v0.26.0 <merge commit>
git push origin v0.26.0
gh release create v0.26.0 --verify-tag --notes-file <(sed -n '/^## \[0.26.0\]/,/^## \[/p' packages/cms/CHANGELOG.md | sed '$d')
gh pr edit <release pull request> --remove-label "autorelease: pending" --add-label "autorelease: tagged"
```

### Publishing a release

`pnpm release` publishes every package whose version is not on npm yet. Then
it pushes the image of `@geekity/cms` if its version has no image yet. Run it
on main after you merge the release pull request:

```sh
git checkout main
git pull --prune --tags
pnpm release:dry-run   # the plan, and why
pnpm release           # npm, then <version> and latest on ghcr.io
pnpm release beta      # the same, plus a custom image tag
```

`scripts/release.ts` first builds the plan. It reads the packages from
`release-please-config.json` and asks npm whether each one's version is
published (`npm view <name>@<version>`). It asks the registry whether
`ghcr.io/geekitycom/cms:<core version>` exists, with
`docker manifest inspect`, which pulls nothing. A plugin-only release pushes no
image. If there is nothing to publish and the image exists, the script says so
and exits 0.

For every version it will publish, and for core when it will push the image,
the plan requires the version's release tag to:

- exist. The `git pull --prune --tags` step fetches tags for this check.
- be in the history of HEAD
- show no change to the package's folder between the tag and HEAD
  (`git diff <tag> HEAD -- packages/<package>` is empty)

The last rule ensures that the published package matches the release. If
another change to a package landed on main after its release, the script
refuses that package. Merge the next release pull request and publish that
release. `pnpm release:dry-run` prints the plan, each package with the reason
it is or is not published, and whether the image would be pushed. It checks no
login, runs no gate, and exits non-zero if the plan refuses a package.

A real run then goes through these steps and stops at the first failure:

1. Preflight checks: HEAD is `main`, the working tree is clean, `main` is level
   with its upstream, and `npm whoami` names a user. The script does not run
   `npm login`. Run it yourself. When the image is due,
   `docker-build-push.sh --check-only` checks that Docker is running and that
   you are logged in to ghcr.io.
2. The quality gates, once: `pnpm lint`, `pnpm format:check`,
   `pnpm typecheck`, `pnpm test` and `pnpm test:11ty`. The typecheck and the
   tests build every package first. A gate that leaves the working tree changed
   also stops the release.
3. `pnpm pack` for each package to publish, and a check of each tarball. Its
   `package.json` must carry the package's name and version. A plugin's
   tarball must hold `dist/bundle/index.js` and a `dist/bundle/plugin.json`
   with the same name and version. Those two files are what
   `geekity plugin add` installs. The script checks every tarball before it
   publishes anything.
4. `npm publish <tarball> --access public` for each package, dependencies
   first. The order comes from each package's `dependencies`,
   `peerDependencies` and `geekity.requires`: core, then `plugin-llm` before
   the plugins that require it. Every package also sets
   `publishConfig.access` to `public`, because a scoped package is private by
   default. The project must own the npm scope `@geekity` (decision-6).
5. `docker-build-push.sh --skip-gates`, when the image is due.

The script publishes the tarball it checked. A publish command that packed
again could upload different bytes. Publishing the tarball also bypasses
pnpm's own git checks.

You can repeat a failed run. The plan comes from npm and the registry, so
running `pnpm release` again publishes only what npm does not have yet. Then it
pushes the image if the image is still missing. It runs the gates again. To
push the image alone after a run whose gates passed, use the command the script
prints:

```sh
pnpm docker:build-push -- --skip-gates
```

The `pack-install` CI job has already shown that core's tarball installs and
boots, and that each plugin installs and loads. The publish is the only
untested step.

### Core releases and the plugins' core range

A plugin accepts every core from the one it was built against up to 1.0. A
plugin package built while core was 0.26.0 publishes the peer range
`>=0.26.0 <1.0.0`, in its `package.json` and in its bundle's `plugin.json`.
It stays available on core 0.27.0 and every later 0.x release. A core minor
release does not need a release of every plugin. A core older than the one the
plugin was built against is refused:

- A folder install shows the plugin as unavailable, with the reason.
- `geekity plugin add` reports the conflict when it installs the plugin.
- npm reports a peer dependency conflict.

Each plugin package writes its core peer dependency as `workspace:^`. pnpm
publishes that as a caret range, and before 1.0 a caret range accepts a single
core minor. The `beforePacking` hook in `.pnpmfile.mjs` replaces it with
`>=<core version> <1.0.0` on every `pnpm pack`. `pnpm release` builds the
tarballs it publishes with `pnpm pack`. `scripts/build-plugin-bundle.js` writes
the same range into `plugin.json`. `pnpm release` refuses a plugin tarball
whose `plugin.json` ranges differ from its `package.json`. The lower bound is
the core version in the workspace when the plugin is packed. release-please
bumps that version in the release pull request, so a plugin released with core
is built against the new core.

A plugin's range of another plugin is written out in full. It is the same in
`geekity.requires`, in the plugin's `requires` and in the peer dependency as
`workspace:>=0.2.0 <1.0.0`. pnpm publishes the range after `workspace:` as it
is. The bundle build refuses a peer range that differs from `geekity.requires`.
Raise the lower bound when the plugin starts to use something that a later
release of the required plugin added.

The host API version marks a breaking change. `HOST_API_VERSION` in
`packages/cms/src/plugin.ts` goes up in the core release that changes
`@geekity/cms/plugin` in a way that breaks a plugin written for the current
version:

- a type, method or field removed or renamed
- an argument or return value with a new shape
- a change to a behavior a plugin relies on

Adding a method, an optional field or an extension point keeps the number. A
plugin runs only on a core that provides exactly the host API version it
targets. A release that raises the number needs a release of every plugin,
built against the new host API. Land a commit in each plugin's folder before
you merge the release pull request, so that all of them go out in the same
grouped release pull request.

### Publishing the Docker image

The image is `ghcr.io/geekitycom/cms`, built from the `Dockerfile` at the
repository root for `linux/amd64` and `linux/arm64`. CI never pushes it.
GitHub's runners are amd64 only, and the machine a site runs on may be arm64.
A CI publish could ship only one of the two platforms. A maintainer publishes
the image from a workstation as the last step of `pnpm release`. To push only
an image, or to finish a release whose image push failed, use
`scripts/docker-build-push.sh`. CI builds the amd64 image on every pull request
and boots it (the `docker-smoke` job). A broken Dockerfile fails on its pull
request, not at release.

```sh
git checkout main
git pull --prune --tags
pnpm docker:dry-run          # check the version and tags first
pnpm docker:build-push       # pushes <version> and latest
pnpm docker:build-push beta  # the same, plus a custom tag
pnpm docker:build-push -- --skip-gates beta  # after a release whose gates passed
```

The script reads the version tag from `packages/cms/package.json`.
release-please bumps that version in the release pull request, so pull first.

The script runs only from the repository root. It does the following:

1. Checks that Docker is running and that you are logged in to ghcr.io. If the
   Docker config has no entry for ghcr.io, it runs `docker login ghcr.io`. The
   password is a GitHub personal access token with `write:packages`.
2. Runs the quality gates `pnpm lint`, `pnpm format:check`, `pnpm typecheck`
   and `pnpm test`. A failing gate stops the script before anything is built.
3. Builds both platforms with `--pull --no-cache` on a buildx builder called
   `multiplatform`. The first time, it creates the builder with the
   `docker-container` driver.
4. Pushes every tag as one manifest list.

| Flag           | Effect                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| `--dry-run`    | Prints the image, the version and the tags. Builds, pushes, logs in and runs nothing. |
| `--check-only` | Stops after the Docker and login checks.                                              |
| `--skip-gates` | Builds and pushes without running the gates.                                          |

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

**`RELEASE_PLEASE_TOKEN` is optional.** GitHub does not trigger workflows from
events raised with the default `GITHUB_TOKEN`. A release pull request that
release-please opens therefore gets no CI checks. To restore the checks, store
a fine-grained personal access token as `RELEASE_PLEASE_TOKEN`, with
**Contents: read and write** and **Pull requests: read and write** on this
repository. Without the token the release still works. The release pull
request shows no checks, so if the checks are required, merging it needs an
administrator override.
