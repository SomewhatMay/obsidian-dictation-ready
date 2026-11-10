# Dictation Ready

Companion plugin for a dictation pipeline that syncs through [Git Vault Sync](https://github.com/heeeyMan/ObsSync) (`git-vault-sync`).

- **"New dictation note" command.** Creates `Dictation/<YYYYMMDDHHmm>.md` (adding `-2`, `-3`… if the name is taken) with frontmatter `status: drafting` and `created`, creates `Dictation/` if needed, and opens it. You can rename notes afterwards; the plugin only cares about the folder.
- **Mobile — "Mark ready & sync" command.** On a note directly in `Dictation/` (anywhere else it only shows a notice), it saves the note, sets frontmatter `status: ready`, waits for any running Git Vault Sync sync to finish (up to 30 s), then syncs. If Git Vault Sync is missing, busy too long or has a conflict, the note stays `ready` and goes out with the next auto-sync.
- **Retries.** Syncs run silently and the plugin checks the real outcome. A failed sync (network error, GitHub 5xx, another device pushing at the same time) is retried up to 3 more times, 5 s apart; auth errors (401/403, token) are not retried. On mobile you see "Sync failed — retrying (n/3)…" and, if it still fails, the error with "will retry on next auto-sync". On desktop retries only go to the console.
- **Desktop — auto-push.** When a note directly in `Dictation/` changes and its frontmatter `status` is `done` or `failed` (including changes made outside Obsidian, such as by the cleanup agent), it waits 2 s (debounced) and runs one Git Vault Sync sync silently, so finished notes reach the remote right away. Pulling in a done note triggers one extra, harmless sync.

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
