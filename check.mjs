/**
 * check.mjs —— 不开浏览器、不装 DSH，在 Node 里把 client.js 跑一遍
 * ============================================================================
 * 检查的是逻辑，不是长相：
 *   ① apply() 有没有把 @ 来源注册进 inputTriggers
 *   ② 插件候选：系统 / 用户 两组、系统在前、未启用的排后面且带标记
 *   ③ 会话候选：按 cwd 归到文件夹标题下，当前文件夹排最前，子代理有标记
 *   ④ onPick 插出来的文本，能不能被 UserText 规则原样认回来
 *   ⑤ chip 渲染器拿到 node 时不抛错
 *
 *   node check.mjs
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/* --- 极简 React 替身 --- */
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.length ? (children.length === 1 ? children[0] : children) : undefined } }
  },
  Component: class {
    constructor(props) { this.props = props }
  },
}

const tree = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) { tree.push(entry) },
  },
}

/* --- DOM 替身：菜单增强那部分要有一点点环境 --- */
const observers = []
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this) }
  observe() {}
  disconnect() {}
  fire() { this.callback([]) }
}
globalThis.requestAnimationFrame = (fn) => { fn(); return 1 }
globalThis.cancelAnimationFrame = () => {}

/* --- 够用的元素替身：折叠按钮的点击回环要真的跑一遍 --- */
class FakeEl {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.nodeType = 1
    this.attrs = new Map()
    this.childNodes = []
    this.style = {}
    this.dataset = {}
    this.className = ''
    this._listeners = new Map()
  }

  get children() { return this.childNodes.filter((node) => node.nodeType === 1) }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  appendChild(node) { this.childNodes.push(node); node.parentNode = this; return node }
  remove() { const parent = this.parentNode; if (!parent) return; const at = parent.childNodes.indexOf(this); if (at >= 0) parent.childNodes.splice(at, 1) }
  addEventListener(type, fn) { const list = this._listeners.get(type) || []; list.push(fn); this._listeners.set(type, list) }
  dispatch(type, event = {}) {
    const payload = { type, preventDefault() {}, stopPropagation() {}, ...event }
    for (const fn of this._listeners.get(type) || []) fn(payload)
    return payload
  }
  querySelector(selector) {
    if (selector === ':scope > button.dshatp-fold') {
      return this.children.find((child) => child.tagName === 'BUTTON' && /dshatp-fold/.test(child.className)) || null
    }
    return null
  }
  get textContent() { return this.childNodes.map((node) => node.textContent || '').join('') }
  set textContent(value) { this.childNodes = [{ nodeType: 3, textContent: String(value) }] }
}

const menuLists = []
const fakeDocument = {
  body: new FakeEl('body'),
  head: new FakeEl('head'),
  createElement: (tag) => new FakeEl(tag),
  querySelectorAll: (selector) => (selector === '[role="listbox"]' ? menuLists : []),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
}

/* 插件 bundle 是通过 new Function 传参拿 document 的，所以这里就得是最终那份替身。 */
globalThis.document = fakeDocument

/* --- 夹具：pluginManager.listBundles 的真实形状 ---
 * installation = 随客户端发（系统）；只在 profile dependencies 里的是用户装的。 */
const BUNDLES = [
  { name: 'dshmarket', official: false, availability: 'profile', version: '1.70.2', description: '插件市场', meta: { title: '插件市场' }, enabled: true, installed: true, optional: false },
  { name: 'dsh-better-sidebar', official: false, availability: 'profile', version: '0.28.1', meta: { title: { zh: '更好的侧边栏', en: 'Better Sidebar' } }, enabled: true, installed: true, optional: false },
  { name: '@dougen/dsh-deepseek-usage', official: false, availability: 'profile', version: '0.15.0', enabled: false, installed: true, optional: false },
  { name: '@deepseek-ai/dsh-experimental-voice', official: true, availability: 'missing', enabled: false, installed: false, optional: true },
  { name: 'dsh-plugin-save-token', official: false, availability: 'profile', version: '2.4.1', description: '省 token', enabled: false, installed: true, optional: false },
  { name: '@deepseek-ai/dsh-web-app', official: false, availability: 'installation', version: '0.2.1-rc.3', enabled: true, installed: false, optional: false },
  { name: '@deepseek-ai/dsh-experimental-auto-review', official: true, availability: 'installation', version: '0.2.1-rc.3', enabled: false, installed: false, optional: true },
]

