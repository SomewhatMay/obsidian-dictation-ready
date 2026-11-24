# Dictation Ready

Companion plugin for a dictation pipeline that syncs through [Git Vault Sync](https://github.com/heeeyMan/ObsSync) (`git-vault-sync`).

**Folder and marker.** Dictation notes live directly in the vault's `00 Inbox/` folder (the `INBOX` constant in `main.js`), next to your other inbox notes. Because those may have their own `status`, dictation notes carry the frontmatter marker `dictation: true`; the cleanup agent and the desktop auto-push only act on notes that have it.

- **"New dictation note" command.** Creates `00 Inbox/<YYYYMMDDHHmm>.md` (adding `-2`, `-3`… if the name is taken) with frontmatter `status: drafting`, `dictation: true` and `created`, creates `00 Inbox/` if needed, and opens it. You can rename notes afterwards; the plugin only cares about the folder and the marker.
- **Mobile — "Mark ready & sync" command.** On a note directly in `00 Inbox/` (anywhere else it only shows a notice), it saves the note, sets frontmatter `status: ready` and `dictation: true`, waits for any running Git Vault Sync sync to finish (up to 30 s), then syncs. If Git Vault Sync is missing, busy too long or has a conflict, the note stays `ready` and goes out with the next auto-sync.
- **Retries.** Syncs run silently and the plugin checks the real outcome. A failed sync (network error, GitHub 5xx, another device pushing at the same time) is retried up to 3 more times, 5 s apart; auth errors (401/403, token) are not retried. On mobile you see "Sync failed — retrying (n/3)…" and, if it still fails, the error with "will retry on next auto-sync". On desktop retries only go to the console.
- **Desktop — auto-push.** When a note directly in `00 Inbox/` with `dictation: true` changes and its frontmatter `status` is `done` or `failed` (including changes made outside Obsidian, such as by the cleanup agent), it waits 2 s (debounced) and runs one Git Vault Sync sync silently, so finished notes reach the remote right away. Pulling in a done note triggers one extra, harmless sync.

**Re-run a note:** set `status: ready` again (or tap "Mark ready & sync"); keep `dictation: true`.

**Migrating from `Dictation/` (0.3.x):** existing notes need no change. A note that was still `ready` before the move is only picked up once it has `dictation: true`: add it by hand or tap "Mark ready & sync" on it.

**Mobile toolbar tip:** add "New dictation note" and "Mark ready & sync" to the mobile toolbar. You no longer need the Unique note creator core plugin for dictation notes.

It relies on Git Vault Sync's undocumented `syncing`, `conflictActive`, `sync()`, `lastSyncError`, `lastError` and `settings.lastSyncAt` fields; if those change, the regular auto-sync still delivers everything.

## Install (BRAT)

1. Install and enable the **BRAT** community plugin.
2. BRAT → "Add beta plugin" → `SomewhatMay/obsidian-dictation-ready`.
3. Enable **Dictation Ready** under Community plugins.

## Test

```
node --test --test-timeout=10000
```

No dependencies; the test mocks the `obsidian` module and Git Vault Sync.
