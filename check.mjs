/**
 * check.mjs —— 不开浏览器、不装 DSH，在 Node 里把 client.js / index.js 跑一遍
 * ============================================================================
 * 检查的是逻辑，不是长相：
 *   ① apply() 有没有把 @ 来源注册进 inputTriggers
 *   ② 插件候选：系统 / 用户 两组、系统在前、未启用排后、图标与长描述
 *   ③ 会话候选：按 cwd 归到文件夹标题下，同名文件夹消歧，子代理有标记
 *   ④ onPick 插出来的文本，能不能被 UserText 规则原样认回来
 *   ⑤ chip 渲染器拿到 node 时不抛错
 *   ⑥ @ 菜单增强：吸顶/计数/折叠且不插子节点，不误伤斜杠菜单
 *
 *   node check.mjs
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as host from './index.js'

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
globalThis.MouseEvent = class {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init) }
}
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
  get firstChild() { return this.childNodes[0] || null }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  removeAttribute(name) { this.attrs.delete(name) }
  hasAttribute(name) { return this.attrs.has(name) }
  appendChild(node) { this.childNodes.push(node); node.parentNode = this; return node }
  insertBefore(node, ref) {
    node.parentNode = this
    const at = ref === null || ref === undefined ? this.childNodes.length : this.childNodes.indexOf(ref)
    if (at < 0) this.childNodes.push(node)
    else this.childNodes.splice(at, 0, node)
    return node
  }
  remove() { const parent = this.parentNode; if (!parent) return; const at = parent.childNodes.indexOf(this); if (at >= 0) parent.childNodes.splice(at, 1) }
  addEventListener(type, fn) { const list = this._listeners.get(type) || []; list.push(fn); this._listeners.set(type, list) }
  dispatch(type, event = {}) {
    const payload = { type, preventDefault() {}, stopPropagation() {}, ...event }
    for (const fn of this._listeners.get(type) || []) fn(payload)
    return payload
  }
  dispatchEvent(event) {
    this._lastEvent = event
    for (const fn of this._listeners.get(event.type) || []) fn(event)
    return true
  }
  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  matches(selector) {
    if (selector === '[role="listbox"]') return this.getAttribute('role') === 'listbox'
    if (selector === '[role="presentation"]') return this.getAttribute('role') === 'presentation'
    if (selector === '[role="option"]') return this.getAttribute('role') === 'option'
    if (selector === '.dshatp-label') return /dshatp-label/.test(this.className)
    if (selector === '.dshatp-count') return /dshatp-count/.test(this.className)
    if (selector === 'button.dshatp-fold') return this.tagName === 'BUTTON' && /dshatp-fold/.test(this.className)
    if (selector === '[role="option"][aria-selected="true"]') {
      return this.getAttribute('role') === 'option' && this.getAttribute('aria-selected') === 'true'
    }
    if (selector.startsWith('[id^="')) {
      const prefix = selector.slice(6, -2)
      return String(this.getAttribute('id') || '').startsWith(prefix)
    }
    return false
  }
  querySelector(selector) {
    if (selector.startsWith(':scope > ')) {
      const childSelector = selector.slice(9)
      return this.children.find((child) => child.matches(childSelector)) || null
    }
    for (const m of String(selector).split(',').map((s) => s.trim())) {
      for (const child of this.children) {
        if (child.matches(m)) return child
        const found = child.querySelector(m)
        if (found !== null) return found
      }
    }
    return null
  }
  getBoundingClientRect() { return this._rect || { height: 0, width: 0, top: 0, left: 0, right: 0, bottom: 0 } }
  get textContent() { return this.childNodes.map((node) => node.textContent || '').join('') }
  set textContent(value) { this.childNodes = [{ nodeType: 3, textContent: String(value) }] }
}

const menuLists = []
const menus = []
const docListeners = new Map()
const fakeDocument = {
  body: new FakeEl('body'),
  head: new FakeEl('head'),
  createElement: (tag) => new FakeEl(tag),
  querySelectorAll: (selector) => {
    if (selector === '[data-trigger-menu]') return menus
    if (selector === '[role="listbox"]') return menuLists
    return []
  },
  querySelector: (selector) => {
    if (selector === '[data-trigger-menu]') return menus[0] || null
    for (const menu of menus) {
      const found = menu.querySelector(selector)
      if (found !== null) return found
    }
    return null
  },
  addEventListener(type, fn) {
    const list = docListeners.get(type) || []
    list.push(fn)
    docListeners.set(type, list)
  },
  removeEventListener(type, fn) {
    const list = docListeners.get(type) || []
    const at = list.indexOf(fn)
    if (at >= 0) list.splice(at, 1)
  },
  dispatchEvent(type, event) {
    for (const fn of docListeners.get(type) || []) fn(event)
  },
}

/* 插件 bundle 是通过 new Function 传参拿 document 的，所以这里就得是最终那份替身。 */
globalThis.document = fakeDocument

