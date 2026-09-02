<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.50.1 -->

<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:

- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## Commit messages

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/).
release-please reads the history to decide the next version of `@geekity/cms`
and to write its changelog, so the type is not decoration: `feat` takes a minor,
`fix` takes a patch, and `feat!` or a `BREAKING CHANGE:` footer takes a major.
A husky `commit-msg` hook runs commitlint, so a message that does not parse is
rejected before it lands.

```
<type>(<scope>): <subject>
```

`type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore` or `revert`. The subject is lower case, in the
imperative, and carries no trailing full stop.

`scope` is optional. When a commit names one, it is one of:

| Scope     | What it covers                             |
| --------- | ------------------------------------------ |
| `cms`     | The published `@geekity/cms` package.      |
| `demo`    | `apps/demo`.                               |
| `deps`    | Dependency bumps.                          |
| `ci`      | GitHub Actions and other automation.       |
| `docs`    | README, this file, and the docs directory. |
| `release` | release-please and publishing.             |

Examples:

```
feat(cms): serve Atom and JSON feeds for posts
fix(cms): keep the offset when a tag archive is paginated
chore(deps): update chokidar to 5.0.1
docs: explain the theme lookup order
```

The scope list lives in `commitlint.config.js`; a commit that names anything
else is rejected.
