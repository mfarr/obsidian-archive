import {
	App,
	normalizePath,
	Notice,
	PluginSettingTab,
	Setting,
} from "obsidian";

import { AutoArchiveService } from "./autoarchive/AutoArchiveService";
import type { AutoArchiveRule } from "./autoarchive/AutoArchiveTypes";
import type SimpleArchiver from "./main";
import { AutoArchiveRuleModal } from "./modals";

export class SimpleArchiverSettingsTab extends PluginSettingTab {
	plugin: SimpleArchiver;
	autoArchiveService: AutoArchiveService;
	activeTab: "general" | "autoArchive" = "general";

	constructor(
		app: App,
		plugin: SimpleArchiver,
		autoArchiveService: AutoArchiveService,
	) {
		super(app, plugin);
		this.plugin = plugin;
		this.autoArchiveService = autoArchiveService;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const tabContainer = containerEl.createDiv({
			cls: "setting-tab-container",
		});
		const tabButtonContainer = tabContainer.createDiv({
			cls: "setting-tab-buttons",
		});

		const generalTabButton = tabButtonContainer.createEl("button", {
			text: "General",
			cls:
				this.activeTab === "general"
					? "setting-tab-button active"
					: "setting-tab-button",
		});
		generalTabButton.addEventListener("click", () => {
			this.activeTab = "general";
			this.display();
		});

		const autoArchiveTabButton = tabButtonContainer.createEl("button", {
			text: "Auto-Archive",
			cls:
				this.activeTab === "autoArchive"
					? "setting-tab-button active"
					: "setting-tab-button",
		});
		autoArchiveTabButton.addEventListener("click", () => {
			this.activeTab = "autoArchive";
			this.display();
		});

		const tabContent = containerEl.createDiv({
			cls: "setting-tab-content",
		});

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
					'note. Folder names must not contain "\\", "/" or ":" and must not start with ".".',
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
					}),
			);
	}

	private displayAutoArchiveSettings(containerEl: HTMLElement): void {
		const frequencySetting = new Setting(containerEl)
			.setName("Auto-archive frequency")
			.setDesc("How often to check and process auto-archive rules");

		const lastRunLineEl = frequencySetting.descEl.createDiv({
			cls: "setting-item-description",
		});
		const refreshLastRunLine = () => {
			lastRunLineEl.setText(
				`Last auto-archive run: ${this.getLastAutoArchiveRunText()}`,
			);
		};
		refreshLastRunLine();

		frequencySetting
			.addButton((button) =>
				button
					.setButtonText("Auto Archive Now")
					.setTooltip("Process auto-archive rules immediately")
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Processing...");
						await this.autoArchiveService.processAutoArchiveRules();
						refreshLastRunLine();
						this.autoArchiveService.scheduleAutoArchive();
						button.setButtonText("Auto Archive Now");
						button.setDisabled(false);
						new Notice("Auto-archive rules processed");
					}),
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
					.setValue(
						this.plugin.settings.autoArchiveFrequency.toString(),
					)
					.onChange(async (value) => {
						this.plugin.settings.autoArchiveFrequency = parseInt(
							value,
							10,
						);
						await this.plugin.saveSettings();
						this.autoArchiveService.scheduleAutoArchive();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-archive startup delay")
			.setDesc(
				"How long to wait after Obsidian starts before checking if auto-archive should run",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("5", "5 seconds")
					.addOption("10", "10 seconds")
					.addOption("30", "30 seconds")
					.addOption("60", "60 seconds")
					.addOption("120", "2 minutes")
					.addOption("300", "5 minutes")
					.setValue(
						this.plugin.settings.autoArchiveStartupDelaySeconds.toString(),
					)
					.onChange(async (value) => {
						this.plugin.settings.autoArchiveStartupDelaySeconds =
							parseInt(value, 10);
						await this.plugin.saveSettings();
						this.autoArchiveService.scheduleStartupAutoArchiveCheck();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-archive rules")
			.setDesc(
				"Define rules for automatically archiving files in specific folders",
			)
			.addButton((button) =>
				button.setButtonText("Add Rule").onClick(() => {
					this.addAutoArchiveRule();
				}),
			);

		const rulesContainer = containerEl.createDiv({
			cls: "auto-archive-rules-container",
		});
		this.displayAutoArchiveRules(rulesContainer);
	}

	private displayAutoArchiveRules(containerEl: HTMLElement): void {
		if (this.plugin.settings.autoArchiveRules.length === 0) {
			containerEl.createEl("p", {
				text: "No auto-archive rules configured yet.",
				cls: "setting-item-description",
			});
			return;
		}

		for (const rule of this.plugin.settings.autoArchiveRules) {
			this.displayAutoArchiveRule(containerEl, rule);
		}
	}

	private displayAutoArchiveRule(
		containerEl: HTMLElement,
		rule: AutoArchiveRule,
	): void {
		const ruleContainer = containerEl.createDiv({
			cls: "auto-archive-rule",
		});

		new Setting(ruleContainer)
			.setName(`Folder: ${rule.folderPath || "(not set)"}`)
			.setClass("auto-archive-rule-header")
			.addToggle((toggle) =>
				toggle.setValue(rule.enabled).onChange(async (value) => {
					rule.enabled = value;
					await this.plugin.saveSettings();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Edit")
					.setClass("mod-cta")
					.onClick(() => {
						this.editAutoArchiveRule(rule);
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.autoArchiveRules =
							this.plugin.settings.autoArchiveRules.filter(
								(r) => r.id !== rule.id,
							);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		const conditionsEl = ruleContainer.createDiv({
			cls: "auto-archive-rule-conditions",
		});
		if (rule.conditions.length === 0) {
			conditionsEl.createSpan({
				text: "No conditions set",
				cls: "setting-item-description",
			});
		} else {
			if (rule.conditions.length > 1) {
				conditionsEl.createDiv({
					text: `Logic: ${rule.logicOperator || "AND"}`,
					cls: "auto-archive-rule-logic",
				});
			}
			for (const condition of rule.conditions) {
				const conditionText =
					this.autoArchiveService.getConditionText(condition);
				conditionsEl.createDiv({
					text: `• ${conditionText}`,
					cls: "auto-archive-rule-condition",
				});
			}
		}
	}

	private addAutoArchiveRule(): void {
		const newRule: AutoArchiveRule = {
			id: crypto.randomUUID(),
			enabled: true,
			folderPath: "",
			useFolderRegex: false,
			applyRecursively: false,
			conditions: [],
			logicOperator: "AND",
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
		return !/^\.|[:/\\]\.|:/.test(value);
	}

	private setArchiveFolder(value: string): boolean {
		if (!this.validateArchiveFolderName(value)) {
			return false;
		}

		this.plugin.settings.archiveFolder = value;
		return true;
	}

	private getLastAutoArchiveRunText(): string {
		const lastRunAt =
			this.plugin.autoArchiveRuntimeData.lastAutoArchiveRunAt;

		if (!Number.isFinite(lastRunAt) || lastRunAt <= 0) {
			return "never";
		}

		return new Date(lastRunAt).toLocaleString();
	}
}
