# Dictation Ready

Companion plugin for a dictation pipeline that syncs through [Git Vault Sync](https://github.com/heeeyMan/ObsSync) (`git-vault-sync`).

- **Mobile — "Mark ready & sync" command.** On a note directly in `Dictation/`, it saves the note, sets frontmatter `status: ready`, waits for any running Git Vault Sync sync to finish (up to 30 s), then syncs. If Git Vault Sync is missing, busy too long or has a conflict, the note stays `ready` and goes out with the next auto-sync. Add it to the mobile toolbar.
- **Desktop — auto-push.** When a file is created or modified under `Dictation/Completed/`, it waits 2 s (debounced) and runs one Git Vault Sync sync silently, so cleaned notes reach the remote right away.

It relies on Git Vault Sync's undocumented `syncing`, `conflictActive` and `sync()` fields; if those change, the regular auto-sync still delivers everything.

## Install (BRAT)

1. Install and enable the **BRAT** community plugin.
2. BRAT → "Add beta plugin" → `SomewhatMay/obsidian-dictation-ready`.
3. Enable **Dictation Ready** under Community plugins.

## Test

```
node --test
```

No dependencies; the test mocks the `obsidian` module and Git Vault Sync.
