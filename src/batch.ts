import { App, Modal, Notice, Setting, TFile } from 'obsidian';

import { debugLog, escapeRegExp, path } from './utils';
import type PasteImageRenamePlugin from './main';

const IMAGE_EXT_PATTERN = /^(jpe?g|png|gif|tiff|webp|bmp|svg)$/i
const TMP_PREFIX = '.__pir_tmp__'

export function stemMatchesFileNamePattern(
	stem: string,
	fileNameStem: string,
	dupNumberAtStart: boolean,
	dupNumberDelimiter: string,
): boolean {
	if (stem === fileNameStem) return true
	const stemEscaped = escapeRegExp(fileNameStem)
	const delimEscaped = escapeRegExp(dupNumberDelimiter)
	if (dupNumberAtStart) {
		return new RegExp(`^\\d+${delimEscaped}${stemEscaped}$`).test(stem)
	}
	return new RegExp(`^${stemEscaped}${delimEscaped}\\d+$`).test(stem)
}

export function indexedStem(
	fileNameStem: string,
	index: number,
	dupNumberAtStart: boolean,
	dupNumberDelimiter: string,
	dupNumberAlways: boolean,
): string {
	const needsNumber = dupNumberAlways || index > 0
	if (!needsNumber) return fileNameStem
	const num = dupNumberAlways ? index + 1 : index
	if (dupNumberAtStart) {
		return `${num}${dupNumberDelimiter}${fileNameStem}`
	}
	return `${fileNameStem}${dupNumberDelimiter}${num}`
}

export async function batchRenumberImages(plugin: PasteImageRenamePlugin): Promise<void> {
	const activeFile = plugin.getActiveFile()
	if (!activeFile) {
		new Notice('错误：未找到当前活动文件。')
		return
	}

	const fileNameStem = activeFile.basename
	const { dupNumberAtStart, dupNumberDelimiter, dupNumberAlways, disableRenameNotice } = plugin.settings

	const fileCache = plugin.app.metadataCache.getFileCache(activeFile)
	if (!fileCache?.embeds?.length) {
		new Notice('当前文件中没有嵌入的图片。')
		return
	}

	const matched: TFile[] = []

	for (const embed of fileCache.embeds) {
		const file = plugin.app.metadataCache.getFirstLinkpathDest(embed.link, activeFile.path)
		if (!file || !IMAGE_EXT_PATTERN.test(file.extension)) continue
		if (!stemMatchesFileNamePattern(file.basename, fileNameStem, dupNumberAtStart, dupNumberDelimiter)) {
			continue
		}
		matched.push(file)
	}

	const tasks: { file: TFile; targetName: string }[] = []
	for (let i = 0; i < matched.length; i++) {
		const file = matched[i]
		const targetStem = indexedStem(
			fileNameStem,
			i,
			dupNumberAtStart,
			dupNumberDelimiter,
			dupNumberAlways,
		)
		const targetName = `${targetStem}.${file.extension}`
		if (file.name !== targetName) {
			tasks.push({ file, targetName })
		}
	}

	if (matched.length === 0) {
		new Notice('当前文件中没有名称前缀与当前笔记文件名匹配的图片。')
		return
	}
	if (tasks.length === 0) {
		new Notice('匹配的图片已按文档顺序正确编号，无需重命名。')
		return
	}

	new ConfirmModal(
		plugin.app,
		'确认批量重命名',
		`将按文档中的出现顺序，把 ${matched.length} 张匹配「${fileNameStem}」前缀的图片重新编号（其中 ${tasks.length} 张需要重命名）。`,
		() => executeRenames(plugin, tasks, disableRenameNotice),
	).open()
}

async function executeRenames(
	plugin: PasteImageRenamePlugin,
	tasks: { file: TFile; targetName: string }[],
	disableRenameNotice: boolean,
): Promise<void> {
	debugLog('batchRenumber tasks', tasks)

	// 两阶段重命名，避免目标文件名互相冲突
	const tempNames: string[] = []
	for (let i = 0; i < tasks.length; i++) {
		const { file } = tasks[i]
		const tempName = `${TMP_PREFIX}${i}.${file.extension}`
		tempNames.push(tempName)
		try {
			await plugin.app.fileManager.renameFile(
				file,
				path.join(file.parent.path, tempName),
			)
		} catch (err) {
			new Notice(`重命名失败 ${file.name}: ${err}`)
			return
		}
	}

	for (let i = 0; i < tasks.length; i++) {
		const tempPath = path.join(tasks[i].file.parent.path, tempNames[i])
		const tempFile = plugin.app.vault.getAbstractFileByPath(tempPath)
		if (!(tempFile instanceof TFile)) {
			new Notice(`重命名失败：找不到临时文件 ${tempNames[i]}`)
			return
		}
		const { targetName } = tasks[i]
		const originName = tempFile.name
		try {
			await plugin.app.fileManager.renameFile(
				tempFile,
				path.join(tempFile.parent.path, targetName),
			)
		} catch (err) {
			new Notice(`重命名失败 ${targetName}: ${err}`)
			return
		}
		if (!disableRenameNotice) {
			new Notice(`已重命名 ${originName} → ${targetName}`)
		}
	}

	if (!disableRenameNotice) {
		new Notice(`已完成 ${tasks.length} 张图片的顺序重编号。`)
	}
}

class ConfirmModal extends Modal {
	title: string
	message: string
	onConfirm: () => void

	constructor(app: App, title: string, message: string, onConfirm: () => void) {
		super(app);
		this.title = title
		this.message = message
		this.onConfirm = onConfirm
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title)
		contentEl.createEl('p', {
			text: this.message,
		})

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('确认')
					.setClass('mod-warning')
					.onClick(() => {
						this.onConfirm()
						this.close()
					})
			})
			.addButton(button => {
				button
					.setButtonText('取消')
					.onClick(() => { this.close() })
			})
	}
}