/* --- 夹具：ui-reference 会返回的行 --- */
const REFERENCE_ROWS = [
  { name: 'readme.md', description: 'docs', icon: 'file', section: '文件', value: JSON.stringify({ kind: 'file', fileKind: 'file', label: 'readme.md', mention: '@readme.md' }) },
  { name: '子会话', description: '3min', icon: 'session', section: '子会话', value: JSON.stringify({ kind: 'session', label: '子会话', mention: '@[子会话](dsh-session:sub1)' }) },
  { name: '修 bug', description: '1h', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '修 bug', mention: '@[修 bug](dsh-session:s1)' }) },
  { name: '看盘', description: '现在', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '看盘', mention: '@[看盘](dsh-session:s2)' }) },
  { name: '老会话', description: '2d', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '老会话', mention: '@[老会话](dsh-session:gone)' }) },
]

const SESSIONS = {
  list: {
    getSnapshot() {
      return {
        byId: {
          current: { cwd: '/Users/gavin/Documents/proj-a' },
          s1: { cwd: '/Users/gavin/Documents/proj-a' },
          s2: { cwd: '/Users/gavin/Documents/proj-b' },
          sub1: { cwd: '/Users/gavin/Documents/proj-a', origin: 'subagent' },
        },
      }
    },
  },
}

const DICT = {
  'section.system': '系统',
  'section.user': '用户',
  'section.disabled': '未启用',
  'section.folder.unknown': '其他文件夹',
  'row.subagent': '子代理',
  'fold.label': '折叠',
  'error.title': '读不到',
  'error.hint': '再试',
}

const localeStub = {
  register() { return () => {} },
  bind() { return (key) => DICT[key] ?? key },
  resolveText(value) { return value && typeof value === 'object' ? (value.zh ?? value.en ?? JSON.stringify(value)) : value },
}

const calls = { sources: [], effects: [], renderer: undefined }

function makeCtx({ withSessions = true, brokenRemote = false } = {}) {
  const live = { sources: [] }
  const inputTriggers = {
    live,
    registerSource(src) {
      calls.sources.push(src)
      live.sources.push(src)
      return () => { const at = live.sources.indexOf(src); if (at >= 0) live.sources.splice(at, 1) }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'locale') return localeStub
      if (name === 'inputTriggers') return inputTriggers
      if (name === 'uiConversation') return { userText: { register(rule) { calls.effects.push(rule); return () => {} } } }
      if (name === 'slots') return {
        inject(_n, fn) { for (const _ of fn()) { /* 消费掉 */ } },
        register(meta, component) { calls.renderer = { meta, component }; return () => {} },
      }
      if (name === 'sessions') return withSessions ? SESSIONS : undefined
      if (name === 'remote') return {
        pluginManager: {
          async listBundles() {
            if (brokenRemote) throw new Error('offline')
            return { ok: true, value: BUNDLES }
          },
        },
      }
      return undefined
    },
    effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
  }
  return ctx
}

/* --- 跑插件 --- */
const source = readFileSync(join(HERE, 'client.js'), 'utf8')
new Function('window', 'document', 'console', source)(globalThis.window, globalThis.document, console)
if (tree.length !== 1) throw new Error(`expected 1 module entry, got ${tree.length}`)
const entry = tree[0]
if (entry.id !== 'dsh-at-plugins') throw new Error(`module id mismatch: ${entry.id}`)

const plugin = entry.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

const fails = []
const ok = (label, cond, detail) => {
  if (!cond) fails.push(`${label}${detail === undefined ? '' : `: ${detail}`}`)
  else console.log(`  ✓ ${label}`)
}

/* 先挂一个假的 reference 来源，模拟 ui-reference 比我们先到。 */
const ctx = makeCtx()
const reference = {
  trigger: '@',
  name: 'reference',
  async candidates() { return REFERENCE_ROWS.map((row) => ({ ...row })) },
  onPick() { return undefined },
}
ctx.get('inputTriggers').registerSource(reference)

plugin.apply(ctx)

const src = calls.sources.find((item) => item.name === 'plugins')
ok('注册了 @ 插件来源', src !== undefined && src.trigger === '@')
ok('没有重复注册 reference', calls.sources.filter((item) => item.name === 'reference').length === 1)

