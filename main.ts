import {
	App,
	Editor,
	MarkdownView,
	Modal,
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

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Sample Plugin",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				new Notice("This is a notice!");
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SimpleArchiverModal(this.app).open();
			},
		});

		this.addCommand({
			id: "move-to-archive",
			name: "Move to Archive",
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (view.file != null) {
					await this.moveToArchive(view.file);
				}
			},
		});

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SimpleArchiverModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		this.addSettingTab(new SimpleArchiverSettingsTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				menu.addItem((item) => {
					item.setTitle("Archive")
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

		console.log(file);

		this.app.fileManager.renameFile(
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

class SimpleArchiverModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