/* --- 夹具：pluginManager.listBundles 的真实形状 ---
 * installation = 随客户端发（系统）；只在 profile dependencies 里的是用户装的。 */
const ICON_SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
const LONG_BLURB = '结构感知压缩、TOON 无损编码、可逆落盘和实时面板，四件事都做，描述故意写长一些，用来验证不再从第 42 个字符处硬切。'
const BUNDLES = [
  { name: 'dshmarket', official: false, availability: 'profile', version: '1.70.2', description: '插件市场', meta: { title: '插件市场', icon: ICON_SVG }, enabled: true, installed: true, optional: false },
  { name: 'dsh-better-sidebar', official: false, availability: 'profile', version: '0.28.1', meta: { title: { zh: '更好的侧边栏', en: 'Better Sidebar' } }, enabled: true, installed: true, optional: false },
  { name: '@dougen/dsh-deepseek-usage', official: false, availability: 'profile', version: '0.15.0', enabled: false, installed: true, optional: false },
  { name: '@deepseek-ai/dsh-experimental-voice', official: true, availability: 'missing', enabled: false, installed: false, optional: true },
  { name: 'dsh-plugin-save-token', official: false, availability: 'profile', version: '2.4.1', description: LONG_BLURB, enabled: false, installed: true, optional: false },
  { name: '@deepseek-ai/dsh-optional-thing', official: true, availability: 'profile', version: '0.2.1-rc.3', enabled: true, installed: true, optional: true },
  { name: 'some-plain-dependency', official: false, availability: 'profile', installed: true, enabled: false, optional: false, error: { code: 'not-bundle' } },
  { name: '@deepseek-ai/dsh-web-app', official: false, availability: 'installation', version: '0.2.1-rc.3', enabled: true, installed: false, optional: false },
  { name: '@deepseek-ai/dsh-experimental-auto-review', official: true, availability: 'installation', version: '0.2.1-rc.3', enabled: false, installed: false, optional: true },
]

/* --- 夹具：ui-reference 会返回的行 --- */
const REFERENCE_ROWS = [
  { name: 'readme.md', description: 'docs', icon: 'file', section: '文件', value: JSON.stringify({ kind: 'file', fileKind: 'file', label: 'readme.md', mention: '@readme.md' }) },
  { name: '子会话', description: '3min', icon: 'session', section: '子会话', value: JSON.stringify({ kind: 'session', label: '子会话', mention: '@[子会话](dsh-session:sub1)' }) },
  { name: '修 bug', description: '1h', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '修 bug', mention: '@[修 bug](dsh-session:s1)' }) },
  { name: '看盘', description: '现在', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '看盘', mention: '@[看盘](dsh-session:s2)' }) },
  { name: '另一个 proj-a', description: '5min', icon: 'session', section: '会话', value: JSON.stringify({ kind: 'session', label: '另一个 proj-a', mention: '@[另一个 proj-a](dsh-session:s3)' }) },
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
          s3: { cwd: '/Users/gavin/Elsewhere/proj-a' },
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
  'fold.collapse': '折叠',
  'fold.expand': '展开',
  'empty.title': '还没有可引用的插件',
  'empty.hint': '在「设置 → 插件」里装一个，再回来 @',
  'error.title': '读不到',
  'error.hint': '再试',
}

const localeStub = {
  register() { return () => {} },
  bind() { return (key) => DICT[key] ?? key },
  resolveText(value) { return value && typeof value === 'object' ? (value.zh ?? value.en ?? JSON.stringify(value)) : value },
}

const calls = { sources: [], effects: [], renderer: undefined }