/* --- ① 插件候选：系统 / 用户 --- */
const rows = await src.candidates({ sessionId: 'current' }, { query: '' })
const names = rows.map((row) => row.name)
const sections = [...new Set(rows.map((row) => row.section))]
console.log('    插件候选:', JSON.stringify(rows, null, 0))
ok('列出所有在跑的插件（5 个）', rows.length === 5, `got ${rows.length}: ${JSON.stringify(names)}`)
ok('已安装的官方可选包不列', !names.some((n) => n.includes('voice')))
ok('随包发但没启用的不列', !names.some((n) => n.includes('auto-review')))
ok('两组：系统、用户', sections.join('|') === '系统|用户', JSON.stringify(sections))
ok('系统排在用户前面', rows[0].section === '系统' && rows[0].name === 'web-app')
ok('profile 依赖归「用户」', rows.filter((r) => r.section === '用户').length === 4)
ok('installation 里的包归「系统」', rows.filter((r) => r.section === '系统').length === 1)
ok('未启用的排在组内后面并带标记', rows[rows.length - 1].description.includes('未启用'), rows[rows.length - 1].description)
ok('本地化标题生效', names.includes('更好的侧边栏'), JSON.stringify(names))

const filtered = await src.candidates({ sessionId: 'current' }, { query: '侧边' })
ok('查询过滤', filtered.length === 1 && filtered[0].name === '更好的侧边栏', JSON.stringify(filtered.map((r) => r.name)))

/* --- ② 会话候选按文件夹分组（拦 reference 来源） --- */
const refRows = await reference.candidates({ sessionId: 'current' }, { query: '' })
const refSections = [...new Set(refRows.map((row) => row.section))]
console.log('    会话候选:', JSON.stringify(refRows.map((row) => `${row.section} / ${row.name} (${row.description})`)))
ok('文件行保持原样', refRows[0].section === '文件' && refRows[0].name === 'readme.md')
ok('会话改成按文件夹分组', refSections.join('|') === '文件|proj-a|proj-b|会话', JSON.stringify(refSections))
ok('当前文件夹排最前', refSections[1] === 'proj-a')
ok('子会话归进它所在的文件夹', refRows.find((r) => r.name === '子会话').section === 'proj-a')
ok('子代理在描述里有标记', refRows.find((r) => r.name === '子会话').description.includes('子代理'), refRows.find((r) => r.name === '子会话').description)
ok('会话一行不丢', refRows.length === REFERENCE_ROWS.length)
ok('本地查不到的会话退回「会话」组并排在最后', refRows[refRows.length - 1].name === '老会话' && refRows[refRows.length - 1].section === '会话')
ok('下钻视图不重排', (await reference.candidates({ sessionId: 'current' }, { query: 'x', drilled: true })).length === REFERENCE_ROWS.length)

/* --- ③ 没有 sessions 服务时原样返回 --- */
const bare = makeCtx({ withSessions: false })
const bareRef = { trigger: '@', name: 'reference', async candidates() { return REFERENCE_ROWS.map((row) => ({ ...row })) } }
bare.get('inputTriggers').registerSource(bareRef)
plugin.apply(bare)
const bareRows = await bareRef.candidates({ sessionId: 'current' }, { query: '' })
ok('没有 sessions 服务时不重排也不丢行', bareRows.length === REFERENCE_ROWS.length && bareRows[2].section === '会话')

/* --- ④ 插入的文本能被规则认回来 --- */
const market = rows.find((row) => row.value.includes('"dshmarket"'))
const picked = src.onPick({ candidate: market, action: 'pick' })
console.log('    插入:', JSON.stringify(picked))
const inserted = picked && picked.insert
ok('选中后插的是原子引用，不是纯文本', picked.text === undefined && inserted !== undefined, JSON.stringify(picked))
ok('引用归属 plugins 来源', inserted.source === 'plugins')
ok('引用里带 mention', inserted.ref.startsWith('@[') && inserted.ref.includes('(dsh-plugin:dshmarket)'))
ok('chip 上显示标题', inserted.label === '插件市场')
ok('不给 appearance（走中性 @ chip）', inserted.appearance === undefined)
ok('codec 把 chip 序列化回 mention', await src.codec.serialize(inserted.ref) === inserted.ref)
ok('剪贴板形态与引用一致', src.codec.clipboardText(inserted.ref) === inserted.ref)

