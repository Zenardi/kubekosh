---
name: validate-scenarios
description: Validate scenarios/scenarios.json and scenarios/bundles.json against the KubeKosh schema before opening a PR. Checks JSON validity, unique IDs, bundle cross-references, and per-type required fields. Use after editing either file or when asked to validate scenarios.
---

# Validate KubeKosh scenarios

Authoritative schema: `scenarios/SCHEMA.md`. Run every check below, then report a concise PASS/FAIL list with the offending `id` and field for each failure. Do not edit files — this skill only reports.

## Checks

**Both files parse as JSON.** Run `node -e "JSON.parse(require('fs').readFileSync('scenarios/scenarios.json','utf8'))"` and the same for `bundles.json`. Report the exact parse error (line/column) on failure.

**Scenarios (`scenarios/scenarios.json`, a JSON array):**
- Every `id` is present, kebab-case, and **unique** across the array.
- Every scenario has `title`, `category`, `difficulty` (`Easy` | `Medium` | `Hard`), `type` (`task` | `mcq`), `weight` (number), and `description`.
- `setup_commands` / `teardown_commands`, when present, are arrays of **objects each with a `command` string** (not bare strings).
- **MCQ** (`type: "mcq"`): has `options` (each with `id` + `text`), `correct_option` **matches one of** `options[].id`, and a non-empty `explanation`.
- **Task** (`type: "task"`): has `validation.commands`, each with `command`, `expected_output`, and `match` ∈ {`exact`, `contains`, `not_contains`, `regex`}.

**Bundles (`scenarios/bundles.json`, a JSON array):**
- Every bundle has `id`, `name`, `icon`, `tagline`, `color`, `colorDim`, `exam_minutes` (number), `scenario_ids` (array).
- **Every `scenario_ids` entry resolves to an existing scenario `id`** — list any dangling references.
- Bundle `id`s are unique.

**Cross-file (warning, not failure):** report any scenario `id` not referenced by any bundle (orphaned scenario).

## Output

Print a short summary: total scenarios, total bundles, then `✅ N checks passed` / `❌` lines per failure with `id` + field + what's wrong. End with a one-line verdict (ready to PR / fix N issues).
