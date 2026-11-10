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
      else new Notice(FALLBACK);
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

  // Shared by both modes. Returns "synced" | "missing" | "conflict" | "timeout".
  async waitAndSync(background) {
    const p = this.app.plugins?.plugins?.["git-vault-sync"];
    if (!p) return "missing";
    for (let i = 0; ; i++) {
      if (p.conflictActive) return "conflict";
      if (!p.syncing) break; // checked synchronously right before sync()
      if (i >= 150) return "timeout"; // 150 × 200 ms = 30 s
      await sleep(200);
    }
    // sync(true) is Git Vault Sync's silent auto-sync path: no notices, conflicts held instead of a modal.
    if (typeof p.sync === "function") await p.sync(background);
    else await this.app.commands.executeCommandById("git-vault-sync:sync");
    return "synced";
  }
};