const rule = calls.effects.find((item) => item && item.id === 'plugin')
ok('注册了 user-text 规则 plugin', rule !== undefined)
const text = `帮我用 ${inserted.ref} 看看`
const node = rule.match(text, 0)
ok('规则认得出 mention', node !== undefined && node.id === 'plugin' && node.start === text.indexOf('@['))
ok('规则解出标题与包名', node && node.data.name === 'dshmarket' && node.data.title === '插件市场', JSON.stringify(node && node.data))
ok('规则区间覆盖整段引用', node && text.slice(node.start, node.end) === inserted.ref)
ok('规则在引用之后继续扫', rule.match(text, node.end) === undefined)

/* --- ⑤ 远端挂了 / chip 渲染 --- */
const broken = makeCtx({ brokenRemote: true })
plugin.apply(broken)
const brokenSrc = calls.sources.filter((item) => item.name === 'plugins').pop()
const brokenRows = await brokenSrc.candidates({ sessionId: 'current' }, { query: '' })
ok('远端挂了也返回提示行', brokenRows.length === 1 && brokenRows[0].name === '读不到')

function render(el) {
  if (el === null || el === undefined || typeof el !== 'object') return el
  const { type, props } = el
  if (typeof type === 'function' && !(type.prototype && type.prototype.render)) return render(type(props || {}))
  if (typeof type === 'function' && type.prototype && type.prototype.render) {
    const instance = new type(props || {})
    instance.state = {}
    return render(instance.render())
  }
  const children = props && props.children
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children]
  return { type, props: { ...props, children: list.map(render) } }
}

const renderer = calls.renderer
ok('注册了 chip 渲染器', renderer !== undefined && renderer.meta.key === 'plugin')
if (renderer === undefined) throw new Error('no renderer')
const chip = render(renderer.component({ node: { id: 'plugin', data: { title: '插件市场', name: 'dshmarket' } } }))
const flat = JSON.stringify(chip)
ok('chip 用标题渲染', flat.includes('插件市场') && flat.includes('dshmarket'), flat.slice(0, 200))
ok('chip 带 dshatp-chip 类名', flat.includes('dshatp-chip'))

/* --- ⑥ 折叠按钮：点一下真的折，再点真的展开 --- */
const list = new FakeEl('div')
list.setAttribute('role', 'listbox')
const titleFiles = new FakeEl('div')
titleFiles.setAttribute('role', 'presentation')
titleFiles.textContent = '文件'
const fileRows = [1, 2, 3, 4].map((i) => {
  const row = new FakeEl('button')
  row.setAttribute('role', 'option')
  row.textContent = `f${i}`
  return row
})
const titleSystem = new FakeEl('div')
titleSystem.setAttribute('role', 'presentation')
titleSystem.textContent = '系统'
const systemRows = [1, 2].map((i) => {
  const row = new FakeEl('button')
  row.setAttribute('role', 'option')
  row.textContent = `s${i}`
  return row
})
for (const node of [titleFiles, ...fileRows, titleSystem, ...systemRows]) list.appendChild(node)

menuLists.push(list)
globalThis.document = fakeDocument
for (const observer of observers) observer.fire()

const fold = titleFiles.querySelector(':scope > button.dshatp-fold')
ok('4 行的组有折叠按钮', fold !== null)
ok('2 行的组不给按钮', titleSystem.querySelector(':scope > button.dshatp-fold') === null)
ok('初始是展开的', fileRows.every((row) => row.style.display !== 'none'))
ok('按钮初始是 ▾', fold !== null && fold.textContent === '▾')

fold.dispatch('click')
ok('点一下：行折起来', fileRows.every((row) => row.style.display === 'none'))
ok('点一下：按钮变 ▸', fold.textContent === '▸')

for (const observer of observers) observer.fire()
ok('重渲染后还折着（组名没被 ▾ 污染）', fileRows.every((row) => row.style.display === 'none') && fold.textContent === '▸')

fold.dispatch('click')
ok('再点一下：展开', fileRows.every((row) => row.style.display !== 'none'))
ok('再点一下：按钮回 ▾', fold.textContent === '▾')

titleFiles.dispatch('click')
ok('点标题本身也能折叠', fileRows.every((row) => row.style.display === 'none'))
ok('点标题折叠时箭头也变', fold.textContent === '▸')
titleFiles.dispatch('click')
ok('点标题本身能展开', fileRows.every((row) => row.style.display !== 'none'))

if (fails.length > 0) {
  console.error('\n失败：')
  for (const line of fails) console.error('  ✗ ' + line)
  process.exit(1)
}
console.log('\n全部通过')
