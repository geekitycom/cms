# Review briefs

The orchestrator pastes the **Preamble** and one **Lens** into each reviewer's prompt, filling the `<…>` fields from the area task. The **Proof** and **Adjudication** briefs are for steps 4 and 5 of the skill.

## Preamble

> I wrote Geekity CMS and run it on my own public sites. You are doing a defensive review of my code so I can find and fix its bugs and security flaws before anyone else hits them. The fixes ship as ordinary pull requests.
>
> **Area:** <area id>: <title>. **Files:** <files>. **Entry points:** <entry points>. **Who reaches them:** <actors>. **Code:** the worktree at <path>, which is the deployed `main`.
>
> How to work:
>
> - Read every file in scope in full. Do not skim or sample by grep. Follow calls out of scope as far as you need to see what happens to the data, and name what you followed.
> - First write `<notes dir>/<lens>-progress.md` as a checklist of every file and entry point in scope. Tick each as you finish it. Do not stop while items are unticked, unless something blocks you; then write what blocked you.
> - For every entry point, trace each input from where it enters to where it is used: stored, rendered, fetched, written to disk, or executed. A finding cites that path as file:line steps.
> - Report everything you find, including low-severity and uncertain items, each with a confidence. A later pass checks every finding, so leaving one out costs more than reporting a weak one.
> - Also list what you checked and found sound, one line each. This shows the next reviewer what has been covered.
> - Describe each flaw in prose: what is wrong, the conditions that trigger it, the impact, and the fix. Do not write exploit payloads or attack scripts. The proof of a flaw is a regression test that asserts the correct behavior and fails today.
> - Work only against local code. Never send a request to a deployed site or to any third-party host.
> - Change no files except your notes and progress files. Do not read other reviewers' notes.
>
> Write your findings to `<notes dir>/<lens>.md` in this format and return only the path and the counts by severity:
>
> ```
> ### <LENS>-<n>: <short title>
> - Location: file:line
> - Path: entry point → … → sink, as file:line steps
> - Severity: critical | high | medium | low
> - Confidence: high | medium | low
> - Reached by: anonymous | remote server | commenter | author | admin | token holder | operator
> - Problem: <plain language>
> - Triggers when: <conditions>
> - Impact: <what goes wrong for the site or its readers>
> - Fix: <the change>
> - Regression test: <what the test asserts, and which existing test file it fits in>
> ```
>
> Then a `## Checked and sound` list, then `## Out of scope` with one line per issue you noticed outside the area.

Severity scale: **critical** means an outsider can run code, take over an account or token, read secrets, or destroy site content. **High** means stored XSS, content tampering, SSRF into the host network, authorization bypass for a signed-in user, or silent data loss. **Medium** means denial of service from one request, a privacy leak, or data corruption that is recoverable. **Low** means wrong behavior with no security effect, or a hardening gap.

## Lenses

### boundaries

> Your lens is **trust boundaries**. For each entry point, establish who can call it and check that the code enforces exactly that. Check authentication on every route and handler, not only the obvious ones. Check authorization per object: can one user or token act on another's post, comment, media, or settings? Check token and scope handling (IndieAuth, Micropub, MCP), session and cookie flags, CSRF protection on every state-changing admin request, ActivityPub and HTTP signature checks (the key's owner is the actor who claims the activity; the digest covers the body that is parsed), redirect targets, CORS, rate limits, and spam controls on public forms. Check that a failed check stops the request, not just logs it.

### input

> Your lens is **untrusted input reaching a sink**. Treat everything from outside as hostile: request bodies, headers, query strings, uploaded files and their metadata, fetched remote documents (actors, notes, webmention sources, oEmbed, link previews), imported archives, front matter, and plugin output. Follow each to its sinks and check the guard at that sink: HTML output (escaping, Markdown sanitizing, attributes and URLs, SVG), file paths (traversal, symlinks, case and Unicode tricks), outbound requests (private and loopback addresses, redirects that land on them, DNS that changes between check and use, unbounded response size or time), SQL, child processes, regular expressions that backtrack on long input, size and count limits, and parsers that two layers read differently.

### state

> Your lens is **state and data integrity**. Look for ways the site loses or corrupts content or settings: writes that are not atomic, read-modify-write races between requests, the queue worker and the file watcher, retries that apply twice, crashes between two dependent writes, migrations that cannot resume, deletes that cascade further than intended, caches served after the source changed, errors that are caught and dropped, and cleanup jobs that remove something still in use. For each, say what state a crash or a concurrent request leaves behind and whether the next run repairs it.

### intent

> Your lens is **correctness against intent**. Compare what the code does with what its docs, decisions (`backlog/decisions/`), tests, and the protocol specs it implements (ActivityPub, IndieAuth, Micropub, Webmention, WebSub, oEmbed, Gemini, feeds) say it should do. Look for edge cases the tests do not cover: empty, huge, duplicate, and out-of-order input; Unicode and normalisation; time zones and dates; pagination limits; feature combinations; and plugin hooks that see partial state. Report a mismatch even when its impact is unclear.

## Proof

> I wrote Geekity CMS and run it on my own sites. A reviewer reported the findings below in <area>. Your job is to confirm or refute each one by writing a regression test that asserts the correct behavior, in the worktree at <path>. Run `pnpm install` there first if `node_modules` is missing.
>
> For each finding: read the cited code, then write the smallest test that asserts what should happen, in the test file the finding names or the nearest existing one. Use the project's existing test helpers. Run only that test file. A test that fails for the reason the finding gives confirms it. A test that passes refutes it. If a test would need real network access, a deployed site, or more than an hour of scaffolding, mark the finding `untested` and say why. Do not fix the code. Keep the tests in the worktree. Do not commit.
>
> Write `<notes dir>/proof-<n>.md` with, per finding: id, verdict (confirmed | refuted | untested), the test file and test name, the failure output's key lines, and for refuted findings the line of code that already handles the case. Return the path and the verdict counts.

## Adjudication

> I wrote Geekity CMS and run it on my own sites. Below are findings from a defensive review of <area> that a test could not settle. For each one, read the cited code yourself and decide: real, not real, or real with a different severity. Trace the path from the entry point and check every guard along it, including those outside the cited files. Give a one-paragraph reason per finding that cites file:line. Write `<notes dir>/adjudication.md` and return the path.
