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
} from "obsidian";

interface SimpleArchiverSettings {
	archiveFolder: string;
}

interface ArchiveResult {
	success: boolean;
	message: string;
}

const DEFAULT_SETTINGS: SimpleArchiverSettings = {
	archiveFolder: "Archive",
};

export default class SimpleArchiver extends Plugin {
	settings: SimpleArchiverSettings;

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
				await this.app.vault.createFolder(originalParentPath);
			}
		}

		try {
			await this.app.fileManager.renameFile(file, originalPath);
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

	private async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
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

class SimpleArchiverSettingsTab extends PluginSettingTab {
	plugin: SimpleArchiver;

	constructor(app: App, plugin: SimpleArchiver) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

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
