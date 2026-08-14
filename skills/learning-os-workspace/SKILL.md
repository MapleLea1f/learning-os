---
name: learning-os-workspace
description: Coordinate Learning OS workspaces during project tasks. Use when the current task belongs to a registered Learning OS workspace, when planning implementation work, or when creating and updating workspace tasks, execution steps, files, tests, and Git evidence.
---

# Learning OS Workspace

Use the local connector before and during project work so the Learning OS workspace remains the durable task record. A Codex session is associated by its current project directory, not by a ChatGPT URL.

## Resolve the workspace

1. Run `node scripts/learning-os-workspace.mjs current --cwd <current-working-directory>`.
2. If a workspace matches, read its open tasks with `task list`.
3. If no workspace matches, ask the user whether to register the current directory or continue without workspace synchronization.
4. Do not guess a workspace when multiple roots match. Prefer the longest matching root only when it is unambiguous.

## Plan before editing

For implementation requests, first inspect the repository and produce a concise execution plan in the conversation. Do not write temporary plan steps to the workspace until the user confirms the plan.

After confirmation:

1. Reuse an existing matching parent task when one exists.
2. Otherwise create a parent task with `task create` and source `skill`.
3. Start an execution record linked to the selected task with `execution start --task TASK_ID`.
4. Create one step for each meaningful implementation phase.
5. When execution starts, the linked workspace task is moved to `in_progress`; when execution finishes, it is moved to `completed`, `blocked`, or back to `todo`.

Keep workspace tasks durable and outcome-oriented. Keep execution steps specific to the current run. Do not create a permanent task for every shell command.

## Update during work

- Mark only the current step `in_progress`.
- Mark a step `completed` only after the related change and validation succeed.
- Mark a step `blocked` when external input, credentials, schema migration, or an unresolved failure is required.
- Record changed files and validation commands as execution evidence.
- Before changing a task that may have been edited in the web app, re-read it. If the user changed its status or title, do not overwrite it silently.

Useful commands:

```powershell
node scripts/learning-os-workspace.mjs serve --port 4317
node scripts/learning-os-workspace.mjs connect --code ABCD-EFGH-IJKL --cwd .
node scripts/learning-os-workspace.mjs disconnect --cwd .
node scripts/learning-os-workspace.mjs current --cwd .
node scripts/learning-os-workspace.mjs task list
node scripts/learning-os-workspace.mjs task create --title "Implement workspace connector" --priority high --source skill
node scripts/learning-os-workspace.mjs task update --id TASK_ID --status in_progress
node scripts/learning-os-workspace.mjs execution start --task TASK_ID --title "Implement workspace connector"
node scripts/learning-os-workspace.mjs step create --execution EXECUTION_ID --title "Add connector command surface"
node scripts/learning-os-workspace.mjs step update --id STEP_ID --status completed
node scripts/learning-os-workspace.mjs execution finish --id EXECUTION_ID --status completed
node scripts/learning-os-workspace.mjs evidence create --type command --title "Run validation" --content "npm.cmd run lint"
node scripts/learning-os-workspace.mjs evidence scan
node scripts/learning-os-workspace.mjs evidence list
node scripts/learning-os-workspace.mjs watch --interval 15000
node scripts/learning-os-workspace.mjs sync
```

## Connector role

The local connector is the local interface used by Codex and this Skill; it is not a chat transcript uploader and it is not the workspace web page itself.

- The web page pairing flow calls the local connector at http://127.0.0.1:4317; start it once with `node scripts/learning-os-workspace.mjs serve` before pairing. The flow authorizes a local project directory and stores connector configuration locally.
- When Codex operates inside a registered project directory, this Skill must call `current`, read `task list`, select or create the matching task, and start an `execution` linked to that task.
- Each meaningful planning step becomes a workspace execution step. The Skill updates step status as work progresses and finishes the execution with the actual outcome.
- Changed files, validation commands, and Git commit metadata are recorded as evidence metadata only; full conversations and file contents are not uploaded automatically.
- If `current` returns `workspace: null`, the Skill must say synchronization is unavailable and must not claim that a web workspace task was updated.
## Codex session synchronization

The connector matches the current Codex working directory to the registered workspace root. The Skill should select one existing workspace task for the current request, start an execution with `--task TASK_ID`, create execution steps from the confirmed plan, and update those steps as work progresses. This synchronizes task status, execution state, changed-file metadata, test commands, and Git evidence. It does not upload the full Codex conversation or tool transcript.

## Automatic Git evidence

Use `evidence scan` once or keep `watch` running in a separate terminal. The connector records commit hash, message, author, timestamp, and changed file paths as metadata; it never uploads file contents. When the network is unavailable, evidence is queued locally and `watch` retries the queue automatically.

## Safety boundaries

- Never upload file contents, full Codex conversations, or tool transcripts automatically.
- Store paths, filenames, Git commits, test commands, and explicit user-selected links as metadata only.
- Do not put Supabase service-role keys, OAuth secrets, or bearer tokens in connector config or skill files.
- Before pairing, the connector writes a local queue and must report that cloud synchronization is pending.
- After pairing, the connector attempts cloud writes first and queues failures for `sync`; a queued event is never reported as cloud-saved.
- A local queue is not a successful cloud save. State this clearly in the final handoff.

## Finish the task

Before handing back:

1. Update all execution steps with their final state.
2. Attach changed files and validation commands to the execution record.
3. Finish the execution as `completed`, `blocked`, or `cancelled`.
4. Update the parent task and the plan `next_action` only when the result justifies it.
5. Mention any queued, unsynced local events explicitly.


