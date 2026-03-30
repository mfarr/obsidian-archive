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

interface SimpleArchiverSettings {
	archiveFolder: string;
}

interface ArchiveResult {
	success: boolean;
	message: string;
}

interface MergeResult {
	filesAdded: number;
	filesReplaced: number;
	filesSkipped: number;
	foldersCreated: number;
	failedFiles: string[];
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
								new Notice(result.message);
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
								new Notice(result.message);
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

	private isFolder(file: TAbstractFile): file is TFolder {
		return file instanceof TFolder;
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
			const isFolder = this.isFolder(file);

			return new Promise<ArchiveResult>((resolve) => {
				const prompt = new SimpleArchiverPromptModal(
					this.app,
					isFolder ? "Merge folders?" : "Replace archived item?",
					isFolder
						? `A folder called "${file.name}" already exists in the archive. Merge the contents?`
						: `An item called "${file.name}" already exists in the destination folder in the archive. Would you like to replace it?`,
					isFolder ? "Merge" : "Replace",
					"Cancel",
					async () => {
						try {
							if (isFolder) {
								const response = await this.mergeFolderIntoArchive(
									file as TFolder,
									destinationFilePath
								);
								resolve(response);
							} else {
								await this.app.fileManager.trashFile(existingItem);
								const response = await this.moveFileToArchive(file);
								resolve(response);
							}
						} catch (error) {
							resolve({
								success: false,
								message: `Archive operation failed: ${error}`,
							});
						}
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

	private async mergeFolderIntoArchive(
		sourceFolder: TFolder,
		destinationFolderPath: string
	): Promise<ArchiveResult> {
		const stats: MergeResult = {
			filesAdded: 0,
			filesReplaced: 0,
			filesSkipped: 0,
			foldersCreated: 0,
			failedFiles: [],
		};

		try {
			await this.recursiveMerge(sourceFolder, destinationFolderPath, stats);

			// Only delete the source folder if it's empty
			if (sourceFolder.children.length === 0) {
				await this.app.vault.delete(sourceFolder);
			}

			const totalFiles = stats.filesAdded + stats.filesReplaced;
			let message = `Merged ${sourceFolder.name}: ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;

			const details: string[] = [];
			if (stats.filesReplaced > 0) {
				details.push(`${stats.filesReplaced} replaced`);
			}
			if (stats.filesSkipped > 0) {
				details.push(`${stats.filesSkipped} skipped`);
			}
			if (stats.failedFiles.length > 0) {
				details.push(`${stats.failedFiles.length} failed`);
			}

			if (details.length > 0) {
				message += ` (${details.join(', ')})`;
			}

			if (stats.failedFiles.length > 0) {
				message += `. Failed: ${stats.failedFiles.join(', ')}`;
			}

			if (sourceFolder.children.length > 0) {
				message += `. Source folder not deleted (contains remaining files)`;
			}

			return {
				success: stats.failedFiles.length === 0,
				message: message,
			};
		} catch (error) {
			return {
				success: false,
				message: `Unable to merge ${sourceFolder.name}: ${error}`,
			};
		}
	}

	private async recursiveMerge(
		sourceFolder: TFolder,
		destinationBasePath: string,
		stats: MergeResult
	): Promise<void> {
		// Create a copy of children array to avoid modification during iteration
		const children = [...sourceFolder.children];

		for (const child of children) {
			if (this.isFolder(child)) {
				const childDestPath = normalizePath(
					`${destinationBasePath}/${child.name}`
				);

				const existingFolder = this.app.vault.getFolderByPath(childDestPath);
				if (existingFolder == null) {
					await this.app.vault.createFolder(childDestPath);
					stats.foldersCreated++;
				}

				await this.recursiveMerge(child, childDestPath, stats);
			} else {
				const childDestPath = normalizePath(
					`${destinationBasePath}/${child.name}`
				);

				const existingFile = this.app.vault.getAbstractFileByPath(childDestPath);

				try {
					if (existingFile != null) {
						// Compare file contents before replacing
						const sourceContent = await this.app.vault.read(child as TFile);
						const existingContent = await this.app.vault.read(existingFile as TFile);

						if (sourceContent === existingContent) {
							// Files are identical - just delete source, keep existing
							await this.app.vault.delete(child);
							stats.filesSkipped++;
						} else {
							// Files differ - replace existing with source
							await this.app.fileManager.trashFile(existingFile);
							await this.app.fileManager.renameFile(child, childDestPath);
							stats.filesReplaced++;
						}
					} else {
						// No existing file - just move the source
						await this.app.fileManager.renameFile(child, childDestPath);
						stats.filesAdded++;
					}
				} catch (error) {
					// Track failed files but continue processing others
					stats.failedFiles.push(child.name);
					console.error(`Failed to process ${child.name}:`, error);
				}
			}
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
