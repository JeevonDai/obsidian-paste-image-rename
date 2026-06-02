import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = path.join(root, 'build')
const CONFIG_PATH = path.join(root, 'sync-plugin.config.json')
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json']

function syncPlugin() {
	if (!fs.existsSync(CONFIG_PATH)) {
		console.log('[sync-plugin] 跳过：未找到 sync-plugin.config.json')
		return
	}

	let config
	try {
		config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
	} catch (err) {
		console.error('[sync-plugin] 配置解析失败:', err)
		return
	}

	const pluginDir = config.pluginDir?.trim()
	if (!pluginDir) {
		console.log('[sync-plugin] 跳过：未配置 pluginDir')
		return
	}

	const manifestSrc = path.join(root, 'manifest.json')
	const manifestBuild = path.join(BUILD_DIR, 'manifest.json')
	if (fs.existsSync(manifestSrc)) {
		fs.mkdirSync(BUILD_DIR, { recursive: true })
		fs.copyFileSync(manifestSrc, manifestBuild)
	}

	fs.mkdirSync(pluginDir, { recursive: true })

	for (const name of ARTIFACTS) {
		const src = path.join(BUILD_DIR, name)
		if (!fs.existsSync(src)) {
			console.warn(`[sync-plugin] 缺少 ${src}，跳过该文件`)
			continue
		}
		fs.copyFileSync(src, path.join(pluginDir, name))
	}

	console.log(`[sync-plugin] 已同步到 ${pluginDir}`)
}

syncPlugin()
