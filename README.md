# Simple Archiver for Obsidian

> _Move old, stinky notes and folders to an archive, where they belong!_

Simple Archiver moves files or an entire folder to an archive folder that you configure. The items are moved to the same relative path in the archive folder. Conversely, items that have been archived can be moved out of the archive to their original location.

Archiving can be done via:

- `Simple Archive: Move to archive` command
- `Move to archive` file menu item
- `Move all to archive` multi-file menu item

Unarchiving can be done via:

- `Move out of archive` file menu item
- `Move all out of archive` multi-file menu item

## Auto-Archive

Auto-archive lets you define rules that periodically move matching files into your archive folder. Each rule targets a folder (optionally by regex), can include subfolders, and requires at least one condition. Conditions can be based on file age (days since last modified) and/or a file name regex. When a rule matches, files are archived to the same relative path under your archive folder.

How it works:

- Rules are evaluated on a schedule (default every 60 minutes).
- The last auto-archive run time is saved, so short Obsidian sessions can still trigger catch-up runs on startup.
- On startup, auto-archive waits for a configurable delay (default 30 seconds) before checking whether a run is due.
- Multiple conditions can be combined with AND or OR.
- Files already in the archive folder are skipped.

How to use it:

- Open Settings -> Simple Archiver -> Auto-Archive.
- Set the auto-archive frequency and startup delay, and optionally click "Auto Archive Now" to run immediately.
- Click "Add Rule", choose a folder path (or enable regex), decide whether to apply recursively, and add one or more conditions.
- Optional: Right-click a folder and choose "Auto-archive" -> "Add rule" to prefill the folder path.
- Optional: Right-click a folder and choose "Auto-archive" -> "Edit rule" to edit an existing rule.

Example rule:

```text
Folder: Notes/Daily
Apply recursively: No
Conditions (AND):
  - File age >= 30 days
  - File name regex: ^\d{4}-\d{2}-\d{2}.*\.md$
```

## Planned Improvements

- Archiving a folder that already exists in the archive merges the contents
- Archiving a file that already exists in the archive gives the option to rename

## Contributing

Contributions to this repo are welcome, **but**, please reach out by submitting an issue before submitting a massive PR for a feature that I might not be interested in maintaining.

### AI Contributions

AI-assisted contributions will be considered with discretion. Obviously vibe-coded contributions will receive little of my time and less of my patience.

### Contributors

- [nicholaslck](https://github.com/nicholaslck)
- [ggfevans](https://github.com/ggfevans)

## Release Notes

### v0.5.2

- **Fix**: Resolve issue when archiving files from folders with leading 0s. Thanks [ggfevans](https://github.com/ggfevans)!

### v0.5.1

- **New**: Add `Move out of archive` functionality to files/folders that exist in the archive. Items will be moved out of the archive into their original location (issue #5). Thank you to [nicholaslck](https://github.com/nicholaslck)!

### v0.4.0

- **New**: Add "replace" option when attempting to archive a file or folder when an item with the same name and path already exists in the archive.

### v0.3.1

- **Fix**: Unable to archive files/folders in the vault root

### v0.3.1

- **New**: Validate archive folder name setting before saving

### v0.2.0

- **New**: Allow multiple files to be archived

### v0.1.0

- **New**: Basic archive functionality
