import { App, TAbstractFile } from "obsidian";

import { AutoArchiveService } from "./AutoArchiveService";
import type { ArchiveResult, SimpleArchiverSettings } from "./AutoArchiveTypes";

/**
 * Factory function to create and configure an AutoArchiveService instance.
 *
 * Encapsulates the complex wiring of dependencies (settings getter, archive callbacks, etc.)
 * that the service needs to function.
 *
 * @param app Obsidian App instance
 * @param getSettings Getter function to retrieve current plugin settings
 * @param archiveFile Callback to archive a file
 * @param isFileArchived Callback to check if a file is already archived
 * @param persistLastRunAt Callback to persist the last auto-archive run timestamp
 * @returns Configured AutoArchiveService instance
 */
export function createAutoArchiveService(
	app: App,
	getSettings: () => SimpleArchiverSettings,
	archiveFile: (file: TAbstractFile) => Promise<ArchiveResult>,
	isFileArchived: (file: TAbstractFile) => boolean,
	persistLastRunAt: (lastRunAt: number) => Promise<void>,
): AutoArchiveService {
	return new AutoArchiveService(
		app,
		getSettings,
		archiveFile,
		isFileArchived,
		persistLastRunAt,
	);
}

/**
 * Starts the auto-archive scheduler.
 *
 * Invokes both the startup-delay check (which may run immediately if conditions are met)
 * and the recurring interval schedule.
 *
 * @param service The AutoArchiveService instance
 */
export function startAutoArchive(service: AutoArchiveService): void {
	service.scheduleStartupAutoArchiveCheck();
	service.scheduleAutoArchive();
}

/**
 * Stops the auto-archive scheduler.
 *
 * Clears all pending timers and intervals.
 *
 * @param service The AutoArchiveService instance
 */
export function stopAutoArchiveScheduler(service: AutoArchiveService): void {
	service.stopAutoArchive();
}
