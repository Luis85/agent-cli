import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test as base, expect } from '@playwright/test'

const exec = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))

interface ServerData {
  running: boolean
  url: string | null
  server: { port: number; pid: number } | null
}

interface ForgeFixture {
  url: string
  origin: string
  token: string
  workspace: string
}

/** Consume the public distribution only; no sibling project source or toolchain imports. */
export const test = base.extend<{}, { forge: ForgeFixture }>({
  forge: [async ({}, use) => {
    const distribution = dirname(resolve(process.env.FORGE_CLI ?? join(projectRoot, '../../bin/forge.js')))
    const workspace = await mkdtemp(join(tmpdir(), 'forge-admin-e2e-'))
    const binary = join(workspace, 'bin/forge.js')
    const cli = async (args: string[]): Promise<ServerData> => {
      const { stdout } = await exec(process.execPath, [binary, ...args, '--json'], {
        cwd: workspace, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
      }).catch((error: Error & { stdout?: string }) => {
        if (error.stdout?.trim().startsWith('{')) return { stdout: error.stdout }
        throw error
      })
      const result = JSON.parse(stdout)
      if (!result.ok) throw new Error(`Forge command failed: ${args.join(' ')} (${result.error?.code}): ${result.error?.message}`)
      return result.data
    }
    let startupAttempted = false
    try {
      await cp(distribution, join(workspace, 'bin'), { recursive: true })
      const config = JSON.parse(await readFile(join(workspace, 'bin/config/default.json'), 'utf8'))
      config.plugins.disabled = ['claude']
      await writeFile(join(workspace, 'bin/config.json'), JSON.stringify(config))
      await rm(join(workspace, 'bin/data/context.json'), { force: true })
      const mount = join(workspace, 'bin/webviews/admin')
      await rm(mount, { recursive: true, force: true })
      await mkdir(mount, { recursive: true })
      await cp(join(projectRoot, 'dist'), mount, { recursive: true })
      await cli(['setup'])
      await cli(['project', 'create', 'inspection-fixture'])
      await cli(['project', 'open', 'inspection-fixture'])
      // Even a timed-out CLI call may have spawned the detached process. Always
      // attempt the authenticated stop after startup, including setup failures.
      startupAttempted = true
      const status = await cli(['server', 'start', '--port', '0', '--webview', 'admin'])
      if (!status.running || !status.url) throw new Error('CLI did not return a running admin webview URL')
      const url = new URL(status.url)
      const token = new URLSearchParams(url.hash.slice(1)).get('token')
      if (!token) throw new Error('CLI admin URL did not contain a fragment access token')
      await use({ url: status.url, origin: url.origin, token, workspace })
    } finally {
      if (startupAttempted) {
        try {
          await cli(['server', 'stop'])
          const status = await cli(['server', 'status'])
          if (status.running) throw new Error('CLI server stop did not shut down the browser-test server')
        } catch (error) {
          throw new Error(`Server cleanup failed; workspace retained for CLI recovery: ${workspace}`, { cause: error })
        }
      }
      await rm(workspace, { recursive: true, force: true })
    }
  }, { scope: 'worker', timeout: 60_000 }],
})

export { expect }
