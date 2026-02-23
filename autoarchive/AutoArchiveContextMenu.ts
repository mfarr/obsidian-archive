import { Workspace } from "obsidian";

import { AutoArchiveService } from "./AutoArchiveService";
import type SimpleArchiver from "../main";

/**
 * Bootstraps the auto-archive context menu UI.
 *
 * Registers folder context menu items that allow users to add, edit,
 * and manage auto-archive rules at the folder level.
 *
 * @param service The AutoArchiveService instance
 * @param workspace The Obsidian Workspace instance
 * @param plugin The SimpleArchiver plugin instance
 */
export function setupAutoArchiveContextMenu(
	service: AutoArchiveService,
	workspace: Workspace,
	plugin: SimpleArchiver,
): void {
	service.setupContextMenu(workspace, plugin);
}
