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
