import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from 'obsidian';

import { batchRenumberImages } from './batch';
import {
	DEBUG,
	debugLog,
	sanitizer,
} from './utils';

interface PluginSettings {
	dupNumberAtStart: boolean
	dupNumberDelimiter: string
	dupNumberAlways: boolean
	/** 序号起始值（第一张带序号的图片使用该数字） */
	numberStart: number
	disableRenameNotice: boolean
}

const DEFAULT_SETTINGS: PluginSettings = {
	dupNumberAtStart: false,
	dupNumberDelimiter: '_',
	dupNumberAlways: true,
	numberStart: 1,
	disableRenameNotice: false,
}

export default class PasteImageRenamePlugin extends Plugin {
	settings: PluginSettings

	async onload() {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const pkg = require('../package.json')
		console.log(`Plugin loading: ${pkg.name} ${pkg.version} BUILD_ENV=${process.env.BUILD_ENV}`)
		await this.loadSettings();

		const startBatchRenumber = () => {
			batchRenumberImages(this)
		}
		this.addCommand({
			id: 'batch-renumber-images',
			name: '按文档顺序重新编号图片（当前文件）',
			callback: startBatchRenumber,
		})
		if (DEBUG) {
			this.addRibbonIcon('wand-glyph', '按文档顺序重新编号图片', startBatchRenumber)
		}

		this.addSettingTab(new SettingTab(this.app, this));
	}

	getActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view?.file
		debugLog('active file', file?.path)
		return file
	}

	async loadSettings() {
		const data = await this.loadData();
		// 迁移旧版设置：忽略已删除的 imageNamePattern 等字段
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: PasteImageRenamePlugin;

	constructor(app: App, plugin: PasteImageRenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text: '图片名称固定为当前笔记文件名。批量重命名会修改附件文件名，并按文档顺序同步更新当前笔记中的嵌入链接',
		})

		new Setting(containerEl)
			.setName('Duplicate number at start (or end)')
			.setDesc('若启用，序号作为前缀；否则作为后缀。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAtStart)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAtStart = value
					await this.plugin.saveSettings()
				}
			))

		new Setting(containerEl)
			.setName('Duplicate number delimiter')
			.setDesc('文件名与序号之间的分隔符，例如 "_" 会生成 "笔记名_1.png"。')
			.addText(text => text
				.setValue(this.plugin.settings.dupNumberDelimiter)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberDelimiter = sanitizer.delimiter(value);
					await this.plugin.saveSettings();
				}
			))

		new Setting(containerEl)
			.setName('Always add duplicate number')
			.setDesc('若启用，所有图片均带序号；否则第一张无序号（笔记名.png），从第二张起编号。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dupNumberAlways)
				.onChange(async (value) => {
					this.plugin.settings.dupNumberAlways = value
					await this.plugin.saveSettings()
				}
			))

		new Setting(containerEl)
			.setName('Number start')
			.setDesc('序号起始值，默认为 1（生成 笔记名_1、笔记名_2…）。若关闭「始终加序号」，第一张仍无序号，第二张起使用该起始值。')
			.addText(text => text
				.setValue(String(this.plugin.settings.numberStart))
				.onChange(async (value) => {
					const n = parseInt(value, 10)
					this.plugin.settings.numberStart = Number.isFinite(n) && n >= 0 ? n : 1
					await this.plugin.saveSettings()
				}
			))

		new Setting(containerEl)
			.setName('Disable rename notice')
			.setDesc('关闭重命名时的提示通知。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.disableRenameNotice)
				.onChange(async (value) => {
					this.plugin.settings.disableRenameNotice = value;
					await this.plugin.saveSettings();
				}
			));
	}
}