function makeCtx({ withSessions = true, brokenRemote = false, emptyRemote = false } = {}) {
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
            return { ok: true, value: emptyRemote ? [] : BUNDLES }
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
ok('列出所有在跑的插件（6 个）', rows.length === 6, `got ${rows.length}: ${JSON.stringify(names)}`)
ok('已安装的官方可选包不列', !names.some((n) => n.includes('voice')))
ok('不是 bundle 的依赖不列', !names.includes('some-plain-dependency'))
ok('随包发但没启用的不列', !names.some((n) => n.includes('auto-review')))
ok('两组：系统、用户', sections.join('|') === '系统|用户', JSON.stringify(sections))
ok('系统排在用户前面', rows[0].section === '系统' && rows[0].name === 'web-app')
ok('profile 依赖归「用户」', rows.filter((r) => r.section === '用户').length === 5)
ok('官方可选包被用户装进 profile 也归「用户」', rows.find((r) => r.value.includes('optional-thing')).section === '用户')
ok('installation 里的包归「系统」', rows.filter((r) => r.section === '系统').length === 1)
ok('未启用的排在组内后面并带标记', rows[rows.length - 1].description.includes('未启用'), rows[rows.length - 1].description)
ok('本地化标题生效', names.includes('更好的侧边栏'), JSON.stringify(names))

const marketRow = rows.find((row) => row.value.includes('"dshmarket"'))
ok('副文本不重复标题', marketRow.description === 'v1.70.2', marketRow.description)
ok('插件行带图标组件', typeof marketRow.icon === 'function')
const marketIcon = render(marketRow.icon({ size: 14 }))
ok('meta.icon 渲染成 14px 图片', marketIcon.type === 'img' && marketIcon.props.src === ICON_SVG && marketIcon.props.width === 14)
const noIconRow = rows.find((row) => row.name === '更好的侧边栏')
const fallbackIcon = render(noIconRow.icon({ size: 14 }))
ok('没有 icon 时退回内置图形', fallbackIcon.type === 'svg' && fallbackIcon.props.className === 'dshatp-plugin-glyph')
ok('长描述不再按 42 字硬切', rows.some((row) => (row.description || '').includes(LONG_BLURB)), rows.map((r) => r.description).join('|'))

const filtered = await src.candidates({ sessionId: 'current' }, { query: '侧边' })
ok('查询过滤', filtered.length === 1 && filtered[0].name === '更好的侧边栏', JSON.stringify(filtered.map((r) => r.name)))
const signal = { aborted: false, addEventListener() {}, removeEventListener() {} }
const started = Date.now()
const debounced = await src.candidates({ sessionId: 'current' }, { query: '侧边', signal })
ok('查询有短暂防抖', Date.now() - started >= 100 && debounced.length === 1, String(Date.now() - started))
const abortedSignal = { aborted: true, addEventListener() {}, removeEventListener() {} }
ok('中止的查询直接返回空', (await src.candidates({ sessionId: 'current' }, { query: '侧边', signal: abortedSignal })).length === 0)
const byPackage = await src.candidates({ sessionId: 'current' }, { query: 'dshmarket' })
ok('按包名也能搜到', byPackage.length === 1 && byPackage[0].name === '插件市场', JSON.stringify(byPackage.map((r) => r.name)))
const byJson = await src.candidates({ sessionId: 'current' }, { query: 'true' })
ok('搜索不把 value 里的 JSON 当正文', byJson.length === 0, JSON.stringify(byJson.map((r) => r.name)))
ok('无匹配时不返回占位行，交给菜单关闭', byJson.length === 0)
const disabled = await src.candidates({ sessionId: 'current' }, { query: '未启用' })
ok('按状态也能搜到未启用', disabled.length === 2 && disabled.every((r) => r.description.includes('未启用')), JSON.stringify(disabled.map((r) => r.name)))

/* --- ② 会话候选按文件夹分组（拦 reference 来源） --- */
const refRows = await reference.candidates({ sessionId: 'current' }, { query: '' })
const refSections = [...new Set(refRows.map((row) => row.section))]
console.log('    会话候选:', JSON.stringify(refRows.map((row) => `${row.section} / ${row.name} (${row.description})`)))
ok('文件行保持原样', refRows[0].section === '文件' && refRows[0].name === 'readme.md')
ok('会话改成按文件夹分组', refSections.join('|') === '文件|proj-a|Elsewhere/proj-a|proj-b|会话', JSON.stringify(refSections))
ok('当前文件夹排最前', refSections[1] === 'proj-a')
ok('同名文件夹用父目录消歧', refRows.find((r) => r.name === '另一个 proj-a').section === 'Elsewhere/proj-a', refRows.find((r) => r.name === '另一个 proj-a').section)
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

const empty = makeCtx({ emptyRemote: true })
plugin.apply(empty)
const emptySrc = calls.sources.filter((item) => item.name === 'plugins').pop()
const emptyRows = await emptySrc.candidates({ sessionId: 'current' }, { query: '' })
ok('没有插件时给空态', emptyRows.length === 1 && emptyRows[0].name === '还没有可引用的插件', JSON.stringify(emptyRows))
ok('空态也有图标', typeof emptyRows[0].icon === 'function')

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

/* --- 宿主半端：系统提示词 --- */
const prompts = []
host.apply({
  effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
  systemPrompt: { section(options) { prompts.push(options); return () => {} } },
})
ok('宿主注册了插件引用提示词', prompts.length === 1 && prompts[0].name === 'plugin-mentions', JSON.stringify(prompts.map((p) => p.name)))
ok('提示词解释了 dsh-plugin 形态', prompts[0].text.includes('dsh-plugin:包名'))
ok('提示词要求不要当文件/会话引用', prompts[0].text.includes('文件路径') && prompts[0].text.includes('会话引用'))

/* --- ⑥ 折叠按钮：点一下真的折，再点真的展开 --- */
const menu = new FakeEl('div')
menu.setAttribute('data-trigger-menu', '')
menu._rect = { height: 400, width: 380, top: 100, left: 0, right: 380, bottom: 500 }
menu.style.maxHeight = '400px'
const list = new FakeEl('div')
list.setAttribute('role', 'listbox')
const titleFiles = new FakeEl('div')
titleFiles.setAttribute('role', 'presentation')
titleFiles.textContent = '文件'
const fileRows = [1, 2, 3, 4].map((i) => {
  const row = new FakeEl('button')
  row.setAttribute('role', 'option')
  row.setAttribute('id', `dsh-slash-option-reference-${i}`)
  row.textContent = `f${i}`
  return row
})
const titleSystem = new FakeEl('div')
titleSystem.setAttribute('role', 'presentation')
titleSystem.textContent = '系统'
const systemRows = [1, 2].map((i) => {
  const row = new FakeEl('button')
  row.setAttribute('role', 'option')
  row.setAttribute('id', `dsh-slash-option-plugins-${i}`)
  row.textContent = `s${i}`
  return row
})
const titleOne = new FakeEl('div')
titleOne.setAttribute('role', 'presentation')
titleOne.textContent = '单行文件夹'
const oneRow = new FakeEl('button')
oneRow.setAttribute('role', 'option')
oneRow.setAttribute('id', 'dsh-slash-option-reference-9')
oneRow.textContent = 'one'
for (const node of [titleFiles, ...fileRows, titleSystem, ...systemRows, titleOne, oneRow]) list.appendChild(node)
menu.appendChild(list)
menus.push(menu)
menuLists.push(list)
globalThis.document = fakeDocument
for (const observer of observers) observer.fire()

ok('识别出 @ 菜单并打标记', menu.getAttribute('data-dshatp-mention') === '1')
ok('菜单面板高度锁定在 400px', menu.style.minHeight === '400px', menu.style.minHeight)
ok('标题不插任何子节点（防 React 重渲染闪烁）', titleFiles.childNodes.length === 1 && titleFiles.childNodes[0].nodeType === 3)
ok('4 行的组可折叠', titleFiles.dataset.dshatpFoldable === '1')
ok('2 行的组不给折叠', titleSystem.dataset.dshatpFoldable === '0')
ok('2 行的组仍显示行数', titleSystem.dataset.dshatpCount === '2')
ok('4 行的组显示行数', titleFiles.dataset.dshatpCount === '4')
ok('单行组不显示计数', !titleOne.hasAttribute('data-dshatp-count'))
ok('初始是展开的', fileRows.every((row) => row.style.display !== 'none'))

fileRows[1].setAttribute('aria-selected', 'true')
titleFiles.dispatch('click')
ok('点一下：行折起来', fileRows.every((row) => row.style.display === 'none'))
ok('点一下：标题进入折叠态', titleFiles.dataset.dshatpFolded === '1')
ok('折叠后高亮自动挪到可见行', systemRows[0]._lastEvent !== undefined && systemRows[0]._lastEvent.type === 'mousemove')

fileRows[1].removeAttribute('aria-selected')
fileRows[2].setAttribute('aria-selected', 'true')
oneRow._lastEvent = undefined
fakeDocument.dispatchEvent('keydown', { key: 'ArrowUp', isComposing: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} })
await new Promise((resolve) => setTimeout(resolve, 10))
ok('方向键向上会跳过折叠行', oneRow._lastEvent !== undefined && oneRow._lastEvent.type === 'mousemove')

