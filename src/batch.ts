import { App, EmbedCache, Modal, Notice, Setting, TFile, Vault } from 'obsidian';

import {
	updateNoteEmbedLinks,
} from './embed-links';
import { debugLog, escapeRegExp, path, renameVaultAttachment } from './utils';
import type PasteImageRenamePlugin from './main';

const IMAGE_EXT_PATTERN = /^(jpe?g|png|gif|tiff|webp|bmp|svg)$/i
/** 与任何笔记命名规则无关的临时前缀，保证阶段 1 不与文件夹内已有文件冲突 */
const TMP_PREFIX = '.__pir_'
const BARE_INTERMEDIATE_BASENAME_SUFFIX = '.__pir_bare__'

interface MatchedEmbed {
	embed: EmbedCache
	file: TFile
}

export function stemMatchesFileNamePattern(
	stem: string,
	fileNameStem: string,
	dupNumberAtStart: boolean,
	delimiter: string,
): boolean {
	if (stem === fileNameStem) return true
	const stemEscaped = escapeRegExp(fileNameStem)
	const delimEscaped = escapeRegExp(delimiter)
	if (dupNumberAtStart) {
		return new RegExp(`^\\d+${delimEscaped}${stemEscaped}$`).test(stem)
	}
	return new RegExp(`^${stemEscaped}${delimEscaped}\\d+$`).test(stem)
}

export function indexedStem(
	fileNameStem: string,
	index: number,
	dupNumberAtStart: boolean,
	delimiter: string,
	dupNumberAlways: boolean,
	numberStart: number,
): string {
	const needsNumber = dupNumberAlways || index > 0
	if (!needsNumber) return fileNameStem
	const num = numberStart + index - (dupNumberAlways ? 0 : 1)
	if (dupNumberAtStart) {
		return `${num}${delimiter}${fileNameStem}`
	}
	return `${fileNameStem}${delimiter}${num}`
}

function stemFromFileName(fileName: string): string {
	const dot = fileName.lastIndexOf('.')
	return dot >= 0 ? fileName.slice(0, dot) : fileName
}

function isBareFinalName(fileName: string, fileNameStem: string): boolean {
	return stemFromFileName(fileName) === fileNameStem
}

function tempFileName(batchId: string, index: number, extension: string): string {
	return `${TMP_PREFIX}${batchId}_${index}.${extension}`
}

function bareIntermediateBasename(fileNameStem: string): string {
	return `${fileNameStem}${BARE_INTERMEDIATE_BASENAME_SUFFIX}`
}

function bareIntermediateName(fileNameStem: string, extension: string): string {
	return `${bareIntermediateBasename(fileNameStem)}.${extension}`
}

function resolveFile(vault: Vault, parentPath: string, file: TFile): TFile | null {
	const resolved = vault.getAbstractFileByPath(path.join(parentPath, file.name))
	return resolved instanceof TFile ? resolved : null
}

function resolveFileByName(vault: Vault, parentPath: string, name: string): TFile | null {
	const resolved = vault.getAbstractFileByPath(path.join(parentPath, name))
	return resolved instanceof TFile ? resolved : null
}

function splitPhase2Order(
	finalNames: string[],
	fileNameStem: string,
	dupNumberAtStart: boolean,
): { numbered: number[]; bare: number[] } {
	const numbered: number[] = []
	const bare: number[] = []
	for (let i = 0; i < finalNames.length; i++) {
		if (isBareFinalName(finalNames[i], fileNameStem)) {
			bare.push(i)
		} else {
			numbered.push(i)
		}
	}
	if (!dupNumberAtStart) {
		numbered.reverse()
	}
	return { numbered, bare }
}

function collectMatchedEmbeds(
	plugin: PasteImageRenamePlugin,
	activeFile: TFile,
): MatchedEmbed[] | null {
	const fileNameStem = activeFile.basename
	const {
		dupNumberAtStart,
		dupNumberDelimiter,
	} = plugin.settings

	const fileCache = plugin.app.metadataCache.getFileCache(activeFile)
	if (!fileCache?.embeds?.length) return null

	const matched: MatchedEmbed[] = []

	for (const embed of fileCache.embeds) {
		const file = plugin.app.metadataCache.getFirstLinkpathDest(embed.link, activeFile.path)
		if (!file || !IMAGE_EXT_PATTERN.test(file.extension)) continue
		const matchesPrimary = stemMatchesFileNamePattern(
			file.basename, fileNameStem, dupNumberAtStart, dupNumberDelimiter,
		)
		const matchesTemp = file.basename.startsWith(TMP_PREFIX)
		const matchesBareIntermediate = file.basename === bareIntermediateBasename(fileNameStem)
		if (!matchesPrimary && !matchesTemp && !matchesBareIntermediate) continue
		matched.push({ embed, file })
	}

	return matched.length > 0 ? matched : null
}

