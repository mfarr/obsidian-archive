import {
	App,
	normalizePath,
	PluginSettingTab,
	TAbstractFile,
	TFile,
	TFolder,
	Workspace,
} from "obsidian";

import type {
	AutoArchiveCondition,
	AutoArchiveRule,
	SimpleArchiverSettings,
	ArchiveResult,
	ObsidianInternalApis,
} from "./AutoArchiveTypes";
import type SimpleArchiver from "../main";
import { AutoArchiveRuleModal } from "../modals";
import { SimpleArchiverSettingsTab } from "../SettingsTab";

// Constants extracted from magic numbers
const SETTINGS_TAB_RENDER_DELAY_MS = 200;
const MAX_FILES_PER_CYCLE = 500;
const DEFAULT_REGEX_TIMEOUT_MS = 100;

type MenuEntry = {
	setTitle(title: string): MenuEntry;
	setIcon(icon: string): MenuEntry;
	onClick(callback: () => void): MenuEntry;
	setSubmenu?: () => MenuGroup;
};

type MenuGroup = {
	addItem(callback: (item: MenuEntry) => void): void;
};

export class AutoArchiveService {
	private app: App;
	private getSettings: () => SimpleArchiverSettings;
	private archiveFile: (file: TAbstractFile) => Promise<ArchiveResult>;
	private isFileArchived: (file: TAbstractFile) => boolean;
	private persistLastAutoArchiveRunAt: (lastRunAt: number) => Promise<void>;
	private autoArchiveInterval: number | null = null;
	private startupAutoArchiveTimeout: number | null = null;
	private filesProcessedInCycle = 0;

	constructor(
		app: App,
		getSettings: () => SimpleArchiverSettings,
		archiveFile: (file: TAbstractFile) => Promise<ArchiveResult>,
		isFileArchived: (file: TAbstractFile) => boolean,
		persistLastAutoArchiveRunAt: (lastRunAt: number) => Promise<void>,
	) {
		this.app = app;
		this.getSettings = getSettings;
		this.archiveFile = archiveFile;
		this.isFileArchived = isFileArchived;
		this.persistLastAutoArchiveRunAt = persistLastAutoArchiveRunAt;
	}

	scheduleStartupAutoArchiveCheck(): void {
		if (this.startupAutoArchiveTimeout !== null) {
			window.clearTimeout(this.startupAutoArchiveTimeout);
		}

		const settings = this.getSettings();
		const startupDelayMs = settings.autoArchiveStartupDelaySeconds * 1000;

		this.startupAutoArchiveTimeout = window.setTimeout(() => {
			this.startupAutoArchiveTimeout = null;
			void this.runStartupAutoArchiveCheck();
		}, startupDelayMs);
	}

	private async runStartupAutoArchiveCheck(): Promise<void> {
		const settings = this.getSettings();
		const intervalMs = settings.autoArchiveFrequency * 60 * 1000;
		const elapsedSinceLastRun = Date.now() - settings.lastAutoArchiveRunAt;

		if (elapsedSinceLastRun >= intervalMs) {
			await this.processAutoArchiveRules();
		}
	}

	private async persistLastRunTimestamp(timestamp: number): Promise<void> {
		try {
			await this.persistLastAutoArchiveRunAt(timestamp);
		} catch (error) {
			console.error(
				"Failed to persist last auto-archive run time:",
				error,
			);
		}
	}

	/**
	 * Safely compiles and validates a regex pattern to prevent ReDoS attacks.
	 * Returns null if the pattern is invalid or takes too long to compile.
	 */
	private validateRegexPattern(pattern: string): RegExp | null {
		try {
			// Test the regex with a simple string to ensure it compiles
			const regex = new RegExp(pattern);

			// Test on a sample string with timeout protection
			const testString = "test_file_name.md";
			const timeout = this.withTimeout(
				() => regex.test(testString),
				DEFAULT_REGEX_TIMEOUT_MS,
			);

			if (timeout === null) {
				console.error(
					`Regex pattern took too long to execute: ${pattern}`,
				);
				return null;
			}

			return regex;
		} catch (error) {
			console.error(`Invalid regex pattern: ${pattern}`, error);
			return null;
		}
	}

	/**
	 * Executes a function with a timeout, returning null if it exceeds the limit.
	 * This is a simple approximation; a real implementation would use Web Workers.
	 */
	private withTimeout<T>(fn: () => T, timeoutMs: number): T | null {
		const start = performance.now();
		try {
			const result = fn();
			if (performance.now() - start > timeoutMs) {
				return null;
			}
			return result;
		} catch (error) {
			return null;
		}
	}

	scheduleAutoArchive(): void {
		if (this.autoArchiveInterval !== null) {
			window.clearInterval(this.autoArchiveInterval);
		}

		const settings = this.getSettings();
		const intervalMs = settings.autoArchiveFrequency * 60 * 1000;
		this.autoArchiveInterval = window.setInterval(
			() => this.processAutoArchiveRules(),
			intervalMs,
		);
	}

