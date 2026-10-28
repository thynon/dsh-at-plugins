/**
 * dsh-at-plugins —— 浏览器半端
 * ============================================================================
 * 干四件事：
 *   ① 往输入框的 `@` 触发器里注册一个「插件」来源：系统 / 用户 两组，
 *      选中后往草稿里插一段 `@[标题](dsh-plugin:包名)`。
 *   ② 给这段文本注册 UserText 规则 + 行内渲染器，发出去显示成一枚 chip。
 *   ③ 把 ui-reference 的会话候选按「所在文件夹」重新分组。
 *   ④ 给候选菜单的每个分组标题加大字号、右侧加折叠按钮。
 *
 * ③④ 是「改装别人家组件」的活，做法分别是拦 source.candidates（数据层）
 * 和 MutationObserver（DOM 层）。三条自我约束：
 *   - 只动 `@` 的 reference 来源和菜单里的分组标题，别的一概不碰。
 *   - 拿不到就安静退出，任何一步失败都不能让菜单打不开。
 *   - 所有改动都登记在 ctx.effect 里，插件卸载后原样还回去。
 * ============================================================================
 * @license Source-available, noncommercial — see LICENSE. © 2026 thynon
 */
window.__ModuleLoader__.load({
  id: 'dsh-at-plugins',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'at-plugins'

    const zh = {
      'section.system': '系统',
      'section.user': '用户',
      'section.disabled': '未启用',
      'section.folder.unknown': '其他文件夹',
      'row.subagent': '子代理',
      'fold.label': '折叠或展开这一组',
      'error.title': '读不到插件列表',
      'error.hint': '清单服务没响应，稍后再试',
    }
    const en = {
      'section.system': 'System',
      'section.user': 'User',
      'section.disabled': 'disabled',
      'section.folder.unknown': 'Other folders',
      'row.subagent': 'subagent',
      'fold.label': 'Fold or unfold this group',
      'error.title': 'Plugin list unavailable',
      'error.hint': 'The inventory service did not answer; try again later',
    }

    const CSS = `
/* 分组标题：默认 11px 跟正文 13px 挤在一起，这里抬到 14px + 分隔线，一眼能看出是分组 */
[role="listbox"] > div[role="presentation"]{
  font-size:14px;font-weight:700;line-height:20px;letter-spacing:.02em;
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));
  padding:14px 8px 5px;min-height:34px;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  display:flex;align-items:center;justify-content:space-between;gap:8px}
[role="listbox"] > div[role="presentation"]:first-child{border-top:0;padding-top:6px}
.dshatp-fold{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;cursor:pointer;
  opacity:.8;transition:opacity .12s ease,background .12s ease}
.dshatp-fold:hover{opacity:1;background:var(--dsw-alias-fill-l2,rgba(127,127,127,.14))}
[data-dshatp-folded="1"]{color:var(--dsw-alias-label-tertiary)}
.dshatp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:0 6px;border-radius:6px;
  background:var(--dsw-alias-fill-l2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit);
  font-size:inherit;line-height:1.55;vertical-align:baseline;white-space:nowrap}
.dshatp-chip-icon{opacity:.65;font-size:.9em}
.dshatp-chip-title{overflow:hidden;text-overflow:ellipsis}
`

    /** 引用文本的规范形态；标题里的方括号会破坏 Markdown 语法，先洗掉。 */
    function mentionOf(title, name) {
      const safeTitle = String(title == null ? '' : title).replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || String(name)
      const safeName = String(name).replace(/[()\s]/g, '')
      return `@[${safeTitle}](dsh-plugin:${safeName})`
    }

    /** `@dougen/dsh-deepseek-usage` → `deepseek-usage`。 */
    function shortName(name) {
      const bare = String(name).startsWith('@') ? String(name).slice(String(name).indexOf('/') + 1) : String(name)
      return bare.replace(/^dsh-(?:plugin-)?/, '')
    }

    function resolveText(locale, value) {
      if (value == null) return undefined
      if (typeof value === 'string') return value
      try {
        const text = locale && typeof locale.resolveText === 'function' ? locale.resolveText(value) : undefined
        if (text != null && String(text).trim() !== '') return String(text)
      } catch {
        /* locale 没准备好：当没有标题处理 */
      }
      return undefined
    }

    function parseValue(value) {
      if (typeof value !== 'string') return undefined
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : undefined
      } catch {
        return undefined
      }
    }

    /* ================================================================== *
     * ① 插件候选：系统 / 用户
     * ================================================================== */
    const CACHE_MS = 5000

    async function readBundles(ctx, cache, force) {
      const now = Date.now()
      if (!force && cache.bundles !== undefined && now - cache.at < CACHE_MS) return cache.bundles
      const remote = ctx.get('remote') || ctx.remote
      const manager = remote && remote.pluginManager
      if (!manager || typeof manager.listBundles !== 'function') throw new Error('pluginManager remote is unavailable')
      const result = await manager.listBundles()
      if (!result || result.ok !== true) throw new Error((result && result.error && result.error.message) || 'pluginManager.listBundles failed')
      const bundles = Array.isArray(result.value) ? result.value : []
      cache.at = now
      cache.bundles = bundles
      return bundles
    }

    /**
     * 系统 vs 用户：
     *   - `availability === 'installation'`：包在 DSH 安装目录的 package.json 里，随客户端发 —— 系统。
     *   - `official === true`：官方维护的随附/可选包 —— 系统。
     *   - 其余只出现在 profile 依赖里的，是 `dsh plugin add` 装的 —— 用户。
     */
    function isSystem(bundle) {
      return bundle.official === true || bundle.availability === 'installation'
    }

    function toRows(ctx, bundles, t, query) {
      const locale = ctx.get('locale') || ctx.locale
      const seen = new Set()
      const rows = []
      for (const bundle of bundles) {
        if (!bundle || typeof bundle.name !== 'string') continue
        if (bundle.availability === 'missing') continue
        if (bundle.installed !== true && bundle.enabled !== true) continue
        if (seen.has(bundle.name)) continue
        seen.add(bundle.name)

        const meta = bundle.meta || {}
        const title = resolveText(locale, meta.title) || shortName(bundle.name)
        const blurb = resolveText(locale, meta.description) || (typeof bundle.description === 'string' ? bundle.description : '')
        const enabled = bundle.enabled === true
        const system = isSystem(bundle)
        const parts = []
        if (bundle.version) parts.push(`v${bundle.version}`)
        if (blurb) parts.push(blurb.length > 42 ? `${blurb.slice(0, 42)}…` : blurb)
        if (!enabled) parts.push(t('section.disabled'))

        rows.push({
          rank: (system ? 0 : 1) * 2 + (enabled ? 0 : 1),
          firstName: title,
          row: {
            name: title,
            ...(parts.length > 0 ? { description: parts.join(' · ') } : {}),
            section: t(system ? 'section.system' : 'section.user'),
            value: JSON.stringify({ name: bundle.name, title, system }),
          },
        })
      }

      const needle = String(query || '').trim().toLocaleLowerCase()
      const filtered = needle === ''
        ? rows
        : rows.filter((item) => `${item.row.name} ${item.row.description || ''} ${item.row.value}`.toLocaleLowerCase().includes(needle))

      /* section 必须连续，菜单才会把标题画对；同组内已启用在前，再按标题。 */
      filtered.sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank
        return left.firstName.localeCompare(right.firstName, 'zh-Hans-CN')
      })
      return filtered.map((item) => item.row)
    }

    /* ================================================================== *
     * ③ 会话按文件夹分组：拦 ui-reference 的 candidates，重写 session 行的 section
     * ================================================================== */
    const SESSION_MENTION = /^@\[[^\]]*\]\(dsh-session:([^)]+)\)$/

    function sessionIdOf(row) {
      const value = parseValue(row && row.value)
      if (!value || value.kind !== 'session') return undefined
      const match = SESSION_MENTION.exec(String(value.mention || ''))
      return match === null ? undefined : match[1]
    }

    function folderOf(cwd, t) {
      if (typeof cwd !== 'string' || cwd === '') return t('section.folder.unknown')
      const trimmed = cwd.replace(/[\\/]+$/, '')
      const base = trimmed.split(/[\\/]/).pop()
      return base || trimmed || t('section.folder.unknown')
    }

    /**
     * 把 reference 来源返回的行重排：文件行原样留着，会话行按 cwd 归到各自文件夹标题下。
     * 拿不准的时候（没 sessions 服务、行结构变了）原样返回，绝不吞掉候选。
     */
    function regroupSessions(rows, session, ctx, t) {
      const sessions = ctx.get('sessions')
      const byId = sessions && sessions.list && typeof sessions.list.getSnapshot === 'function'
        ? sessions.list.getSnapshot().byId || {}
        : null
      if (!byId) return rows

      const head = []
      const groups = new Map()
      const strays = []
      let sawSession = false

      for (const row of rows) {
        const sessionId = sessionIdOf(row)
        if (sessionId === undefined) {
          head.push(row)
          continue
        }
        sawSession = true
        const summary = byId[sessionId]
        /* 本地没这个会话 → 不动它，留在原来的「会话 / 子智能体」组里，别硬塞进「其他文件夹」。 */
        if (summary === undefined || typeof summary.cwd !== 'string' || summary.cwd === '') {
          strays.push(row)
          continue
        }
        const label = folderOf(summary.cwd, t)
        const next = summary.origin === 'subagent' && row.description
          ? { ...row, description: `${row.description} · ${t('row.subagent')}` }
          : row
        const bucket = groups.get(label)
        if (bucket === undefined) groups.set(label, [next])
        else bucket.push(next)
      }
      if (!sawSession) return rows

      /* 当前会话所在的文件夹排最前，其余按名字。 */
      const currentCwd = byId[session && session.sessionId] && byId[session.sessionId].cwd
      const currentLabel = folderOf(currentCwd, t)
      const ordered = [...groups.keys()].sort((left, right) => {
        if (left === currentLabel) return -1
        if (right === currentLabel) return 1
        return left.localeCompare(right, 'zh-Hans-CN')
      })

      const out = [...head]
      for (const label of ordered) {
        for (const row of groups.get(label)) out.push({ ...row, section: label })
      }
      /* section 必须连续，所以认不出文件夹的会话统一放最后。 */
      return out.concat(strays)
    }

    function decorateReferenceSource(source, ctx, t) {
      if (!source || typeof source.candidates !== 'function') return () => {}
      if (source.__dshatpWrapped === true) return () => {}
      const original = source.candidates
      source.__dshatpWrapped = true
      source.candidates = async function candidates(session, request) {
        const rows = await original.call(this, session, request)
        if (!Array.isArray(rows) || rows.length === 0) return rows
        if (request && request.drilled === true) return rows
        try {
          return regroupSessions(rows, session, ctx, t)
        } catch (error) {
          console.warn('[dsh-at-plugins] session grouping skipped:', error && error.message ? error.message : error)
          return rows
        }
      }
      return () => {
        source.candidates = original
        source.__dshatpWrapped = false
      }
    }

    /* ================================================================== *
     * ④ 菜单：标题加大 + 右侧折叠按钮
     * ================================================================== */
    const folded = new Set()

    function menuListboxes() {
      return document.querySelectorAll('[role="listbox"]')
    }

    /**
     * 读一个分组标题的纯文本。
     * 不能用 textContent —— 折叠按钮是自己塞进去的，会把 ▾ 算进组名里，
     * 下次再比对「这组是不是折着的」就对不上了（点了没反应就是这么来的）。
     */
    function sectionLabel(node) {
      let text = ''
      for (const child of node.childNodes) {
        if (child.nodeType === 3) text += child.textContent
        else if (child.nodeType === 1 && !/dshatp-fold/.test(child.className || '')) text += child.textContent
      }
      return text.trim()
    }

    function collectSections(list) {
      const sections = []
      for (const node of list.children) {
        if (node.getAttribute('role') === 'presentation') {
          sections.push({ title: node, label: sectionLabel(node), rows: [] })
        } else if (node.getAttribute('role') === 'option' && sections.length > 0) {
          sections[sections.length - 1].rows.push(node)
        }
      }
      return sections
    }

    /** 折起来／展开一组。组名每次现读，绝不用创建闭包时的旧值。 */
    function toggleFold(title, t) {
      const label = sectionLabel(title)
      if (label === '') return
      if (folded.has(label)) folded.delete(label)
      else folded.add(label)
      applyFolds(t)
    }

    function ensureFoldButton(title, t) {
      let button = title.querySelector(':scope > button.dshatp-fold')
      if (button !== null) return button

      button = document.createElement('button')
      button.type = 'button'
      button.className = 'dshatp-fold'
      button.setAttribute('aria-label', t('fold.label'))
      button.title = t('fold.label')
      /* 别让按钮吃掉菜单的 mousedown 语义（会让菜单误以为点了外部） */
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFold(title, t)
      })
      title.appendChild(button)

      /* 整条标题也能点：按钮只有 22px，点行首的字更顺手（按钮自己会拦掉冒泡，不会折两次） */
      if (title.dataset.dshatpToggle !== '1') {
        title.dataset.dshatpToggle = '1'
        title.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          toggleFold(title, t)
        })
      }
      return button
    }

    function applyFolds(t) {
      let lists
      try {
        lists = menuListboxes()
      } catch {
        return
      }
      for (const list of lists) {
        for (const section of collectSections(list)) {
          const label = section.label
          if (label === '') continue
          const foldable = section.rows.length >= 3
          const isFolded = foldable && folded.has(label)
          const button = foldable ? ensureFoldButton(section.title, t) : null
          /* 只在真的变了的时候写 DOM：写相同的 data 属性也会再触发一次 MutationObserver，容易自激。 */
          const flag = isFolded ? '1' : '0'
          if (section.title.dataset.dshatpFolded !== flag) section.title.dataset.dshatpFolded = flag
          if (button !== null) {
            const glyph = isFolded ? '▸' : '▾'
            if (button.textContent !== glyph) button.textContent = glyph
          }
          for (const row of section.rows) {
            if (isFolded) row.style.display = 'none'
            else if (row.style.display === 'none') row.style.display = ''
          }
        }
      }
    }

    function installMenuEnhancements(t) {
      /*
       * 同步跑，不排到下一帧：菜单每次重渲染都会重建这些节点，
       * 拖一帧再补按钮/再隐藏行，用户看到的就是「框在闪」。
       */
      let busy = false
      const run = () => {
        if (busy) return
        busy = true
        try {
          applyFolds(t)
        } catch (error) {
          console.warn('[dsh-at-plugins] fold pass skipped:', error && error.message ? error.message : error)
        } finally {
          busy = false
        }
      }
      const observer = new MutationObserver(() => {
        if (menuListboxes().length === 0) return
        run()
      })
      observer.observe(document.body, { childList: true, subtree: true })

      /* 折叠起来的行还在数据里（菜单的键盘高亮按数据算），回车/Tab 别让它选中看不见的东西。 */
      const guard = (event) => {
        if (event.key !== 'Enter' && event.key !== 'Tab') return
        const active = document.querySelector('[role="option"][aria-selected="true"]')
        if (active !== null && active.style.display === 'none') {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      document.addEventListener('keydown', guard, true)

      return () => {
        observer.disconnect()
        document.removeEventListener('keydown', guard, true)
        for (const list of menuListboxes()) {
          for (const section of collectSections(list)) {
            const button = section.title.querySelector(':scope > button.dshatp-fold')
            if (button !== null) button.remove()
            for (const row of section.rows) row.style.display = ''
          }
        }
      }
    }

    /* ================================================================== *
     * ② 行内渲染：`@[标题](dsh-plugin:包名)` → chip
     * ================================================================== */
    const MENTION = /@\[([^\]\n]{1,120})\]\((dsh-plugin:[^)\s]{1,200})\)/gu

    function pluginChip(props) {
      const data = (props && props.node && props.node.data) || {}
      const title = data.title || data.name || 'plugin'
      return h('span', {
        className: 'dshatp-chip',
        title: data.name || title,
        'data-plugin': data.name,
      }, h('span', { className: 'dshatp-chip-icon', 'aria-hidden': 'true' }, '@'),
      h('span', { className: 'dshatp-chip-title' }, title))
    }

    const pluginRule = {
      id: 'plugin',
      order: 20,
      match(text, from) {
        MENTION.lastIndex = from
        const found = MENTION.exec(text)
        if (found === null || found.index < from) return undefined
        return {
          id: 'plugin',
          start: found.index,
          end: found.index + found[0].length,
          data: { title: found[1], name: found[2].slice('dsh-plugin:'.length) },
        }
      },
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) return h('span', { className: 'dshatp-chip' }, '插件引用')
        return this.props.children
      }
    }

    return {
      inject: ['inputTriggers', 'locale', 'remote', 'remote.pluginManager', 'slots', 'uiConversation', 'sessions'],

      apply(ctx) {
        const locale = ctx.get('locale') || ctx.locale
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, { zh, en }), 'at-plugins: dictionaries')
        }
        const t = locale && typeof locale.bind === 'function'
          ? locale.bind(NS)
          : (key) => (zh[key] !== undefined ? zh[key] : key)

        /* --- 样式 --- */
        try {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-at-plugins')
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(() => () => style.remove(), 'at-plugins: styles')
        } catch {
          /* 没有 DOM 的环境（离线 harness）跳过 */
        }

        /* --- 聊天记录里的 chip --- */
        const conversation = ctx.get('uiConversation') || ctx.uiConversation
        const slots = ctx.get('slots') || ctx.slots
        if (conversation && conversation.userText && typeof conversation.userText.register === 'function') {
          try {
            ctx.effect(() => conversation.userText.register(pluginRule), 'at-plugins: @plugin text rule')
          } catch (error) {
            console.error('[dsh-at-plugins] user-text rule registration failed:', error)
          }
          if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
            try {
              slots.inject('conversation.user.text.node', function* () {
                yield slots.register({
                  name: 'conversation.user.text.node',
                  key: 'plugin',
                  priority: 100,
                }, (props) => h(Boundary, null, h(pluginChip, props)))
              })
            } catch (error) {
              console.error('[dsh-at-plugins] chip renderer registration failed:', error)
            }
          }
        }

        const inputTriggers = ctx.get('inputTriggers')
        if (!inputTriggers || typeof inputTriggers.registerSource !== 'function') {
          console.warn('[dsh-at-plugins] inputTriggers service is unavailable; @ plugin menu stays off')
          return
        }

        /* --- ③ 会话按文件夹分组：拦住 reference 来源，注册前注册后都要覆盖 --- */
        try {
          const undo = []
          const service = inputTriggers
          const originalRegister = service.registerSource
          service.registerSource = function registerSource(source) {
            if (source && source.trigger === '@' && source.name === 'reference') undo.push(decorateReferenceSource(source, ctx, t))
            return originalRegister.call(this, source)
          }
          ctx.effect(() => () => { service.registerSource = originalRegister }, 'at-plugins: reference grouping hook')
          const live = service.live && Array.isArray(service.live.sources) ? service.live.sources : []
          for (const existing of live) {
            if (existing && existing.trigger === '@' && existing.name === 'reference') undo.push(decorateReferenceSource(existing, ctx, t))
          }
          ctx.effect(() => () => { for (const off of undo) off() }, 'at-plugins: reference grouping')
        } catch (error) {
          console.warn('[dsh-at-plugins] session grouping hook failed:', error && error.message ? error.message : error)
        }

        /* --- ④ 菜单标题放大 + 折叠按钮 --- */
        try {
          ctx.effect(() => installMenuEnhancements(t), 'at-plugins: menu enhancements')
        } catch (error) {
          console.warn('[dsh-at-plugins] menu enhancement skipped:', error && error.message ? error.message : error)
        }

        /* --- ① @ 菜单里的插件来源 --- */
        const cache = { at: 0, bundles: undefined }
        const source = {
          trigger: '@',
          name: 'plugins',
          showGroupTitle: false,

          async candidates(_session, request) {
            const query = request && request.query
            try {
              const bundles = await readBundles(ctx, cache, false)
              return toRows(ctx, bundles, t, query)
            } catch (error) {
              console.warn('[dsh-at-plugins] plugin list unavailable:', error && error.message ? error.message : error)
              return [{ name: t('error.title'), description: t('error.hint') }]
            }
          },

          onPick(pick) {
            const parsed = parseValue(pick && pick.candidate && pick.candidate.value)
            if (!parsed || typeof parsed.name !== 'string') return undefined
            const ref = mentionOf(parsed.title, parsed.name)
            /*
             * 插「原子引用」而不是纯文本：纯文本在输入框里就是一行普通字符，
             * 既有 @[...] 原样显丑，又会被文件引用的扫描规则反复认成路径（闪）。
             * 不给 appearance，chip 就渲染成一个 `@ 标题` 的中性样式。
             */
            return {
              insert: {
                source: 'plugins',
                ref,
                label: parsed.title,
                clipboardText: ref,
              },
            }
          },

          /* 提交时由 codec 把 chip 还原成模型看得懂的形态（就是这段 mention 本身）。 */
          codec: {
            clipboardText: (ref) => ref,
            serialize: (ref) => Promise.resolve(ref),
          },

          /* chip 点一下：不打开任何东西，交给默认行为。 */
          openReference: () => false,
        }

        ctx.effect(() => inputTriggers.registerSource(source), 'at-plugins: @ source')
      },
    }
  },
})
