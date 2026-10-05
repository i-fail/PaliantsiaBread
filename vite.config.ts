import { isAbsolute, relative, resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// BUILD_OUT_DIR lets a server build straight into the folder nginx serves.
function buildOutDir(value: string | undefined) {
  if (!value) return undefined
  const outDir = resolve(value)
  // The folder is emptied before each build, so refuse the project or any folder containing it.
  const fromOutDir = relative(outDir, process.cwd())
  if (!fromOutDir.startsWith('..') && !isAbsolute(fromOutDir)) {
    throw new Error(`BUILD_OUT_DIR (${outDir}) must be a folder outside the project, such as /var/www/palianytsia/dist.`)
  }
  return outDir
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const outDir = buildOutDir(env.BUILD_OUT_DIR)

  return {
    plugins: [vue()],
    build: outDir ? { outDir, emptyOutDir: true } : {},
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${env.API_PORT || 3001}`,
        '/sitemap.xml': `http://127.0.0.1:${env.API_PORT || 3001}`,
      },
    },
  }
})
