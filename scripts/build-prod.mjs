import { spawnSync } from 'child_process'

process.env.BUILD_ENV = 'production'

const result = spawnSync('node', ['esbuild.config.mjs'], {
	stdio: 'inherit',
	shell: true,
	env: process.env,
})

process.exit(result.status ?? 1)