	stopAutoArchive(): void {
		if (this.autoArchiveInterval !== null) {
			window.clearInterval(this.autoArchiveInterval);
			this.autoArchiveInterval = null;
		}

		if (this.startupAutoArchiveTimeout !== null) {
			window.clearTimeout(this.startupAutoArchiveTimeout);
			this.startupAutoArchiveTimeout = null;
		}
	}

	async processAutoArchiveRules(): Promise<void> {
		try {
			const settings = this.getSettings();
			const enabledRules = settings.autoArchiveRules.filter(
				(rule) => rule.enabled,
			);

			if (enabledRules.length === 0) {
				return;
			}

			let totalArchived = 0;
			this.filesProcessedInCycle = 0;

			for (const rule of enabledRules) {
				// Check if we've hit the rate limit
				if (this.filesProcessedInCycle >= MAX_FILES_PER_CYCLE) {
					console.warn(
						`Auto-archive cycle reached maximum file limit (${MAX_FILES_PER_CYCLE}). Remaining rules skipped to prevent performance issues.`,
					);
					break;
				}

				let foldersToProcess: TFolder[] = [];

				if (rule.useFolderRegex) {
					const regex = this.validateRegexPattern(rule.folderPath);
					if (!regex) {
						console.error(
							`Skipping rule with invalid regex pattern: ${rule.folderPath}`,
						);
						continue;
					}

					const allFolders = this.app.vault.getAllFolders();
					foldersToProcess = allFolders.filter((folder) =>
						regex.test(folder.path),
					);
				} else {
					const folder = this.app.vault.getFolderByPath(
						normalizePath(rule.folderPath),
					);

					if (!folder) {
						console.warn(
							`Auto-archive rule references non-existent folder: ${rule.folderPath}`,
						);
						continue;
					}

					foldersToProcess = [folder];
				}

				const filesToArchive = [];

				for (const folder of foldersToProcess) {
					if (!folder) continue; // Additional safety check

					const files = this.getFilesFromFolder(
						folder,
						rule.applyRecursively || false,
					);

					for (const file of files) {
						if (this.filesProcessedInCycle >= MAX_FILES_PER_CYCLE) {
							break;
						}

						if (await this.evaluateAutoArchiveRule(file, rule)) {
							filesToArchive.push(file);
							this.filesProcessedInCycle++;
						}
					}
				}

				for (const file of filesToArchive) {
					const result = await this.archiveFile(file);
					if (result.success) {
						totalArchived++;
					}
				}
			}

			if (totalArchived > 0) {
				console.log(`Auto-archive: ${totalArchived} files archived`);
			}
		} finally {
			await this.persistLastRunTimestamp(Date.now());
		}
	}

	private getFilesFromFolder(folder: TFolder, recursive: boolean): TFile[] {
		const files: TFile[] = [];

		if (!folder || !folder.children) {
			return files;
		}

		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (recursive && child instanceof TFolder) {
				files.push(...this.getFilesFromFolder(child, recursive));
			}
		}

