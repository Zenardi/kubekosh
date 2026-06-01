---
name: add-scenario
description: Scaffold a new KubeKosh scenario (task or MCQ) conforming to scenarios/SCHEMA.md and optionally wire it into a bundle. Triggered by the user with /add-scenario.
disable-model-invocation: true
---

# Add a KubeKosh scenario

User request: `$ARGUMENTS` (e.g. "task: scale a deployment to 3 replicas, Workloads, Easy" or "mcq about service types").

Read `scenarios/SCHEMA.md` first — it is authoritative. Then:

1. **Decide type** from the request: `task` (hands-on, validated against live cluster) or `mcq` (multiple choice).
2. **Pick a unique kebab-case `id`.** Check it does not already exist in `scenarios/scenarios.json`.
3. **Draft the object** with all required common fields: `id`, `title`, `category`, `difficulty` (`Easy`|`Medium`|`Hard`), `type`, `weight` (number), `description` (GitHub-flavored Markdown), and `hints`.
   - **Task:** add `setup_commands` (objects with `command`, idempotent, run as root — non-zero exits tolerated), optional `teardown_commands`, optional `default_namespace`, and `validation.commands` (each with `command`, `expected_output`, `match` ∈ exact|contains|not_contains|regex). Validation commands must be idempotent `kubectl`.
   - **MCQ:** add `options` (`id` + `text`), `correct_option` matching one option `id`, and a clear `explanation`. Set `setup_commands`/`teardown_commands` to `[]`.
4. **Append** the object to the `scenarios/scenarios.json` array (do not reformat the rest of the file).
5. **Optionally wire into a bundle:** if the user named a bundle, add the new `id` to that bundle's `scenario_ids` in `scenarios/bundles.json` at the requested position.
6. **Validate** by running the `/validate-scenarios` checks (or invoke that skill) and report the result. Confirm the new `id`, type, and bundle wiring.

Ask the user only if the request is missing something you cannot reasonably default (e.g. the correct answer for an MCQ, or the validation condition for a task).
