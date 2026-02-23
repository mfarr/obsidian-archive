import { App, Modal, normalizePath, Setting } from "obsidian";

import type {
	AutoArchiveCondition,
	AutoArchiveRule,
} from "./autoarchive/AutoArchiveTypes";
import type SimpleArchiver from "./main";

export class SimpleArchiverPromptModal extends Modal {
	constructor(
		app: App,
		title: string,
		message: string,
		yesButtonText: string,
		noButtonText: string,
		callback: () => Promise<void>,
		cancelCallback: () => Promise<void>,
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
					}),
			)
			.addButton((btn) =>
				btn.setButtonText(noButtonText).onClick(() => {
					cancelCallback();
					this.close();
				}),
			);
	}
}

export class AutoArchiveRuleModal extends Modal {
	plugin: SimpleArchiver;
	rule: AutoArchiveRule;
	onSave: () => Promise<void>;
	onCancel?: () => Promise<void>;
	folderPathInput: HTMLInputElement;
	validationErrorEl: HTMLDivElement;

	constructor(
		app: App,
		plugin: SimpleArchiver,
		rule: AutoArchiveRule,
		onSave: () => Promise<void>,
		onCancel?: () => Promise<void>,
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

		this.validationErrorEl = contentEl.createDiv({
			cls: "auto-archive-rule-validation-error",
		});
		this.validationErrorEl.style.display = "none";
		this.validationErrorEl.style.color = "var(--text-error)";
		this.validationErrorEl.style.fontWeight = "600";
		this.validationErrorEl.style.marginBottom = "12px";

		new Setting(contentEl)
			.setName("Folder path")
			.setDesc(
				"The folder to apply this rule to (e.g., 'Projects' or 'Notes/Daily')",
			)
			.addText((text) => {
				this.folderPathInput = text.inputEl;
				text.setPlaceholder("folder/path")
					.setValue(this.rule.folderPath)
					.onChange((value) => {
						this.rule.folderPath = value;
					});
			});

		new Setting(contentEl)
			.setName("Use folder path as regular expression")
			.setDesc(
				"When enabled, the folder path will be treated as a regular expression pattern to match multiple folders",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.rule.useFolderRegex || false)
					.onChange((value) => {
						this.rule.useFolderRegex = value;
					}),
			);

		new Setting(contentEl)
			.setName("Apply recursively to subfolders")
			.setDesc(
				"When enabled, the rule will be applied to all files in subfolders as well",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.rule.applyRecursively || false)
					.onChange((value) => {
						this.rule.applyRecursively = value;
					}),
			);

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
					}),
			);

		contentEl.createEl("h3", { text: "Conditions" });

		const conditionsContainer = contentEl.createDiv({
			cls: "auto-archive-conditions-container",
		});
		this.displayConditions(conditionsContainer);

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Add Condition").onClick(() => {
				this.addCondition();
			}),
		);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						this.clearValidationError();
						const validationMessage = this.validateRule();
						if (validationMessage) {
							this.showValidationError(validationMessage);
							return;
						}

						await this.onSave();
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(async () => {
					if (this.onCancel) {
						await this.onCancel();
					} else {
						if (!this.rule.folderPath) {
							this.plugin.settings.autoArchiveRules =
								this.plugin.settings.autoArchiveRules.filter(
									(r) => r.id !== this.rule.id,
								);
							await this.plugin.saveSettings();
						}
					}
					this.close();
				}),
			);
	}

	private displayConditions(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.rule.conditions.length === 0) {
			containerEl.createEl("p", {
				text: "No conditions added yet. Add at least one condition.",
				cls: "setting-item-description",
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
		index: number,
	): void {
		const conditionEl = containerEl.createDiv({
			cls: "auto-archive-condition",
		});

		new Setting(conditionEl)
			.setName(`Condition ${index + 1}`)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("fileAge", "File age (days)")
					.addOption("regexPattern", "File name regex")
					.setValue(condition.type)
					.onChange((value) => {
						const conditionType = value as
							| "fileAge"
							| "regexPattern";
						if (
							conditionType === "fileAge" ||
							conditionType === "regexPattern"
						) {
							condition.type = conditionType;
							condition.value = "";
							this.displayConditions(containerEl);
						}
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder(
						condition.type === "fileAge"
							? "Number of days"
							: "Regular expression",
					)
					.setValue(condition.value)
					.onChange((value) => {
						condition.value = value;
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => {
						this.rule.conditions.splice(index, 1);
						this.displayConditions(containerEl);
					}),
			);
	}

	private addCondition(): void {
		this.rule.conditions.push({
			type: "fileAge",
			value: "",
		});

		const conditionsContainer = this.contentEl.querySelector(
			".auto-archive-conditions-container",
		) as HTMLElement;
		if (conditionsContainer) {
			this.displayConditions(conditionsContainer);
		}
	}

	private validateRule(): string | null {
		if (this.rule.conditions.length === 0) {
			return "Cannot save rule with no conditions.";
		}

		const archiveFolder = this.normalizeRulePath(
			this.plugin.settings.archiveFolder,
		);

		if (!archiveFolder) {
			return null;
		}

		if (this.rule.useFolderRegex) {
			try {
				const folderRegex = new RegExp(this.rule.folderPath);
				if (folderRegex.test(archiveFolder)) {
					return "Rule folder path cannot match the archive folder path.";
				}
			} catch {
				return "Folder path regex is invalid.";
			}

			return null;
		}

		const ruleFolderPath = this.normalizeRulePath(this.rule.folderPath);
		if (this.isArchiveFolderOverlap(ruleFolderPath, archiveFolder)) {
			return "Rule folder path cannot match or overlap with the archive folder path.";
		}

		return null;
	}

	private showValidationError(message: string): void {
		this.validationErrorEl.setText(message);
		this.validationErrorEl.style.display = "block";
	}

	private clearValidationError(): void {
		this.validationErrorEl.empty();
		this.validationErrorEl.style.display = "none";
	}

	private normalizeRulePath(path: string): string {
		const trimmedPath = (path ?? "").trim();
		if (!trimmedPath) {
			return "";
		}

		return normalizePath(trimmedPath).replace(/^\/+|\/+$/g, "");
	}

	private isArchiveFolderOverlap(
		ruleFolderPath: string,
		archiveFolderPath: string,
	): boolean {
		if (!ruleFolderPath) {
			return true;
		}

		if (ruleFolderPath === archiveFolderPath) {
			return true;
		}

		if (ruleFolderPath.startsWith(`${archiveFolderPath}/`)) {
			return true;
		}

		return archiveFolderPath.startsWith(`${ruleFolderPath}/`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
