import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
} from "obsidian";

interface SimpleArchiverSettings {
	archiveFolder: string;
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
				let canBeArchived = !view.file?.path.startsWith(
					this.settings.archiveFolder
				);

				if (canBeArchived && view.file != null) {
					if (!checking) {
						this.moveToArchive(view.file).then();
					}

					return true;
				}

				return false;
			},
		});

		this.addSettingTab(new SimpleArchiverSettingsTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file.path.startsWith(this.settings.archiveFolder)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle("Move to archive")
						.setIcon("archive")
						.onClick(async () => {
							await this.moveToArchive(file);
						});
				});
			})
		);
	}

	onunload() {}

	async moveToArchive(file: TAbstractFile) {
		new Notice(
			`Archiving file ${file.path} to ${this.settings.archiveFolder}/${file.path}`
		);

		let destinationPath = `${this.settings.archiveFolder}/${file.parent?.path}`;

		let destinationFolder = this.app.vault.getFolderByPath(
			`${this.settings.archiveFolder}/${file.parent?.path}`
		);

		if (destinationFolder == null) {
			await this.app.vault.createFolder(destinationPath);
		}

		await this.app.fileManager.renameFile(
			file,
			`${this.settings.archiveFolder}/${file.path}`
		);

		new Notice(`${file.name} archived`);
	}

	async loadSettings() {
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
			.setName("Archive Folder")
			.setDesc(
				"The folder to use as the Archive. If the folder doesn't exist, it will be created when archiving a note."
			)
			.addText((text) =>
				text
					.setPlaceholder("Folder")
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