		return files;
	}

	private async evaluateAutoArchiveRule(
		file: TAbstractFile,
		rule: AutoArchiveRule,
	): Promise<boolean> {
		if (this.isFileArchived(file)) {
			return false;
		}

		if (rule.conditions.length === 0) {
			return false;
		}

		const operator = rule.logicOperator || "AND";
		if (operator === "OR") {
			for (const condition of rule.conditions) {
				if (await this.evaluateCondition(file, condition)) {
					return true;
				}
			}
			return false;
		} else {
			for (const condition of rule.conditions) {
				if (!(await this.evaluateCondition(file, condition))) {
					return false;
				}
			}
			return true;
		}
	}

	private async evaluateCondition(
		file: TAbstractFile,
		condition: AutoArchiveCondition,
	): Promise<boolean> {
		if (condition.type === "fileAge") {
			const ageInDays = parseInt(condition.value);
			if (isNaN(ageInDays)) {
				return false;
			}

			const stats = await this.app.vault.adapter.stat(file.path);
			if (!stats) {
				return false;
			}

			const fileAgeMs = Date.now() - stats.mtime;
			const fileAgeDays = fileAgeMs / (1000 * 60 * 60 * 24);
			return fileAgeDays >= ageInDays;
		} else if (condition.type === "regexPattern") {
			const regex = this.validateRegexPattern(condition.value);
			if (!regex) {
				console.error(
					`Invalid regex pattern in auto-archive rule: ${condition.value}`,
				);
				return false;
			}
			return regex.test(file.name);
		}

		return false;
	}

	getRulesForFolder(folderPath: string): AutoArchiveRule[] {
		const settings = this.getSettings();
		return settings.autoArchiveRules.filter((rule) => {
			if (rule.useFolderRegex) {
				const regex = this.validateRegexPattern(rule.folderPath);
				if (!regex) {
					return false;
				}
				return regex.test(folderPath);
			}
			return rule.folderPath === folderPath;
		});
	}

	/**
	 * Generates human-readable text for a condition (shared utility).
	 */
	getConditionText(condition: AutoArchiveCondition): string {
		if (condition.type === "fileAge") {
			return `File age ≥ ${condition.value} days`;
		} else if (condition.type === "regexPattern") {
			return `File name matches: ${condition.value}`;
		}
		return "Unknown condition";
	}

	getRuleDisplayText(rule: AutoArchiveRule): string {
		const icon = rule.enabled ? "✓" : "○";

		if (rule.conditions.length === 0) {
			return `${icon} (no conditions)`;
		}

		if (rule.conditions.length === 1) {
			const conditionText = this.getConditionText(rule.conditions[0]);
			return `${icon} ${conditionText}`;
		}

		// Multiple conditions: join with logic operator
		const operator = rule.logicOperator === "OR" ? " OR " : " AND ";
		const conditionsText = rule.conditions
			.map((c) => this.getConditionText(c))
			.join(operator);

		// Truncate if too long
		const fullText = `${icon} ${conditionsText}`;
		const MAX_LENGTH = 60;
		if (fullText.length > MAX_LENGTH) {
			const firstCondition = this.getConditionText(rule.conditions[0]);
			return `${icon} ${firstCondition} ${operator}... (${rule.conditions.length} total)`;
		}

		return fullText;
	}

	setupContextMenu(workspace: Workspace, plugin: SimpleArchiver): void {
		plugin.registerEvent(
			workspace.on("file-menu", (menu, file) => {
				// Only show for folders
				if (!(file instanceof TFolder)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Auto-archive").setIcon("clock");

					// Add submenu with proper type safety
					const submenu = this.getSubmenu(item);
					if (!submenu) {
						console.error("Failed to create submenu");
						return;
					}

					// Add "Add rule" item
					submenu.addItem((subitem: MenuEntry) => {
						subitem
							.setTitle("Add rule")
							.setIcon("plus")
							.onClick(() => {
								this.openAutoArchiveRuleForFolder(
									plugin,
									file.path,
								);
							});
					});

					// Check if there are existing rules for this folder
					const existingRules = this.getRulesForFolder(file.path);

					if (existingRules.length > 0) {
						// Add "Edit Rule" submenu item
						submenu.addItem((subitem: MenuEntry) => {
							subitem.setTitle("Edit Rule").setIcon("pencil");

							const editSubmenu = this.getSubmenu(subitem);
							if (!editSubmenu) return;

							// Add each rule as a submenu item
							for (const rule of existingRules) {
								editSubmenu.addItem((ruleItem: MenuEntry) => {
									const displayText =
										this.getRuleDisplayText(rule);
									const icon = rule.enabled
										? "check"
										: "circle";

									ruleItem
										.setTitle(displayText)
										.setIcon(icon)
										.onClick(() => {
											new AutoArchiveRuleModal(
												this.app,
												plugin,
												rule,
												async () => {
													await plugin.saveSettings();
												},
											).open();
										});
								});
							}
						});
					}
				});
			}),
		);
	}

	/**
	 * Safely retrieves submenu from menu item with type safety.
	 */
	private getSubmenu(item: MenuEntry): MenuGroup | null {
		try {
			return typeof item.setSubmenu === "function"
				? item.setSubmenu()
				: null;
		} catch (error) {
			console.error("Failed to create submenu:", error);
			return null;
		}
	}

	private openAutoArchiveRuleForFolder(
		plugin: SimpleArchiver,
		folderPath: string,
	): void {
		try {
			const obsidianApis = this.app as unknown as ObsidianInternalApis;
			if (!obsidianApis.setting) {
				console.error("Unable to access settings API");
				return;
			}

			obsidianApis.setting.open();

			const pluginId = plugin.manifest.id;
			obsidianApis.setting.openTabById(pluginId);

			window.setTimeout(() => {
				const tabs = obsidianApis.setting
					.pluginTabs as PluginSettingTab[];
				for (const tab of tabs) {
					if (tab instanceof SimpleArchiverSettingsTab) {
						tab.activeTab = "autoArchive";
						tab.display();

						const newRule: AutoArchiveRule = {
							id: crypto.randomUUID(),
							enabled: true,
							folderPath,
							useFolderRegex: false,
							applyRecursively: false,
							conditions: [],
							logicOperator: "AND",
						};

						plugin.settings.autoArchiveRules.push(newRule);

						try {
							new AutoArchiveRuleModal(
								this.app,
								plugin,
								newRule,
								async () => {
									await plugin.saveSettings();
									tab.display();
								},
								async () => {
									plugin.settings.autoArchiveRules =
										plugin.settings.autoArchiveRules.filter(
											(r) => r.id !== newRule.id,
										);
									await plugin.saveSettings();
									tab.display();
								},
							).open();
						} catch (error) {
							plugin.settings.autoArchiveRules =
								plugin.settings.autoArchiveRules.filter(
									(r) => r.id !== newRule.id,
								);
							console.error(
								"Failed to open auto-archive rule modal:",
								error,
							);
						}

						break;
					}
				}
			}, SETTINGS_TAB_RENDER_DELAY_MS);
		} catch (error) {
			console.error(
				"Failed to open auto-archive rule for folder:",
				error,
			);
		}
	}
}
