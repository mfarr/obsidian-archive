# Simple Archiver for Obsidian

Simple Archiver moves a single file or an entire folder to an archive folder that you specify in the plugin's settings. The item is moved to the same relative path in the archive. If the base archive folder doesn't exist when you archive a file, it will be created automatically.

Archiving can be done via:

-   `Simple Archive: Move to archive` command
-   `Move to archive` file menu item

## Known Issues & Limitations

-   Archiving a file or folder that already exists at the same path in the archive will fail
-   Archive folder setting value is not checked for validity

## Planned Improvements

-   Archiving a folder that already exists in archive merges the contents
-   Unarchive
