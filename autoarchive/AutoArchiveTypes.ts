export interface AutoArchiveCondition {
	type: "fileAge" | "regexPattern";
	value: string;
}

export interface AutoArchiveRule {
	id: string;
	enabled: boolean;
	folderPath: string;
	useFolderRegex: boolean;
	applyRecursively: boolean;
	conditions: AutoArchiveCondition[];
	logicOperator: "AND" | "OR";
}

export interface SimpleArchiverSettings {
	archiveFolder: string;
	autoArchiveRules: AutoArchiveRule[];
	autoArchiveFrequency: number;
	autoArchiveStartupDelaySeconds: number;
	lastAutoArchiveRunAt: number;
}

export interface ArchiveResult {
	success: boolean;
	message: string;
}

/**
 * Interface for Obsidian's internal settings API.
 * Used for type-safe access to settings functionality.
 */
export interface ObsidianInternalApis {
	setting: {
		open(): void;
		openTabById(pluginId: string): void;
		pluginTabs: unknown[];
	};
}