function resolveFinalFiles(
	vault: Vault,
	parentPath: string,
	finalNames: string[],
): TFile[] {
	return finalNames.map((name) => {
		const file = vault.getAbstractFileByPath(path.join(parentPath, name))
		if (!(file instanceof TFile)) {
			throw new Error(`找不到最终文件 ${name}`)
		}
		return file
	})
}

export async function batchRenumberImages(plugin: PasteImageRenamePlugin): Promise<void> {
	const activeFile = plugin.getActiveFile()
	if (!activeFile) {
		new Notice('错误：未找到当前活动文件。')
		return
	}

	const fileNameStem = activeFile.basename
	const {
		dupNumberAtStart,
		dupNumberDelimiter,
		dupNumberAlways,
		numberStart,
		disableRenameNotice,
	} = plugin.settings

	const matchedEntries = collectMatchedEmbeds(plugin, activeFile)
	if (!matchedEntries) {
		new Notice('当前文件中没有可批量重命名的嵌入图片。')
		return
	}

	const finalNames = matchedEntries.map((_, i) =>
		`${indexedStem(fileNameStem, i, dupNumberAtStart, dupNumberDelimiter, dupNumberAlways, numberStart)}.${matchedEntries[i].file.extension}`,
	)

	const needsFileRename = matchedEntries.some((entry, i) => entry.file.name !== finalNames[i])
	const needsLinkUpdate = matchedEntries.some((entry, i) => {
		const dest = plugin.app.metadataCache.getFirstLinkpathDest(
			entry.embed.link,
			activeFile.path,
		)
		return dest?.name !== finalNames[i]
	})

	if (!needsFileRename && !needsLinkUpdate) {
		new Notice('匹配的图片与笔记内链接已按文档顺序正确，无需处理。')
		return
	}

	new ConfirmModal(
		plugin.app,
		'确认批量重命名',
		`将按文档中的出现顺序，把 ${matchedEntries.length} 张匹配「${fileNameStem}」前缀的图片重新编号，并同步更新本笔记中的嵌入链接。`,
		() => executeTwoPhaseRenames(
			plugin,
			activeFile,
			matchedEntries,
			finalNames,
			fileNameStem,
			dupNumberAtStart,
			disableRenameNotice,
			needsFileRename,
		),
	).open()
}

/** 将目录中仍占用「无后缀 basename」的其它文件挪开，避免阶段 2 无法命名为 TEST.png */
async function vacateBareNameSlot(
	plugin: PasteImageRenamePlugin,
	parentPath: string,
	fileNameStem: string,
	batchId: string,
	reservedNames: Set<string>,
): Promise<void> {
	const listed = await plugin.app.vault.adapter.list(parentPath)
	let orphanIndex = 0
	for (const fullPath of listed.files) {
		const name = path.basename(fullPath)
		if (reservedNames.has(name)) continue
		if (name.startsWith(TMP_PREFIX)) continue
		const file = plugin.app.vault.getAbstractFileByPath(path.join(parentPath, name))
		if (!(file instanceof TFile)) continue
		if (!IMAGE_EXT_PATTERN.test(file.extension)) continue
		if (file.basename !== fileNameStem) continue
		const vacateName = `${TMP_PREFIX}vacate_${batchId}_${orphanIndex}.${file.extension}`
		orphanIndex++
		try {
			await renameVaultAttachment(
				plugin.app,
				file,
				path.join(parentPath, vacateName),
			)
			debugLog('vacateBareNameSlot', name, '→', vacateName)
		} catch (err) {
			new Notice(`无法移开占用名称 ${name} 的文件: ${err}`)
			throw err
		}
	}
}

async function renameToFinal(
	plugin: PasteImageRenamePlugin,
	parentPath: string,
	file: TFile,
	finalName: string,
	fileNameStem: string,
): Promise<TFile> {
	const finalPath = path.join(parentPath, finalName)
	if (!isBareFinalName(finalName, fileNameStem)) {
		return renameVaultAttachment(plugin.app, file, finalPath)
	}

	const intermediateName = bareIntermediateName(fileNameStem, file.extension)
	const intermediatePath = path.join(parentPath, intermediateName)

	let current = file
	if (current.name !== intermediateName) {
		current = await renameVaultAttachment(plugin.app, current, intermediatePath)
	}
	if (current.name !== finalName) {
		current = await renameVaultAttachment(plugin.app, current, finalPath)
	}
	return current
}

