# Skills — MovieFlix agent team

How work gets routed, executed and proven. Read `AGENTS.md` first; this folder
is the on-demand layer.

## Files

| File | Load when | Produces |
|---|---|---|
| `orchestrator.md` | any non-trivial request; you are the lead | plan + assignments + final report |
| `project-domain.md` | you need product/business/architecture facts | accurate context, no code |
| `developer.md` | implementing a feature or bug fix | working diff + evidence |
| `designer.md` | any user-facing/visual change | UI change that obeys `DESIGN_SPEC.md` |
| `tester.md` | after a change, before a release, or a QA sweep | pass/fail evidence + bug reports |
| `production-error.md` | live incident or recurring failure | triage, fix, prevention rule |
| `failure-monitor.md` | scheduled watch, failure inbox non-empty, after deploy | incidents opened, auto-fixes gated, register rows |

Failure monitor (scheduled) drains the failure inbox, groups and classifies
what broke before a user reported it, dispatches the developer, and hands the
prevention rule to the register. It may auto-fix only a narrow allowlist of
defect classes; deploys always need the owner.

The six original `.md.txt` drafts were moved to
`backups/legacy-skills-2026-11-05/` during cleanup — kept as a record of the
owner's first intent, never used as instructions. Only the files listed above
are authoritative.

All playbooks were rebuilt by a parallel team of eight agents, each owning one
file and grounding it in the code it covers (paths, endpoints, tokens, scripts,
log files). The shell was blocked by a Windows permission issue during that
pass, so **commands were documented, not executed** — the first run should
validate `docs/verification.md` and record the result. The routing matrix and
phase gates G0–G4 live in `orchestrator.md`, not here.

## Team shape

```
        ┌──────────────┐
        │ Orchestrator │  routes, plans, gates, reports
        └──────┬───────┘
   ┌───────────┼────────────┬───────────────┐
   ▼           ▼            ▼               ▼
Developer   Designer     Tester      Production error
(code)     (visual/UX)  (evidence)   (incidents + memory)
         ▲
         └── Failure monitor (scheduled): failure inbox → incidents → fixes
```

Rules:

- **One writer per file at a time.** Parallel agents must own disjoint paths;
  record the ownership in the brief.
- **Every phase ends with evidence**, not an opinion. No evidence → gate fails.
- **Memory loop:** before changing an area, search `docs/error-register.md` for
  related past errors and re-test their prevention cases.
- **Escalate to the owner** (the human) for: ambiguity, destructive actions,
  deploys, key rotation, or anything that could take the service down.

## Starter prompts

**Feature**
> Read `AGENTS.md`, `Skills/orchestrator.md` and `Skills/project-domain.md`.
> Run the Feature workflow for: `<request>`. Stop at each gate and show me the
> evidence before moving on.

**Incident**
> Read `AGENTS.md`, `Skills/orchestrator.md` and `Skills/production-error.md`.
> Triage this production issue: `<symptom, platform, when>`. Stabilise first,
> then root-cause, fix, verify, and write the prevention rule.

**Failure watch** (scheduled or before the user reports)
> Read `AGENTS.md`, `Skills/failure-monitor.md` and `docs/telemetry.md`. Drain
> the failure inbox and classify every new signature; auto-fix only allowlisted
> classes, escalate the rest, and update `docs/error-register.md`.

**QA sweep**
> Read `AGENTS.md` and `Skills/tester.md`. Run the full test matrix against
> `<local server | vikyflix.uk | Render fallback>`. Report failures with
> evidence and severity; do not fix anything yet.

**Design pass**
> Read `AGENTS.md`, `Skills/designer.md`, `web/DESIGN_SPEC.md` and the relevant
> components. Improve `<screen>` without inventing a second visual language.
> Show before/after evidence for phone, tablet and desktop widths.

## Handoff contract

Every role returns the same shape, so the orchestrator can gate it:

```
Summary:        one paragraph — what changed and why
Files:          exact paths touched
Evidence:       commands run + key output / screenshots / HTTP results
Verification:   which items in docs/verification.md passed
Risks:          what could break, what was not tested and why
Follow-ups:     remaining work, if any
Open questions: anything the owner must decide
```

An agent that cannot fill `Evidence` has not finished the task.

## Memory (their "RAG")

`docs/error-register.md` is the retrieval store: one row per production error
with symptom, root cause, fix and a prevention rule. Markdown is deliberate —
at this project's size it is faster and more reliable than a vector store, and
any agent or editor can read it. The orchestrator reads it during planning; the
production-error role is the only writer; the tester files `BUG-<n>` reports
that reference the same number.
