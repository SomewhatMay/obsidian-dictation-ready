const { Plugin, MarkdownView, Notice, Platform } = require("obsidian");

const FALLBACK = "Marked ready; will sync on next auto-sync";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = class DictationReadyPlugin extends Plugin {
  onload() {
    this.timer = null;
    this.addCommand({
      id: "mark-ready-and-sync",
      name: "Mark ready & sync",
      icon: "send",
      callback: () => this.markReady(),
    });
    this.addCommand({
      id: "new-dictation-note",
      name: "New dictation note",
      icon: "mic",
      callback: () => this.newNote(),
    });

    if (Platform.isDesktopApp) {
      // Before layout-ready, events fire for every file as the vault loads.
      this.app.workspace.onLayoutReady(() => {
        // "changed" fires after parsing (so status is current), also for files changed outside Obsidian.
        this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => {
          const status = cache?.frontmatter?.status;
          if (file.parent?.path === "Dictation" && file.extension === "md" && (status === "done" || status === "failed")) {
            this.schedulePush();
          }
        }));
      });
    }
  }

  onunload() {
    clearTimeout(this.timer);
  }

  async markReady() {
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!file || file.parent?.path !== "Dictation") {
        new Notice("Dictation Ready: open a note in Dictation/ first");
        return;
      }
      await view.save();
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = "ready";
      });
      await sleep(400); // inferred settle time after the disk write; tune on device
      const result = await this.waitAndSync(false);
      if (result === "synced") new Notice(`Ready: ${file.basename} — synced`);
      else if (result === "conflict") new Notice("Marked ready; Git Vault Sync has a conflict to resolve first");
      else if (result !== "failed") new Notice(FALLBACK); // "failed" already showed its own notice
    } catch (e) {
      new Notice(`Dictation Ready error: ${e?.message ?? e}`);
    }
  }

  // Creates Dictation/<YYYYMMDDHHmm>.md (-2, -3… on collision) and opens it.
  async newNote() {
    try {
      const { vault, workspace } = this.app;
      const now = window.moment();
      if (!vault.getAbstractFileByPath("Dictation")) await vault.createFolder("Dictation");
      const base = `Dictation/${now.format("YYYYMMDDHHmm")}`;
      let p = `${base}.md`;
      for (let n = 2; vault.getAbstractFileByPath(p); n++) p = `${base}-${n}.md`;
      const file = await vault.create(p, `---
status: drafting
created: "${now.format("YYYY-MM-DD HH:mm")}"
---

`);
      await workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Dictation Ready error: ${e?.message ?? e}`);
    }
  }

  // Desktop: one sync 2 s after the last done/failed Dictation/ note change, silently.
  schedulePush() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        const result = await this.waitAndSync(true);
        if (result !== "synced") console.log(`Dictation Ready: push skipped (${result}); auto-sync will handle it`);
      } catch (e) {
        console.error("Dictation Ready: push failed", e);
      }
    }, 2000);
  }

  // Shared by both modes. Returns "synced" | "missing" | "conflict" | "timeout" | "skipped" | "failed".
  // Always syncs silently; on mobile (!background) this plugin shows the notices instead.
  async waitAndSync(background) {
    const p = this.app.plugins?.plugins?.["git-vault-sync"];
    if (!p) return "missing";
    for (let attempt = 0; ; attempt++) {
      for (let i = 0; ; i++) {
        if (p.conflictActive) return "conflict";
        if (!p.syncing) break; // checked synchronously right before sync()
        if (i >= 150) return "timeout"; // 150 × 200 ms = 30 s
        await sleep(200);
      }
      if (typeof p.sync !== "function") {
        await this.app.commands.executeCommandById("git-vault-sync:sync");
        return "synced"; // outcome unknown
      }
      const before = p.settings?.lastSyncAt ?? 0;
      const t0 = Date.now();
      await p.sync(true); // never throws; reports via lastSyncAt / lastSyncError / lastError
      if (p.conflictActive) return "conflict";
      if ((p.settings?.lastSyncAt ?? 0) > before) return "synced";
      const err = p.lastError;
      if (!(p.lastSyncError && err?.when >= t0)) return "skipped"; // busy / not configured no-op
      const auth = /401|403|token|auth/i.test(`${err.message} ${err.detail}`);
      if (auth || attempt >= 3) {
        const msg = `Sync failed: ${err.message} — will retry on next auto-sync`;
        if (background) console.log(`Dictation Ready: ${msg}`);
        else new Notice(msg);
        return "failed";
      }
      if (background) console.log(`Dictation Ready: sync failed (${err.message}), retrying (${attempt + 1}/3)`);
      else new Notice(`Sync failed — retrying (${attempt + 1}/3)…`);
      await sleep(5000);
    }
  }
};
