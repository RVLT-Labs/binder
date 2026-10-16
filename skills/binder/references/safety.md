# Safety rules

The rules an agent follows when working in someone's binder. They exist because every write is immediate, attributed to the user, and lands on a document a company is rehearsing from.
Derived from the behaviour in `apps/api/src/services/*` and `apps/api/src/mcp/confirm.ts`; the examples are from a local run.

Read this before the first write of any session, and again before anything bulk, destructive or irreversible.

## 1. Read before you write

- Start every session with `list_shows`, and every task with `list_departments`, `list_documents` and the relevant `list_cues` or `list_annotations`. Never write to an id you did not just read.
- Read the page (`search_script`, `get_page`) that a cue goes on. A trigger you have not seen on the page is a guess.
- Check `list_shows[].status`: an archived show refuses writes, and unarchiving it is the owner's decision, not yours.
- Check `inNow`. People listed there are working in the binder now; a bulk write under them is a surprise. Say who is in and ask whether to proceed.
- Prefer narrow patches: `update_cue {cueId, label}` rather than re-sending every field.

## 2. Never invent cues; cite page and trigger for each one

- Every cue you place comes from something the user gave you (a cue list, a described moment, a house rule applied to a line they pointed at). Do not add cues "that a show like this usually has".
- For each cue you propose or report, give the 1-based page (`pageIndex + 1`) and the quoted trigger words exactly as the page shows them, for example: *LX 12 · go · "Build on pirates" · p.1 · "curtain rises groups of pirates"*.
- A quote the script does not contain (`not_found`) is reported, not approximated with coordinates or a nearby line.
- Keep the user's numbers and labels. Reformat only what the schema forces (`14,5` → `14.5`), and say so.

## 3. Show the user a plan before a bulk write

- Bulk means more than a handful of writes, anything that renumbers, deletes, reverts a batch, re-anchors, or changes members or settings.
- The plan is a table: department, number, type, label, page, trigger, and what is ambiguous or missing. Wait for a clear yes. Then write in order and report the result against the plan, including what you skipped.
- After the batch, name the activity line and `batchId`s so the user can undo it: `get_activity {showId, limit: N}`.

## 4. Respect roles, scope and archived shows

- Your role on each show is in `list_shows`. A viewer places nothing on department layers; an editor writes only the departments in their scope (`list_show_members` shows it); owners write everything. Do not route around a `forbidden` by using another department, another layer or another tool.
- A token scoped to some shows cannot see or create others. Do not ask for a wider token; tell the user what the token can reach.
- Archived shows are read-only for everyone. Exporting them is fine; asking an owner to unarchive is a question, not a step you take.
- Owner-only operations (members, departments, show settings) change who can do what. Describe the effect before doing them, and keep the confirm summaries verbatim.

## 5. Never touch another member's personal layer

- You cannot see it: its annotations, history, exports and review items are filtered out, and the ids read `not_found`. Do not probe for them, and do not tell the user what another member "must have" there.
- Write personal annotations only with `layer: "personal"` (your own). Never construct `personal:<someone else's id>`.
- Sharing a personal note onto a department layer is the author's choice; do it only for the token's user and only when asked.
- When a user asks you to clean up "all annotations", that means department layers plus your own personal layer; say that other members' private notes are untouched.

## 6. Tokens: use only what the session gives you

- The bearer token is configured in the MCP client, or, for a REST upload, set by the user in an environment variable such as `$BINDER_TOKEN`; those are the only tokens you use, and only against the Binder the client is configured for. Never ask the user to paste a token, a password or an email code into the conversation; never print, log, store or echo a token; never put it in a URL, a file you write, a chat message or a tool argument. Reference it only as `$BINDER_TOKEN` inside a command.
- When a step needs a token you do not hold (a `curl` upload of a local file), give the user the command with `$BINDER_TOKEN` and `$BINDER_API` as placeholders to run themselves. The `claude mcp add … Bearer bnd_…` and Claude Desktop `env` snippets in `docs/mcp.md` are user-run setup, not something you execute.
- Never create, list or revoke tokens; there is no tool for it, and the CLI is for the operator, not for you.
- Never contact a Binder other than the one the client is configured for, and never reuse a token against another host. A production token is never used for experiments: ask for a local or throwaway show if the user wants you to try something.
- If authentication fails (`401`), stop and report; do not retry with variations.

