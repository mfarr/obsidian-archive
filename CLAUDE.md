# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Development build with watch mode (esbuild)
npm run build      # Type-check (tsc --noEmit) + production bundle
npm run version    # Bump version, updates manifest.json and versions.json
```

No test runner is configured. Linting is via ESLint (`npx eslint .`).

## Architecture

This is an **Obsidian plugin** ("Simple Archiver") that moves notes and folders to a configurable archive folder, with an optional auto-archive feature that runs rules on a schedule.

### Core Modules

**`main.ts`** — Plugin entry point (`SimpleArchiverPlugin extends Plugin`). Owns:
- Settings load/save via Obsidian's `loadData()`/`saveData()`
- Command registration (`move-to-archive`, `move-out-of-archive`)
- Context menu items for files and folders
- Core `archiveFile()` / `unarchiveFile()` logic (conflict resolution, path normalization)

**`autoarchive/`** — Auto-archive subsystem:
- `AutoArchiveService.ts` — Rule evaluation engine and scheduler. Uses `setInterval()` for periodic runs, `setTimeout()` for startup delay. Evaluates conditions (file age, filename regex) with AND/OR logic. Rate-limited to 500 files/cycle. Regex patterns validated with 100ms timeout to prevent ReDoS.
- `AutoArchiveTypes.ts` — Type definitions (`AutoArchiveRule`, `AutoArchiveCondition`, `SimpleArchiverSettings`, `ArchiveResult`)
- `AutoArchiveSettings.ts` — Default settings and backward-compatibility migrations
- `AutoArchiveLifecycle.ts` — Factory functions for creating/controlling the service
- `index.ts` — Barrel export

**`SettingsTab.ts`** — Tabbed settings UI (General tab: archive folder config; Auto-Archive tab: schedule and rule management).

**`modals.ts`** — `SimpleArchiverPromptModal` (yes/no confirmations) and `AutoArchiveRuleModal` (rule editor with validation).

### Data Flow

```
User command/menu → archiveFile() → conflict check → Obsidian vault.rename() → saveSettings()

Scheduler → AutoArchiveService.processAutoArchiveRules()
  → enabled rules → matching folders → evaluate conditions → archiveFile()
```

### Build Output

esbuild bundles `main.ts` → `main.js`. Obsidian, Electron, and all `@codemirror/*` / `@lezer/*` packages are marked external (provided by Obsidian at runtime).

### Plugin Manifest

`manifest.json` and `versions.json` track plugin versioning for the Obsidian plugin marketplace. The release workflow (`.github/workflows/release.yml`) auto-creates GitHub releases when version tags are pushed.

## Community Plugin Listing

https://community.obsidian.md/plugins/simple-archiver