async function executeTwoPhaseRenames(
	plugin: PasteImageRenamePlugin,
	activeFile: TFile,
	matchedEntries: MatchedEmbed[],
	finalNames: string[],
	fileNameStem: string,
	dupNumberAtStart: boolean,
	disableRenameNotice: boolean,
	needsFileRename: boolean,
): Promise<void> {
	const parentPath = matchedEntries[0].file.parent.path

	if (needsFileRename) {
		const batchId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
		const tempNames = matchedEntries.map((entry, i) =>
			tempFileName(batchId, i, entry.file.extension),
		)
		const { numbered, bare } = splitPhase2Order(finalNames, fileNameStem, dupNumberAtStart)

		debugLog('batchRenumber batchId', batchId)
		debugLog('batchRenumber tempNames', tempNames)
		debugLog('batchRenumber finalNames', finalNames)

		for (let i = 0; i < matchedEntries.length; i++) {
			const tempName = tempNames[i]
			let file = resolveFile(plugin.app.vault, parentPath, matchedEntries[i].file)
			if (!file) {
				new Notice(`阶段 1 失败：找不到 ${matchedEntries[i].file.name}`)
				return
			}
			if (file.name === tempName) continue
			try {
				await renameVaultAttachment(
					plugin.app,
					file,
					path.join(parentPath, tempName),
				)
			} catch (err) {
				new Notice(`阶段 1 重命名失败 ${file.name} → ${tempName}: ${err}`)
				return
			}
		}

		const reservedNames = new Set(tempNames)

		for (const i of numbered) {
			const tempPath = path.join(parentPath, tempNames[i])
			const tempFile = plugin.app.vault.getAbstractFileByPath(tempPath)
			if (!(tempFile instanceof TFile)) {
				new Notice(`阶段 2 失败：找不到 ${tempNames[i]}`)
				return
			}
			const finalName = finalNames[i]
			if (tempFile.name === finalName) continue
			const originName = tempFile.name
			try {
				await renameToFinal(
					plugin,
					parentPath,
					tempFile,
					finalName,
					fileNameStem,
				)
			} catch (err) {
				new Notice(`阶段 2 重命名失败 ${originName} → ${finalName}: ${err}`)
				return
			}
			if (!disableRenameNotice) {
				new Notice(`已重命名 ${originName} → ${finalName}`)
			}
			reservedNames.add(finalName)
		}

		if (bare.length > 0) {
			try {
				await vacateBareNameSlot(
					plugin,
					parentPath,
					fileNameStem,
					batchId,
					reservedNames,
				)
			} catch {
				return
			}
		}

		for (const i of bare) {
			const tempPath = path.join(parentPath, tempNames[i])
			const tempFile = plugin.app.vault.getAbstractFileByPath(tempPath)
			if (!(tempFile instanceof TFile)) {
				new Notice(`阶段 2 失败：找不到 ${tempNames[i]}`)
				return
			}
			const finalName = finalNames[i]
			if (tempFile.name === finalName) continue
			const originName = tempFile.name
			try {
				await renameToFinal(
					plugin,
					parentPath,
					tempFile,
					finalName,
					fileNameStem,
				)
			} catch (err) {
				new Notice(`阶段 2 重命名失败 ${originName} → ${finalName}: ${err}`)
				return
			}
			if (!disableRenameNotice) {
				new Notice(`已重命名 ${originName} → ${finalName}`)
			}
		}
	}

	let finalFiles: TFile[]
	try {
		finalFiles = resolveFinalFiles(plugin.app.vault, parentPath, finalNames)
	} catch (err) {
		new Notice(`重命名完成但无法定位最终文件: ${err}`)
		return
	}

	try {
		await updateNoteEmbedLinks(
			plugin.app,
			activeFile,
			matchedEntries.map((entry, i) => ({
				embed: entry.embed,
				finalFile: finalFiles[i],
			})),
		)
	} catch (err) {
		new Notice(`附件已重命名，但更新笔记内链接失败: ${err}`)
		return
	}

	if (!disableRenameNotice) {
		new Notice(`已完成 ${matchedEntries.length} 张图片的顺序重编号，并更新了本笔记中的嵌入链接。`)
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