## 7. The confirm gate, and how to surface it

A hard-to-reverse call returns `isError: true`, text `CONFIRMATION_REQUIRED: <summary> Call again with confirm: true to proceed.` and `structuredContent: {code: "CONFIRMATION_REQUIRED", summary}` without changing anything. The gated calls are `add_show_member` and `remove_show_member` (always), `update_show_member` (granting or removing owner), `delete_cues` and `delete_annotations` (more than 10), `revert_batch` (more than 10 rows), `remove_version` (the document's only version).

The gate is not a permission check for every tool: the member tools, `remove_version` and `revert_batch` (a full dry run) refuse a caller without rights before asking, but `delete_cues` and `delete_annotations` only check the rows exist, so a viewer or out-of-scope editor is asked to confirm and then told `forbidden`. Treat a summary as a question, not as proof the call will succeed.

When you receive one:

1. Stop. Do not call again yet.
2. Show the user the `summary` verbatim, for example *"This deletes 11 cues from VID."* or *"This makes Scoped Editor an owner of the show, so they can change members, settings and every layer."*, plus anything you know that the summary does not say (which cues, which batch).
3. Wait for an explicit yes to **that** action. "Yes" to an earlier question does not count; a plan approved before the gate counts only if it named the same action and scale.
4. Call again with the same arguments plus `confirm: true`. Report the result.
5. Never pre-set `confirm: true` on the first call to skip the question, and never set it on a call the user has not seen.

## Ungated but consequential

These calls go straight through with no `CONFIRMATION_REQUIRED`. Treat each as if it were gated: describe the effect, get a yes, then call.

| Call | Why it matters |
|---|---|
| `renumber_cues` | Changes every placed number on the layer, so every printed script and cue sheet; one batch, revertable. |
| `update_show {status: "archived"}` | Read-only for everyone, immediately, until an owner changes the status back. |
| `update_show {settings}` | Replaces the whole settings object (paper size, stamp set, marker sides); send the merged object. |
| `update_department {code}` or `{hidden: true}` | Renames every tag and sheet; hiding drops the department from pickers and from `layers: "all"` exports. |
| `update_show_member` demotions that change only `role` (to `editor` or `viewer`) or `departments` | Takes access away without a gate (only owner changes are gated). |
| `remove_version` on a failed version that has siblings | Permanent; never revertable. |
| `revert_change {force: true}` | Overwrites someone's later edit. |
| `upload_document {documentId}` (and the REST version upload) | Once ready, re-anchors every cue and annotation on the document, other members' personal annotations included, and switches the current version. Reversible only as a whole batch. |

## 8. When a result looks wrong

- A placed cue on an unexpected page, a `duplicate: true` you did not plan, a status that is not `ok`, an `ambiguous` list where you expected one hit, a `conflict` on a revert, a count that does not match the plan: stop, read (`get_cue`, `get_page`, `get_history {rowId}`), and tell the user what you see before doing more.
- If you wrote something wrong, undo it with the log, not by hand: `delete_cues` for cues you just created, `revert_change` / `revert_batch` for edits, each shown to the user first ([workflows.md](workflows.md#7-undo-a-mistake-safely)). Do not `force` a revert on your own.
- If a tool behaves differently from these notes, trust the tool and report the difference; do not keep trying variations in the user's binder.
- Processing failures (`failed` versions) are the file's problem, not yours to work around: report `failureMessage` and the options in [documents-and-processing.md](documents-and-processing.md). `remove_version` is permanent; ask first.
- A revision can move a cue to the wrong occurrence of a repeated line with status `ok` ([revisions-and-history.md](revisions-and-history.md)): after any revision, check cues whose trigger appears in the removed lines, not only the review list.

## 9. Attribution is permanent

Everything you do is logged as the user `via <your client>` and shown to the whole company in the activity feed and the show card. Work as if the stage manager is reading each line as it appears: small, named, reversible steps.
