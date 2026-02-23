import type {
	AutoArchiveRule,
	SimpleArchiverSettings,
} from "./AutoArchiveTypes";

/**
 * Default settings for auto-archive functionality.
 * These are composed into the plugin's overall DEFAULT_SETTINGS.
 */
export const AUTO_ARCHIVE_DEFAULT_SETTINGS: Partial<SimpleArchiverSettings> = {
	autoArchiveRules: [],
	autoArchiveFrequency: 60,
	autoArchiveStartupDelaySeconds: 30,
	lastAutoArchiveRunAt: 0,
};

/**
 * Migrates auto-archive settings from loaded data, ensuring backward compatibility
 * and normalizing all required fields to safe defaults.
 *
 * @param settings The loaded settings object (may be partial from old configs)
 * @returns Object with normalized settings and a flag indicating if changes were made
 */
export function migrateAutoArchiveSettings(settings: SimpleArchiverSettings): {
	settings: SimpleArchiverSettings;
	changed: boolean;
} {
	let changed = false;

	// Migrate per-rule defaults
	if (settings.autoArchiveRules) {
		settings.autoArchiveRules = settings.autoArchiveRules.map((rule) => {
			const updates: Partial<AutoArchiveRule> = {};

			if (!rule.logicOperator) {
				changed = true;
				updates.logicOperator = "AND" as "AND" | "OR";
			}

			if (rule.useFolderRegex === undefined) {
				changed = true;
				updates.useFolderRegex = false;
			}

			if (rule.applyRecursively === undefined) {
				changed = true;
				updates.applyRecursively = false;
			}

			return { ...rule, ...updates };
		});
	}

	// Normalize startup delay seconds
	if (
		!Number.isFinite(settings.autoArchiveStartupDelaySeconds) ||
		settings.autoArchiveStartupDelaySeconds < 0
	) {
		changed = true;
		settings.autoArchiveStartupDelaySeconds =
			AUTO_ARCHIVE_DEFAULT_SETTINGS.autoArchiveStartupDelaySeconds ?? 30;
	}

	// Normalize last auto-archive run timestamp
	if (
		!Number.isFinite(settings.lastAutoArchiveRunAt) ||
		settings.lastAutoArchiveRunAt < 0
	) {
		changed = true;
		settings.lastAutoArchiveRunAt =
			AUTO_ARCHIVE_DEFAULT_SETTINGS.lastAutoArchiveRunAt ?? 0;
	}

	return { settings, changed };
}
