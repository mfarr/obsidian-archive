import {
	App,
	Editor,
	MarkdownView,
	Modal,
	normalizePath,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";

interface AutoArchiveCondition {
	type: "fileAge" | "regexPattern";
	value: string; // For fileAge: number in days, for regexPattern: regex string
}

interface AutoArchiveRule {
	id: string;
	enabled: boolean;
	folderPath: string;
	useFolderRegex: boolean;
	applyRecursively: boolean;
	conditions: AutoArchiveCondition[];
	logicOperator: "AND" | "OR";
}

interface SimpleArchiverSettings {
	archiveFolder: string;
	autoArchiveRules: AutoArchiveRule[];
	autoArchiveFrequency: number; // in minutes
}

interface ArchiveResult {
	success: boolean;
	message: string;
}

const DEFAULT_SETTINGS: SimpleArchiverSettings = {
	archiveFolder: "Archive",
	autoArchiveRules: [],
	autoArchiveFrequency: 60, // default 60 minutes
};

export default class SimpleArchiver extends Plugin {
	settings: SimpleArchiverSettings;
	autoArchiveInterval: number | null = null;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "move-to-archive",
			name: "Move to archive",
			editorCheckCallback: (
				checking: boolean,
				editor: Editor,
				view: MarkdownView
			) => {
				const canBeArchived =
					view.file && !this.isFileArchived(view.file);

				if (canBeArchived && view.file != null) {
					if (!checking) {
						this.archiveFile(view.file).then((result) => {
							new Notice(result.message);
						});
					}

					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: "move-out-of-archive",
			name: "Move out of archive",
			editorCheckCallback: (
				checking: boolean,
				editor: Editor,
				view: MarkdownView
			) => {
				const canBeUnarchived =
					view.file && this.isFileArchived(view.file);

				if (canBeUnarchived && view.file != null) {
					if (!checking) {
						this.unarchiveFile(view.file).then((result) => {
							new Notice(result.message);
						});
					}

					return true;
				}

				return false;
			},
		});

		this.addSettingTab(new SimpleArchiverSettingsTab(this.app, this));

		// Start auto-archive job
		this.scheduleAutoArchive();

		// Archive file context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (this.isFileArchived(file)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Move to archive")
						.setIcon("archive")
						.onClick(async () => {
							const result = await this.archiveFile(file);

							if (result.success) {
								new Notice(result.message);
							} else {
								new Error(result.message);
							}
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				if (files.some((file) => this.isFileArchived(file))) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Move all to archive")
						.setIcon("archive")
						.onClick(async () => {
							await this.archiveAllFiles(files);
						});
				});
			})
		);

		// Unarchive file context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!this.isFileArchived(file)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Move out of archive")
						.setIcon("archive-restore")
						.onClick(async () => {
							const result = await this.unarchiveFile(file);

							if (result.success) {
								new Notice(result.message);
							} else {
								new Error(result.message);
							}
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				if (files.some((file) => !this.isFileArchived(file))) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Move all out of archive")
						.setIcon("archive-restore")
						.onClick(async () => {
							await this.unarchiveAllFiles(files);
						});
				});
			})
		);

		// Folder context menu for auto-archive
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				// Only show for folders
				if (!(file instanceof TFolder)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Auto-archive")
						.setIcon("clock");
					
					// Add submenu
					const submenu = (item as any).setSubmenu();
					submenu.addItem((subitem: any) => {
						subitem
							.setTitle("Add rule")
							.setIcon("plus")
							.onClick(() => {
								this.openAutoArchiveRuleForFolder(file.path);
							});
					});
				});
			})
		);
	}

	openAutoArchiveRuleForFolder(folderPath: string): void {
		// Open settings with auto-archive tab
		const setting = (this.app as any).setting;
		
		// Open the settings if not already open
		setting.open();
		
		// Open our plugin's settings tab by ID
		const pluginId = this.manifest.id;
		setting.openTabById(pluginId);
		
		// Delay to allow settings tab to render before manipulating it
		// This is necessary because settings tab rendering is asynchronous
		const SETTINGS_TAB_RENDER_DELAY_MS = 200;
		setTimeout(() => {
			// Get the settings tab and set it to auto-archive
			const tabs = setting.pluginTabs as PluginSettingTab[];
			for (const tab of tabs) {
				if (tab instanceof SimpleArchiverSettingsTab) {
					tab.activeTab = "autoArchive";
					tab.display();
					
					// Create new rule with pre-filled folder path
					const newRule: AutoArchiveRule = {
						id: crypto.randomUUID(),
						enabled: true,
						folderPath: folderPath,
						useFolderRegex: false,
						applyRecursively: false,
						conditions: [],
						logicOperator: "AND"
					};

					this.settings.autoArchiveRules.push(newRule);
					
					try {
						// Open the rule modal with cancel callback to remove the rule if cancelled
						new AutoArchiveRuleModal(
							this.app, 
							this, 
							newRule, 
							async () => {
								await this.saveSettings();
								tab.display();
							},
							async () => {
								// Remove the rule if the user cancels
								this.settings.autoArchiveRules = this.settings.autoArchiveRules.filter(
									(r) => r.id !== newRule.id
								);
								await this.saveSettings();
								tab.display();
							}
						).open();
					} catch (error) {
						// If modal creation fails, clean up the rule
						this.settings.autoArchiveRules = this.settings.autoArchiveRules.filter(
							(r) => r.id !== newRule.id
						);
						console.error("Failed to open auto-archive rule modal:", error);
					}
					
					break;
				}
			}
		}, SETTINGS_TAB_RENDER_DELAY_MS);
	}

	private isFileArchived(file: TAbstractFile): boolean {
		return file.path.startsWith(this.settings.archiveFolder);
	}

	private async archiveFile(file: TAbstractFile): Promise<ArchiveResult> {
		if (this.isFileArchived(file)) {
			return { success: false, message: "Item is already archived" };
		}

		const destinationFilePath = normalizePath(
			`${this.settings.archiveFolder}/${file.path}`
		);

		const existingItem =
			this.app.vault.getAbstractFileByPath(destinationFilePath);

		if (existingItem != null) {
			// Same item exists in archive, prompt to replace
			return new Promise<ArchiveResult>((resolve) => {
				const prompt = new SimpleArchiverPromptModal(
					this.app,
					"Replace archived item?",
					`An item called "${file.name}" already exists in the destination folder in the archive. Would you like to replace it?`,
					"Replace",
					"Cancel",
					async () => {
						await this.app.fileManager.trashFile(existingItem);
						const response = await this.moveFileToArchive(file);

						resolve(response);
					},
					async () => {
						resolve({
							success: false,
							message: "Archive operation cancelled",
						});
					}
				);
				prompt.open();
			});
		}

		// If no existing item, proceed with archiving
		const response = await this.moveFileToArchive(file);
		return response;
	}

	private async archiveAllFiles(files: TAbstractFile[]) {
		let archived = 0;

		for (const file of files) {
			if ((await this.archiveFile(file)).success) {
				archived++;
			}
		}

		new Notice(`${archived} files archived`);
	}

	private async moveFileToArchive(
		file: TAbstractFile
	): Promise<ArchiveResult> {
		const destinationPath = normalizePath(
			`${this.settings.archiveFolder}/${file.parent?.path}`
		);

		const destinationFolder =
			this.app.vault.getFolderByPath(destinationPath);

		if (destinationFolder == null) {
			await this.app.vault.createFolder(destinationPath);
		}

		const destinationFilePath = normalizePath(
			`${destinationPath}/${file.name}`
		);

		try {
			await this.app.fileManager.renameFile(file, destinationFilePath);
			return {
				success: true,
				message: `${file.name} archived successfully`,
			};
		} catch (error) {
			return {
				success: false,
				message: `Unable to archive ${file.name}: ${error}`,
			};
		}
	}

	private async moveFileOutOfArchive(
		file: TAbstractFile
	): Promise<ArchiveResult> {
		const originalPath = file.path.substring(
			this.settings.archiveFolder.length + 1
		);
		const originalParentPath = originalPath.substring(
			0,
			originalPath.lastIndexOf("/")
		);

		if (originalParentPath) {
			const originalFolder =
				this.app.vault.getFolderByPath(originalParentPath);

			if (originalFolder == null) {
				await this.app.vault.createFolder(normalizePath(originalParentPath));
			}
		}

		try {
			await this.app.fileManager.renameFile(file, normalizePath(originalPath));
			return {
				success: true,
				message: `${file.name} unarchived successfully`,
			};
		} catch (error) {
			return {
				success: false,
				message: `Unable to unarchive ${file.name}: ${error}`,
			};
		}
	}

	private async unarchiveFile(file: TAbstractFile): Promise<ArchiveResult> {
		if (!this.isFileArchived(file)) {
			return { success: false, message: "Item is not archived" };
		}

		const originalPath = file.path.substring(
			this.settings.archiveFolder.length + 1
		);

		const existingItem = this.app.vault.getAbstractFileByPath(originalPath);

		if (existingItem != null) {
			return new Promise<ArchiveResult>((resolve) => {
				const prompt = new SimpleArchiverPromptModal(
					this.app,
					"Replace existing item?",
					`An item called "${file.name}" already exists in the original location. Would you like to replace it?`,
					"Replace",
					"Cancel",
					async () => {
						await this.app.fileManager.trashFile(existingItem);
						const response = await this.moveFileOutOfArchive(file);

						resolve(response);
					},
					async () => {
						resolve({
							success: false,
							message: "Unarchive operation cancelled",
						});
					}
				);
				prompt.open();
			});
		}

		const response = await this.moveFileOutOfArchive(file);
		return response;
	}

	private async unarchiveAllFiles(files: TAbstractFile[]) {
		let unarchived = 0;

		for (const file of files) {
			if ((await this.unarchiveFile(file)).success) {
				unarchived++;
			}
		}

		new Notice(`${unarchived} files unarchived`);
	}

	onunload() {
		// Clean up auto-archive interval
		if (this.autoArchiveInterval !== null) {
			window.clearInterval(this.autoArchiveInterval);
			this.autoArchiveInterval = null;
		}
	}

	scheduleAutoArchive() {
		// Clear existing interval if any
		if (this.autoArchiveInterval !== null) {
			window.clearInterval(this.autoArchiveInterval);
		}

		// Schedule new interval
		const intervalMs = this.settings.autoArchiveFrequency * 60 * 1000;
		this.autoArchiveInterval = window.setInterval(
			() => this.processAutoArchiveRules(),
			intervalMs
		);
	}

	async processAutoArchiveRules() {
		const enabledRules = this.settings.autoArchiveRules.filter(
			(rule) => rule.enabled
		);

		if (enabledRules.length === 0) {
			return;
		}

		let totalArchived = 0;

		for (const rule of enabledRules) {
			let foldersToProcess: TFolder[] = [];

			if (rule.useFolderRegex) {
				// Use regex to match folder paths
				try {
					const regex = new RegExp(rule.folderPath);
					const allFolders = this.app.vault.getAllFolders();
					foldersToProcess = allFolders.filter((folder) =>
						regex.test(folder.path)
					);
				} catch (error) {
					console.error(
						`Invalid regex pattern in auto-archive rule: ${rule.folderPath}`,
						error
					);
					continue;
				}
			} else {
				// Use exact folder path
				const folder = this.app.vault.getFolderByPath(
					normalizePath(rule.folderPath)
				);

				if (!folder) {
					continue;
				}

				foldersToProcess = [folder];
			}

			const filesToArchive = [];

			for (const folder of foldersToProcess) {
				const files = await this.getFilesFromFolder(
					folder,
					rule.applyRecursively || false
				);

				for (const file of files) {
					if (await this.evaluateAutoArchiveRule(file, rule)) {
						filesToArchive.push(file);
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
	}

	private getFilesFromFolder(
		folder: TFolder,
		recursive: boolean
	): TFile[] {
		const files: TFile[] = [];

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
		rule: AutoArchiveRule
	): Promise<boolean> {
		// Skip if already archived
		if (this.isFileArchived(file)) {
			return false;
		}

		// No conditions means no match
		if (rule.conditions.length === 0) {
			return false;
		}

		// Evaluate based on logic operator (default to AND for backward compatibility)
		const operator = rule.logicOperator || "AND";
		if (operator === "OR") {
			// OR logic: at least one condition must be met
			for (const condition of rule.conditions) {
				if (await this.evaluateCondition(file, condition)) {
					return true;
				}
			}
			return false;
		} else {
			// AND logic: all conditions must be met
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
		condition: AutoArchiveCondition
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
			try {
				const regex = new RegExp(condition.value);
				return regex.test(file.name);
			} catch (error) {
				console.error(
					`Invalid regex pattern in auto-archive rule: ${condition.value}`,
					error
				);
				return false;
			}
		}

		return false;
	}

	private async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		
		// Ensure backward compatibility: set default logicOperator for existing rules
		let needsSave = false;
		if (this.settings.autoArchiveRules) {
			this.settings.autoArchiveRules = this.settings.autoArchiveRules.map(rule => {
				const updates: Partial<AutoArchiveRule> = {};
				
				if (!rule.logicOperator) {
					needsSave = true;
					updates.logicOperator = "AND" as "AND" | "OR";
				}
				
				if (rule.useFolderRegex === undefined) {
					needsSave = true;
					updates.useFolderRegex = false;
				}
				
				if (rule.applyRecursively === undefined) {
					needsSave = true;
					updates.applyRecursively = false;
				}
				
				return { ...rule, ...updates };
			});
		}
		
		// Persist the migration
		if (needsSave) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SimpleArchiverPromptModal extends Modal {
	constructor(
		app: App,
		title: string,
		message: string,
		yesButtonText: string,
		noButtonText: string,
		callback: () => Promise<void>,
		cancelCallback: () => Promise<void>
	) {
		super(app);

		this.setTitle(title);

		this.setContent(message);

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(yesButtonText)
					.setWarning()
					.onClick(() => {
						callback();
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText(noButtonText).onClick(() => {
					cancelCallback();
					this.close();
				})
			);
	}
}

class AutoArchiveRuleModal extends Modal {
	plugin: SimpleArchiver;
	rule: AutoArchiveRule;
	onSave: () => Promise<void>;
	onCancel?: () => Promise<void>;
	folderPathInput: HTMLInputElement;

	constructor(
		app: App,
		plugin: SimpleArchiver,
		rule: AutoArchiveRule,
		onSave: () => Promise<void>,
		onCancel?: () => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.rule = rule;
		this.onSave = onSave;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		this.setTitle("Edit Auto-Archive Rule");

		// Folder path setting
		new Setting(contentEl)
			.setName("Folder path")
			.setDesc("The folder to apply this rule to (e.g., 'Projects' or 'Notes/Daily')")
			.addText((text) => {
				this.folderPathInput = text.inputEl;
				text.setPlaceholder("folder/path")
					.setValue(this.rule.folderPath)
					.onChange((value) => {
						this.rule.folderPath = value;
					});
			});

		// Use folder regex checkbox
		new Setting(contentEl)
			.setName("Use folder path as regular expression")
			.setDesc("When enabled, the folder path will be treated as a regular expression pattern to match multiple folders")
			.addToggle((toggle) =>
				toggle
					.setValue(this.rule.useFolderRegex || false)
					.onChange((value) => {
						this.rule.useFolderRegex = value;
					})
			);

		// Apply recursively checkbox
		new Setting(contentEl)
			.setName("Apply recursively to subfolders")
			.setDesc("When enabled, the rule will be applied to all files in subfolders as well")
			.addToggle((toggle) =>
				toggle
					.setValue(this.rule.applyRecursively || false)
					.onChange((value) => {
						this.rule.applyRecursively = value;
					})
			);

		// Logic operator setting
		new Setting(contentEl)
			.setName("Logic operator")
			.setDesc("How to combine multiple conditions")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("AND", "AND (all conditions must match)")
					.addOption("OR", "OR (any condition must match)")
					.setValue(this.rule.logicOperator || "AND")
					.onChange((value) => {
						this.rule.logicOperator = value as "AND" | "OR";
					})
			);

		// Conditions section
		contentEl.createEl("h3", { text: "Conditions" });

		const conditionsContainer = contentEl.createDiv({ cls: "auto-archive-conditions-container" });
		this.displayConditions(conditionsContainer);

		// Add condition button
		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Add Condition").onClick(() => {
				this.addCondition();
			})
		);

		// Save and cancel buttons
		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						await this.onSave();
						this.close();
					})
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(async () => {
					// Call custom cancel callback if provided
					if (this.onCancel) {
						await this.onCancel();
					} else {
						// Remove rule if it's new and has no folder path (backward compatibility)
						if (!this.rule.folderPath) {
							this.plugin.settings.autoArchiveRules =
								this.plugin.settings.autoArchiveRules.filter(
									(r) => r.id !== this.rule.id
								);
							await this.plugin.saveSettings();
						}
					}
					this.close();
				})
			);
	}

	private displayConditions(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.rule.conditions.length === 0) {
			containerEl.createEl("p", {
				text: "No conditions added yet. Add at least one condition.",
				cls: "setting-item-description"
			});
			return;
		}

		for (let i = 0; i < this.rule.conditions.length; i++) {
			const condition = this.rule.conditions[i];
			this.displayCondition(containerEl, condition, i);
		}
	}

	private displayCondition(
		containerEl: HTMLElement,
		condition: AutoArchiveCondition,
		index: number
	): void {
		const conditionEl = containerEl.createDiv({ cls: "auto-archive-condition" });

		new Setting(conditionEl)
			.setName(`Condition ${index + 1}`)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("fileAge", "File age (days)")
					.addOption("regexPattern", "File name regex")
					.setValue(condition.type)
					.onChange((value) => {
						const conditionType = value as "fileAge" | "regexPattern";
						if (conditionType === "fileAge" || conditionType === "regexPattern") {
							condition.type = conditionType;
							condition.value = "";
							this.displayConditions(containerEl);
						}
					})
			)
			.addText((text) =>
				text
					.setPlaceholder(
						condition.type === "fileAge"
							? "Number of days"
							: "Regular expression"
					)
					.setValue(condition.value)
					.onChange((value) => {
						condition.value = value;
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => {
						this.rule.conditions.splice(index, 1);
						this.displayConditions(containerEl);
					})
			);
	}

	private addCondition(): void {
		this.rule.conditions.push({
			type: "fileAge",
			value: ""
		});

		const conditionsContainer = this.contentEl.querySelector(
			".auto-archive-conditions-container"
		) as HTMLElement;
		if (conditionsContainer) {
			this.displayConditions(conditionsContainer);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SimpleArchiverSettingsTab extends PluginSettingTab {
	plugin: SimpleArchiver;
	activeTab: "general" | "autoArchive" = "general";

	constructor(app: App, plugin: SimpleArchiver) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Create tabs
		const tabContainer = containerEl.createDiv({ cls: "setting-tab-container" });
		const tabButtonContainer = tabContainer.createDiv({ cls: "setting-tab-buttons" });

		const generalTabButton = tabButtonContainer.createEl("button", {
			text: "General",
			cls: this.activeTab === "general" ? "setting-tab-button active" : "setting-tab-button"
		});
		generalTabButton.addEventListener("click", () => {
			this.activeTab = "general";
			this.display();
		});

		const autoArchiveTabButton = tabButtonContainer.createEl("button", {
			text: "Auto-Archive",
			cls: this.activeTab === "autoArchive" ? "setting-tab-button active" : "setting-tab-button"
		});
		autoArchiveTabButton.addEventListener("click", () => {
			this.activeTab = "autoArchive";
			this.display();
		});

		const tabContent = containerEl.createDiv({ cls: "setting-tab-content" });

		if (this.activeTab === "general") {
			this.displayGeneralSettings(tabContent);
		} else {
			this.displayAutoArchiveSettings(tabContent);
		}
	}

	private displayGeneralSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Archive folder")
			.setDesc(
				"The folder to use as the Archive. If the folder doesn't exist, it will be created when archiving a " +
					'note. Folder names must not contain "\\", "/" or ":" and must not start with ".".'
			)
			.addText((text) =>
				text
					.setPlaceholder("Archive folder")
					.setValue(normalizePath(this.plugin.settings.archiveFolder))
					.onChange(async (value) => {
						if (this.setArchiveFolder(value)) {
							await this.plugin.saveSettings();
						} else {
							text.setValue(this.plugin.settings.archiveFolder);
						}
					})
			);
	}

	private displayAutoArchiveSettings(containerEl: HTMLElement): void {
		// Auto-archive frequency setting with "Auto Archive Now" button
		new Setting(containerEl)
			.setName("Auto-archive frequency")
			.setDesc("How often to check and process auto-archive rules")
			.addButton((button) =>
				button
					.setButtonText("Auto Archive Now")
					.setTooltip("Process auto-archive rules immediately")
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Processing...");
						await this.plugin.processAutoArchiveRules();
						this.plugin.scheduleAutoArchive(); // Reset the schedule
						button.setButtonText("Auto Archive Now");
						button.setDisabled(false);
						new Notice("Auto-archive rules processed");
					})
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("5", "Every 5 minutes")
					.addOption("15", "Every 15 minutes")
					.addOption("30", "Every 30 minutes")
					.addOption("60", "Every 60 minutes")
					.addOption("360", "Every 6 hours")
					.addOption("720", "Every 12 hours")
					.addOption("1440", "Every 24 hours")
					.addOption("2880", "Every 48 hours")
					.setValue(this.plugin.settings.autoArchiveFrequency.toString())
					.onChange(async (value) => {
						this.plugin.settings.autoArchiveFrequency = parseInt(value);
						await this.plugin.saveSettings();
						this.plugin.scheduleAutoArchive();
					})
			);

		// Add new rule button
		new Setting(containerEl)
			.setName("Auto-archive rules")
			.setDesc("Define rules for automatically archiving files in specific folders")
			.addButton((button) =>
				button.setButtonText("Add Rule").onClick(() => {
					this.addAutoArchiveRule();
				})
			);

		// Display existing rules
		const rulesContainer = containerEl.createDiv({ cls: "auto-archive-rules-container" });
		this.displayAutoArchiveRules(rulesContainer);
	}

	private displayAutoArchiveRules(containerEl: HTMLElement): void {
		if (this.plugin.settings.autoArchiveRules.length === 0) {
			containerEl.createEl("p", {
				text: "No auto-archive rules configured yet.",
				cls: "setting-item-description"
			});
			return;
		}

		for (const rule of this.plugin.settings.autoArchiveRules) {
			this.displayAutoArchiveRule(containerEl, rule);
		}
	}

	private displayAutoArchiveRule(containerEl: HTMLElement, rule: AutoArchiveRule): void {
		const ruleContainer = containerEl.createDiv({ cls: "auto-archive-rule" });

		// Rule header with enable/disable toggle
		new Setting(ruleContainer)
			.setName(`Folder: ${rule.folderPath || "(not set)"}`)
			.setClass("auto-archive-rule-header")
			.addToggle((toggle) =>
				toggle.setValue(rule.enabled).onChange(async (value) => {
					rule.enabled = value;
					await this.plugin.saveSettings();
				})
			)
			.addButton((button) =>
				button
					.setButtonText("Edit")
					.setClass("mod-cta")
					.onClick(() => {
						this.editAutoArchiveRule(rule);
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.autoArchiveRules =
							this.plugin.settings.autoArchiveRules.filter(
								(r) => r.id !== rule.id
							);
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// Display conditions
		const conditionsEl = ruleContainer.createDiv({ cls: "auto-archive-rule-conditions" });
		if (rule.conditions.length === 0) {
			conditionsEl.createEl("span", {
				text: "No conditions set",
				cls: "setting-item-description"
			});
		} else {
			// Show logic operator if multiple conditions
			if (rule.conditions.length > 1) {
				conditionsEl.createEl("div", {
					text: `Logic: ${rule.logicOperator || "AND"}`,
					cls: "auto-archive-rule-logic"
				});
			}
			for (const condition of rule.conditions) {
				const conditionText = this.getConditionText(condition);
				conditionsEl.createEl("div", {
					text: `• ${conditionText}`,
					cls: "auto-archive-rule-condition"
				});
			}
		}
	}

	private getConditionText(condition: AutoArchiveCondition): string {
		if (condition.type === "fileAge") {
			return `File age ≥ ${condition.value} days`;
		} else if (condition.type === "regexPattern") {
			return `File name matches: ${condition.value}`;
		}
		return "Unknown condition";
	}

	private addAutoArchiveRule(): void {
		const newRule: AutoArchiveRule = {
			id: crypto.randomUUID(),
			enabled: true,
			folderPath: "",
			useFolderRegex: false,
			applyRecursively: false,
			conditions: [],
			logicOperator: "AND"
		};

		this.plugin.settings.autoArchiveRules.push(newRule);
		this.editAutoArchiveRule(newRule);
	}

	private editAutoArchiveRule(rule: AutoArchiveRule): void {
		new AutoArchiveRuleModal(this.app, this.plugin, rule, async () => {
			await this.plugin.saveSettings();
			this.display();
		}).open();
	}

	private validateArchiveFolderName(value: string): boolean {
		// Validate folder does not start with '.', contain ':' or contain a relative path
		return !/^\.|[:/\\]\.|:/.test(value);
	}

	private setArchiveFolder(value: string): boolean {
		if (!this.validateArchiveFolderName(value)) {
			return false;
		}

		this.plugin.settings.archiveFolder = value;
		return true;
	}
}
