import {
	Editor,
	MarkdownView,
	normalizePath,
	Notice,
	Plugin,
	TAbstractFile,
} from "obsidian";

import {
	AUTO_ARCHIVE_DEFAULT_SETTINGS,
	migrateAutoArchiveSettings,
	createAutoArchiveService,
	startAutoArchive,
	stopAutoArchiveScheduler,
	setupAutoArchiveContextMenu,
	AutoArchiveService,
	type ArchiveResult,
	type SimpleArchiverSettings,
} from "./autoarchive";
import { SimpleArchiverPromptModal } from "./modals";
import { SimpleArchiverSettingsTab } from "./SettingsTab";

const DEFAULT_SETTINGS: SimpleArchiverSettings = {
	archiveFolder: "Archive",
	...AUTO_ARCHIVE_DEFAULT_SETTINGS,
} as SimpleArchiverSettings;

export default class SimpleArchiver extends Plugin {
	settings: SimpleArchiverSettings;
	private autoArchiveService: AutoArchiveService;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "move-to-archive",
			name: "Move to archive",
			editorCheckCallback: (
				checking: boolean,
				editor: Editor,
				view: MarkdownView,
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
				view: MarkdownView,
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

		this.autoArchiveService = createAutoArchiveService(
			this.app,
			() => this.settings,
			(file) => this.archiveFile(file),
			(file) => this.isFileArchived(file),
			async (lastRunAt) => {
				this.settings.lastAutoArchiveRunAt = lastRunAt;
				await this.saveSettings();
			},
		);
		startAutoArchive(this.autoArchiveService);

		this.addSettingTab(
			new SimpleArchiverSettingsTab(
				this.app,
				this,
				this.autoArchiveService,
			),
		);

		// Setup auto-archive context menu
		setupAutoArchiveContextMenu(
			this.autoArchiveService,
			this.app.workspace,
			this,
		);

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
								new Notice(`Error: ${result.message}`);
								console.error(result.message);
							}
						});
				});
			}),
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
			}),
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
								new Notice(`Error: ${result.message}`);
								console.error(result.message);
							}
						});
				});
			}),
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
			}),
		);
	}

	private isFileArchived(file: TAbstractFile): boolean {
		return file.path.startsWith(this.settings.archiveFolder);
	}

	/**
	 * Safely resolves the original file path from an archived path.
	 * Handles edge cases like files at vault root or missing parent folders.
	 */
	private resolveOriginalPath(archivedPath: string): string | null {
		const archiveFolderPrefix = this.settings.archiveFolder + "/";

		// Check that the file is actually in the archive folder
		if (!archivedPath.startsWith(archiveFolderPrefix)) {
			console.error(`File is not in archive folder: ${archivedPath}`);
			return null;
		}

		// Remove the archive folder prefix to get the original path
		return archivedPath.substring(archiveFolderPrefix.length);
	}

	private async archiveFile(file: TAbstractFile): Promise<ArchiveResult> {
		if (this.isFileArchived(file)) {
			return { success: false, message: "Item is already archived" };
		}

		const destinationFilePath = normalizePath(
			`${this.settings.archiveFolder}/${file.path}`,
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
					},
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
		file: TAbstractFile,
	): Promise<ArchiveResult> {
		const destinationPath = normalizePath(
			`${this.settings.archiveFolder}/${file.parent?.path}`,
		);

		const destinationFolder =
			this.app.vault.getFolderByPath(destinationPath);

		if (destinationFolder == null) {
			await this.app.vault.createFolder(destinationPath);
		}

		const destinationFilePath = normalizePath(
			`${destinationPath}/${file.name}`,
		);

		try {
			await this.app.fileManager.renameFile(file, destinationFilePath);
			return {
				success: true,
				message: `${file.name} archived successfully`,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				success: false,
				message: `Unable to archive ${file.name}: ${errorMessage}`,
			};
		}
	}

	private async moveFileOutOfArchive(
		file: TAbstractFile,
	): Promise<ArchiveResult> {
		const originalPath = this.resolveOriginalPath(file.path);

		if (!originalPath) {
			return {
				success: false,
				message: `Unable to unarchive: Invalid archive path ${file.path}`,
			};
		}

		// Extract parent folder path by finding the last slash
		const lastSlashIndex = originalPath.lastIndexOf("/");
		const originalParentPath =
			lastSlashIndex > 0
				? originalPath.substring(0, lastSlashIndex)
				: null;

		if (originalParentPath) {
			const originalFolder =
				this.app.vault.getFolderByPath(originalParentPath);

			if (!originalFolder) {
				try {
					await this.app.vault.createFolder(
						normalizePath(originalParentPath),
					);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						success: false,
						message: `Unable to create folder: ${errorMessage}`,
					};
				}
			}
		}

		try {
			await this.app.fileManager.renameFile(
				file,
				normalizePath(originalPath),
			);
			return {
				success: true,
				message: `${file.name} unarchived successfully`,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				success: false,
				message: `Unable to unarchive ${file.name}: ${errorMessage}`,
			};
		}
	}

	private async unarchiveFile(file: TAbstractFile): Promise<ArchiveResult> {
		if (!this.isFileArchived(file)) {
			return { success: false, message: "Item is not archived" };
		}

		const originalPath = this.resolveOriginalPath(file.path);

		if (!originalPath) {
			return {
				success: false,
				message: `Unable to unarchive: Invalid archive path`,
			};
		}

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
					},
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
		stopAutoArchiveScheduler(this.autoArchiveService);
	}

	private async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);

		// Migrate auto-archive settings for backward compatibility
		const { changed } = migrateAutoArchiveSettings(this.settings);

		// Persist the migration if any changes were made
		if (changed) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
