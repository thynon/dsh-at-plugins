/**
 * install.mjs —— 把一个本地插件包挂进某个 profile（只改两处，幂等）
 *
 *   node install.mjs <profileDir> <pluginDir> [包名]
 *
 * ① dependencies 里加一条 `link:<pluginDir>`
 * ② dsh.profile.bundles 里追加包名
 *
 * 它不跑 pnpm —— 装依赖由调用方负责。
 */
import fs from 'node:fs'
import path from 'node:path'

const [profileDir, pluginDir, nameArg] = process.argv.slice(2)
if (!profileDir || !pluginDir) {
  console.error('usage: node install.mjs <profileDir> <pluginDir> [packageName]')
  process.exit(2)
}

const manifestPath = path.join(profileDir, 'package.json')
const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'))
const name = nameArg || pluginManifest.name
if (!name) throw new Error('plugin package.json has no name')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.dependencies = manifest.dependencies || {}
manifest.dependencies[name] = `link:${path.resolve(pluginDir)}`

manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const bundles = (manifest.dsh.profile.bundles = manifest.dsh.profile.bundles || [])
if (!bundles.includes(name)) bundles.push(name)

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ manifestPath, dependency: manifest.dependencies[name], bundles }, null, 2))
