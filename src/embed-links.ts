import { App, EmbedCache, TFile } from 'obsidian';

import { debugLog } from './utils';

export interface EmbedLinkUpdate {
	embed: EmbedCache
	finalFile: TFile
}

/** 从 generateMarkdownLink 结果中取出链接目标（不含括号与尖括号） */
export function extractLinkTarget(app: App, file: TFile, sourcePath: string): string {
	const generated = app.fileManager.generateMarkdownLink(file, sourcePath)
	const md = generated.match(/^!\[[^\]]*\]\((<?)([^>)]+)>?\)/)
	if (md) return md[2]
	const wiki = generated.match(/^\!\[\[([^\]]+)\]\]/)
	if (wiki) return wiki[1]
	return file.path
}

/** 仅替换嵌入图片的目标路径，保留原有 alt 与 `<>` 写法 */
export function replaceEmbedTarget(oldEmbed: string, newTarget: string): string {
	const m = oldEmbed.match(/^(!\[[^\]]*\]\()(<?)([^>)]+)(>?\))$/)
	if (!m) return oldEmbed
	const prefix = m[1]
	const useAngle = m[2] === '<'
	const inner = useAngle ? `<${newTarget}>` : newTarget
	return `${prefix}${inner})`
}

export function embedResolvesToFile(
	app: App,
	embed: EmbedCache,
	notePath: string,
	file: TFile,
): boolean {
	const dest = app.metadataCache.getFirstLinkpathDest(embed.link, notePath)
	return dest?.path === file.path
}

/**
 * 按嵌入在正文中的位置（从后往前）更新链接，避免偏移错乱。
 */
export async function updateNoteEmbedLinks(
	app: App,
	noteFile: TFile,
	updates: EmbedLinkUpdate[],
): Promise<void> {
	if (updates.length === 0) return

	const content = await app.vault.read(noteFile)
	const sorted = [...updates].sort(
		(a, b) => b.embed.position.start.offset - a.embed.position.start.offset,
	)

	let newContent = content
	for (const { embed, finalFile } of sorted) {
		const start = embed.position.start.offset
		const end = embed.position.end.offset
		if (start < 0 || end > newContent.length || start >= end) {
			console.warn('[embed-links] 无效嵌入位置', embed)
			continue
		}
		const oldEmbed = newContent.slice(start, end)
		const target = extractLinkTarget(app, finalFile, noteFile.path)
		const newEmbed = replaceEmbedTarget(oldEmbed, target)
		if (newEmbed === oldEmbed) continue
		debugLog('embed link', oldEmbed, '→', newEmbed)
		newContent = newContent.slice(0, start) + newEmbed + newContent.slice(end)
	}

	if (newContent !== content) {
		await app.vault.modify(noteFile, newContent)
	}
}
