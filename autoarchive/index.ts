/**
 * Auto-Archive Module Barrel Export
 *
 * This file consolidates all public APIs from the auto-archive subsystem,
 * allowing main.ts to import everything via a single import statement.
 */

export {
	AUTO_ARCHIVE_DEFAULT_SETTINGS,
	AUTO_ARCHIVE_DEFAULT_RUNTIME_DATA,
	migrateAutoArchiveSettings,
	normalizeAutoArchiveRuntimeData,
} from "./AutoArchiveSettings";

export {
	createAutoArchiveService,
	startAutoArchive,
	stopAutoArchiveScheduler,
} from "./AutoArchiveLifecycle";

export { setupAutoArchiveContextMenu } from "./AutoArchiveContextMenu";

export { AutoArchiveService } from "./AutoArchiveService";

export type {
	ArchiveResult,
	AutoArchiveRuntimeData,
	AutoArchiveCondition,
	AutoArchiveRule,
	SimpleArchiverSettings,
} from "./AutoArchiveTypes";