for (const observer of observers) observer.fire()
ok('重渲染后还折着（组名没被伪元素污染）', fileRows.every((row) => row.style.display === 'none') && titleFiles.dataset.dshatpFolded === '1')

titleFiles.dispatch('click')
ok('再点一下：展开', fileRows.every((row) => row.style.display !== 'none'))
ok('再点一下：回到展开态', titleFiles.dataset.dshatpFolded === '0')

titleFiles.dispatch('click')
ok('点标题本身也能折叠', fileRows.every((row) => row.style.display === 'none'))
titleFiles.dispatch('click')
ok('点标题本身能展开', fileRows.every((row) => row.style.display !== 'none'))

/* 模拟 React 把标题整个重建：仍不应插入任何子节点，只更新 data 属性。 */
titleFiles.textContent = '文件'
for (const observer of observers) observer.fire()
ok('标题重建后仍是纯文本节点', titleFiles.childNodes.length === 1 && titleFiles.childNodes[0].nodeType === 3)
ok('标题重建后行数属性仍在', titleFiles.dataset.dshatpCount === '4')
ok('标题重建后折叠属性仍在', titleFiles.dataset.dshatpFoldable === '1')

const style = fakeDocument.head.children.find((el) => el.getAttribute('data-plugin-css') === 'dsh-at-plugins')
ok('分组标题吸顶', style !== undefined && style.textContent.includes('position:sticky'))
ok('标题文本用 ellipsis 收尾', style !== undefined && style.textContent.includes('text-overflow:ellipsis'))
ok('计数由伪元素画', style !== undefined && style.textContent.includes('content:attr(data-dshatp-count)'))
ok('箭头由伪元素画', style !== undefined && style.textContent.includes('[data-dshatp-foldable="1"]::before'))
ok('滚动时为吸顶标题留空间', style !== undefined && style.textContent.includes('scroll-margin-top'))

