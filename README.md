# Dictation Ready

Companion plugin for a dictation pipeline that syncs through [Git Vault Sync](https://github.com/heeeyMan/ObsSync) (`git-vault-sync`).

- **Mobile — "Mark ready & sync" command.** On a note directly in `Dictation/`, it saves the note, sets frontmatter `status: ready`, waits for any running Git Vault Sync sync to finish (up to 30 s), then syncs. If Git Vault Sync is missing, busy too long or has a conflict, the note stays `ready` and goes out with the next auto-sync. Add it to the mobile toolbar.
- **Desktop — auto-push.** When a note directly in `Dictation/` changes and its frontmatter `status` is `done` or `failed` (including changes made outside Obsidian, such as by the cleanup agent), it waits 2 s (debounced) and runs one Git Vault Sync sync silently, so finished notes reach the remote right away. Pulling in a done note triggers one extra, harmless sync.

It relies on Git Vault Sync's undocumented `syncing`, `conflictActive` and `sync()` fields; if those change, the regular auto-sync still delivers everything.

## Install (BRAT)

1. Install and enable the **BRAT** community plugin.
2. BRAT → "Add beta plugin" → `SomewhatMay/obsidian-dictation-ready`.
3. Enable **Dictation Ready** under Community plugins.

## Test

```
node --test --test-timeout=5000
```

No dependencies; the test mocks the `obsidian` module and Git Vault Sync.
