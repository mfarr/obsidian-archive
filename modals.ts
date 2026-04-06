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
	draftRule: AutoArchiveRule;
	onSave: () => Promise<void>;
	onCancel?: () => Promise<void>;
	folderPathInput: HTMLInputElement;
	validationErrorEl: HTMLDivElement;
	closeReason: "none" | "saved" | "cancelled" = "none";

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
		this.draftRule = this.cloneRule(rule);
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
					.setValue(this.draftRule.folderPath)
					.onChange((value) => {
						this.draftRule.folderPath = value;
					});
			});

		new Setting(contentEl)
			.setName("Use folder path as regular expression")
			.setDesc(
				"When enabled, the folder path will be treated as a regular expression pattern to match multiple folders",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.draftRule.useFolderRegex || false)
					.onChange((value) => {
						this.draftRule.useFolderRegex = value;
					}),
			);

		new Setting(contentEl)
			.setName("Apply recursively to subfolders")
			.setDesc(
				"When enabled, the rule will be applied to all files in subfolders as well",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.draftRule.applyRecursively || false)
					.onChange((value) => {
						this.draftRule.applyRecursively = value;
					}),
			);

		new Setting(contentEl)
			.setName("Logic operator")
			.setDesc("How to combine multiple conditions")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("AND", "AND (all conditions must match)")
					.addOption("OR", "OR (any condition must match)")
					.setValue(this.draftRule.logicOperator || "AND")
					.onChange((value) => {
						this.draftRule.logicOperator = value as "AND" | "OR";
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

						this.applyDraftToRule();
						await this.onSave();
						this.closeReason = "saved";
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(async () => {
					await this.handleCancel();
					this.closeReason = "cancelled";
					this.close();
				}),
			);
	}

	private displayConditions(containerEl: HTMLElement): void {
		containerEl.empty();

		if (this.draftRule.conditions.length === 0) {
			containerEl.createEl("p", {
				text: "No conditions added yet. Add at least one condition.",
				cls: "setting-item-description",
			});
			return;
		}

		for (let i = 0; i < this.draftRule.conditions.length; i++) {
			const condition = this.draftRule.conditions[i];
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
						this.draftRule.conditions.splice(index, 1);
						this.displayConditions(containerEl);
					}),
			);
	}

	private addCondition(): void {
		this.draftRule.conditions.push({
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
		const folderPath = (this.draftRule.folderPath ?? "").trim();
		if (!folderPath) {
			return "Folder path is required.";
		}

		if (this.draftRule.conditions.length === 0) {
			return "Cannot save rule with no conditions.";
		}

		for (let index = 0; index < this.draftRule.conditions.length; index++) {
			const condition = this.draftRule.conditions[index];
			const conditionValue = (condition.value ?? "").trim();
			if (!conditionValue) {
				return `Condition ${index + 1} requires a value.`;
			}

			if (condition.type === "fileAge") {
				const dayCount = Number(conditionValue);
				if (!Number.isInteger(dayCount) || dayCount <= 0) {
					return `Condition ${index + 1} must be a positive whole number of days.`;
				}
			}

			if (condition.type === "regexPattern") {
				try {
					new RegExp(conditionValue);
				} catch {
					return `Condition ${index + 1} has an invalid regular expression.`;
				}
			}
		}

		const archiveFolder = this.normalizeRulePath(
			this.plugin.settings.archiveFolder,
		);

		if (!archiveFolder) {
			return null;
		}

		if (this.draftRule.useFolderRegex) {
			try {
				const folderRegex = new RegExp(this.draftRule.folderPath);
				if (folderRegex.test(archiveFolder)) {
					return "Rule folder path cannot match the archive folder path.";
				}
			} catch {
				return "Folder path regex is invalid.";
			}

			return null;
		}

		const ruleFolderPath = this.normalizeRulePath(
			this.draftRule.folderPath,
		);
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

	private cloneRule(rule: AutoArchiveRule): AutoArchiveRule {
		return {
			...rule,
			conditions: rule.conditions.map((condition) => ({
				...condition,
			})),
		};
	}

	private applyDraftToRule(): void {
		this.rule.enabled = this.draftRule.enabled;
		this.rule.folderPath = this.draftRule.folderPath;
		this.rule.useFolderRegex = this.draftRule.useFolderRegex;
		this.rule.applyRecursively = this.draftRule.applyRecursively;
		this.rule.logicOperator = this.draftRule.logicOperator;
		this.rule.conditions = this.draftRule.conditions.map((condition) => ({
			...condition,
		}));
	}

	private async handleCancel(): Promise<void> {
		if (this.onCancel) {
			await this.onCancel();
			return;
		}

		if (!this.rule.folderPath) {
			this.plugin.settings.autoArchiveRules =
				this.plugin.settings.autoArchiveRules.filter(
					(r) => r.id !== this.rule.id,
				);
			await this.plugin.saveSettings();
		}
	}

	onClose() {
		const { contentEl } = this;
		if (this.closeReason === "none") {
			void this.handleCancel();
		}
		contentEl.empty();
	}
}