/* 空插件状态：面板高度锁定，内容居中。 */
const emptyMenu = new FakeEl('div')
emptyMenu.setAttribute('data-trigger-menu', '')
emptyMenu._rect = { height: 284, width: 380, top: 100, left: 0, right: 380, bottom: 384 }
emptyMenu.style.maxHeight = '284px'
const emptyList = new FakeEl('div')
emptyList.setAttribute('role', 'listbox')
const emptyRow = new FakeEl('button')
emptyRow.setAttribute('role', 'option')
emptyRow.setAttribute('id', 'dsh-slash-option-plugins-0')
emptyRow.textContent = '还没有可引用的插件在「设置 → 插件」里装一个'
emptyList.appendChild(emptyRow)
emptyMenu.appendChild(emptyList)
menus.push(emptyMenu)
menuLists.push(emptyList)
for (const observer of observers) observer.fire()
ok('空插件状态打上 empty 标记', emptyList.dataset.dshatpEmpty === '1')
ok('空插件面板高度也锁定', emptyMenu.style.minHeight === '284px', emptyMenu.style.minHeight)
ok('空插件内容居中', style.textContent.includes('flex:1 1 auto;justify-content:center'))

/* 斜杠菜单不能被误伤：同样的 listbox 结构，但没有 reference/plugins 的 option id。 */
const slashMenu = new FakeEl('div')
slashMenu.setAttribute('data-trigger-menu', '')
const slashList = new FakeEl('div')
slashList.setAttribute('role', 'listbox')
const slashTitle = new FakeEl('div')
slashTitle.setAttribute('role', 'presentation')
slashTitle.textContent = '命令'
const slashRow = new FakeEl('button')
slashRow.setAttribute('role', 'option')
slashRow.setAttribute('id', 'dsh-slash-option-command-0')
for (const node of [slashTitle, slashRow]) slashList.appendChild(node)
slashMenu.appendChild(slashList)
menus.push(slashMenu)
menuLists.push(slashList)
for (const observer of observers) observer.fire()
ok('斜杠菜单不加折叠属性', !slashTitle.hasAttribute('data-dshatp-foldable') && !slashTitle.hasAttribute('data-dshatp-count') && slashTitle.childNodes.length === 1)
ok('斜杠菜单不打 @ 标记', slashMenu.getAttribute('data-dshatp-mention') === null)

if (fails.length > 0) {
  console.error('\n失败：')
  for (const line of fails) console.error('  ✗ ' + line)
  process.exit(1)
}
console.log('\n全部通过')
