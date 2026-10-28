/**
 * dsh-at-plugins —— 浏览器半端
 * ============================================================================
 * 干四件事：
 *   ① 往输入框的 `@` 触发器里注册一个「插件」来源：系统 / 用户 两组，
 *      选中后往草稿里插一段 `@[标题](dsh-plugin:包名)`。
 *   ② 给这段文本注册 UserText 规则 + 行内渲染器，发出去显示成一枚 chip。
 *   ③ 把 ui-reference 的会话候选按「所在文件夹」重新分组。
 *   ④ 给候选菜单的分组标题做视觉增强：吸顶、计数、折叠。
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
      'fold.collapse': '折叠',
      'fold.expand': '展开',
      'empty.title': '还没有可引用的插件',
      'empty.hint': '在「设置 → 插件」里装一个，再回来 @',
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
      'fold.collapse': 'Collapse',
      'fold.expand': 'Expand',
      'empty.title': 'No plugins to mention yet',
      'empty.hint': 'Install one in Settings → Plugins, then type @ again',
      'error.title': 'Plugin list unavailable',
      'error.hint': 'The inventory service did not answer; try again later',
    }

    const CSS = `
/* 只改 @ 菜单：斜杠菜单、模型选择器等别的 listbox 一律不碰。
   data-dshatp-mention 由 installMenuEnhancements() 在识别出 reference / plugins
   来源时打到菜单根节点上。 */
[data-dshatp-mention="1"] [role="listbox"] > div[role="presentation"]{
  position:sticky;top:0;z-index:2;box-sizing:border-box;
  display:flex;align-items:center;gap:8px;
  min-height:32px;padding:6px 8px 5px;
  font-size:14px;font-weight:650;line-height:20px;letter-spacing:.01em;
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));
  background:var(--dsw-alias-menu-group-header-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2)));
  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  cursor:default;user-select:none;-webkit-user-select:none}
[data-dshatp-mention="1"] [role="listbox"] > div[role="presentation"]:first-child{
  border-top:0;padding-top:4px}
[data-dshatp-mention="1"] [role="listbox"] > div[role="presentation"][data-dshatp-foldable="1"]{cursor:pointer}
[data-dshatp-mention="1"] [role="listbox"] > div[role="presentation"][data-dshatp-foldable="1"]:hover{
  color:var(--dsw-alias-label-primary,var(--dsw-alias-label-secondary))}
/* 折起来的组后面紧跟着下一个标题；两个 sticky 会叠在一起把折叠组盖住。
   折叠组不吸顶，让下一个组正常接管顶部。 */
[data-dshatp-mention="1"] [role="listbox"] > div[role="presentation"][data-dshatp-folded="1"]{
  position:static}
/* 吸顶标题会盖住滚动到上面的行；scrollIntoView 需要给标题留出高度。 */
[data-dshatp-mention="1"] [role="option"]{scroll-margin-top:36px}
.dshatp-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshatp-count{flex:none;margin-left:auto;min-width:18px;height:18px;padding:0 6px;border-radius:9px;
  display:inline-flex;align-items:center;justify-content:center;
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
  color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));font-size:11px;font-weight:600;line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:0}
.dshatp-count[hidden]{display:none}
.dshatp-fold{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;
  color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-tertiary));font-size:0;line-height:1;cursor:pointer;
  opacity:.85;transition:opacity .12s ease,background .12s ease,color .12s ease}
.dshatp-fold::before{content:"";width:6px;height:6px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(45deg) translate(-1px,-1px);transition:transform .15s ease}
[data-dshatp-folded="1"] .dshatp-fold::before{transform:rotate(-45deg) translate(-1px,1px)}
.dshatp-fold:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshatp-fold:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));
  outline-offset:1px}
.dshatp-plugin-icon{width:14px;height:14px;border-radius:3px;object-fit:contain;display:block}
.dshatp-plugin-glyph{width:14px;height:14px;display:block;flex:none}
.dshatp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 6px;border-radius:6px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit);
  font-size:inherit;line-height:1.45;vertical-align:baseline;white-space:nowrap}
.dshatp-chip-icon{opacity:.6;font-size:.9em;flex:none}
.dshatp-chip-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion: reduce){
  .dshatp-fold,.dshatp-fold::before{transition:none}
}
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
     * 行图标：插件清单里的 meta.icon 是 base64 data URL，菜单只接受
     * 「字符串 kind」或 React 组件，所以这里把图片包成 14px 的组件。
     * ================================================================== */
    const ICON_CACHE = new Map()
    const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=_-]+$/i

    function PluginGlyph({ size = 14 }) {
      return h('svg', {
        className: 'dshatp-plugin-glyph',
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M3 5.2 8 2.8l5 2.4v5.6L8 13.2 3 10.8V5.2Z',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinejoin: 'round',
      }),
      h('path', { d: 'M3 5.2 8 7.7l5-2.5M8 7.7v5.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }))
    }

    function WarningGlyph({ size = 14 }) {
      return h('svg', {
        className: 'dshatp-plugin-glyph',
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M8 2.5 14 13H2L8 2.5Z',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinejoin: 'round',
      }),
      h('path', { d: 'M8 6.2v3.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      h('circle', { cx: 8, cy: 11.4, r: 0.7, fill: 'currentColor' }))
    }

    function pluginIcon(icon) {
      if (typeof icon !== 'string' || !IMAGE_DATA_URL.test(icon)) return PluginGlyph
      let component = ICON_CACHE.get(icon)
      if (component === undefined) {
        component = function PluginIcon({ size = 14 }) {
          return h('img', {
            className: 'dshatp-plugin-icon',
            src: icon,
            width: size,
            height: size,
            alt: '',
            'aria-hidden': 'true',
            draggable: false,
            onError: (event) => {
              if (event && event.currentTarget) event.currentTarget.style.display = 'none'
            },
          })
        }
        ICON_CACHE.set(icon, component)
      }
      return component
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
     * 系统 vs 用户只看「这个包实际从哪来」：
     *   - `availability === 'installation'`：包在 DSH 安装目录里，随客户端发 —— 系统。
     *   - `availability === 'profile'`：只出现在 profile 依赖里，是用户 `dsh plugin add` 装的 —— 用户。
     *
     * 不能拿 `official` 当系统判据：官方可选包被用户装进 profile 后
     * `official` 仍是 true，但它不在安装目录里，对用户来说就是「我装的」。
     */
    function isSystem(bundle) {
      return bundle.availability === 'installation'
    }

    function toRows(ctx, bundles, t, query) {
      const locale = ctx.get('locale') || ctx.locale
      const seen = new Set()
      const rows = []
      for (const bundle of bundles) {
        if (!bundle || typeof bundle.name !== 'string') continue
        if (bundle.availability === 'missing') continue
        /* profile 里偶尔会有不是 bundle 的依赖；它不是插件，别列进 @ 候选。 */
        if (bundle.error && bundle.error.code === 'not-bundle') continue
        if (bundle.installed !== true && bundle.enabled !== true) continue
        if (seen.has(bundle.name)) continue
        seen.add(bundle.name)

        const meta = bundle.meta || {}
        const title = resolveText(locale, meta.title) || shortName(bundle.name)
        const blurb = String(resolveText(locale, meta.description) || (typeof bundle.description === 'string' ? bundle.description : ''))
          .replace(/\s+/g, ' ')
          .trim()
        const enabled = bundle.enabled === true
        const system = isSystem(bundle)
        const blurbText = blurb !== title ? blurb : ''
        const parts = []
        if (bundle.version) parts.push(`v${bundle.version}`)
        if (blurbText) parts.push(blurbText)
        if (!enabled) parts.push(t('section.disabled'))

        rows.push({
          rank: (system ? 0 : 1) * 2 + (enabled ? 0 : 1),
          firstName: title,
          search: [title, blurb, bundle.name, shortName(bundle.name), enabled ? '' : t('section.disabled')].join(' '),
          row: {
            name: title,
            icon: pluginIcon(meta.icon),
            ...(parts.length > 0 ? { description: parts.join(' · ') } : {}),
            section: t(system ? 'section.system' : 'section.user'),
            value: JSON.stringify({ name: bundle.name, title, system }),
          },
        })
      }

      const needle = String(query || '').trim().toLocaleLowerCase()
      const filtered = needle === ''
        ? rows
        : rows.filter((item) => item.search.toLocaleLowerCase().includes(needle))

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

    /** 取路径末尾 n 段；用于「同名文件夹」的消歧显示。 */
    function tailOf(cwd, n) {
      const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
      return parts.slice(-n).join('/') || String(cwd)
    }

    /**
     * 同名文件夹只显示 basename 会混在一起（~/work/src 和 ~/play/src 都叫 src）。
     * 这里按 cwd 分组，撞名时逐级加父目录，直到每个标题唯一。
     */
    function labelsFor(cwds, keepShort) {
      const labels = new Map()
      for (const cwd of cwds) labels.set(cwd, tailOf(cwd, 1))
      for (let count = 1; count <= 3; count += 1) {
        const seen = new Map()
        for (const cwd of cwds) {
          const label = labels.get(cwd)
          seen.set(label, (seen.get(label) || 0) + 1)
        }
        let changed = false
        for (const cwd of cwds) {
          const label = labels.get(cwd)
          /* 当前会话所在的文件夹保留短名，让别人加父目录；否则两个都变长。 */
          if ((seen.get(label) || 0) > 1 && cwd !== keepShort) {
            labels.set(cwd, tailOf(cwd, count + 1))
            changed = true
          }
        }
        if (!changed) break
      }
      return labels
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
        const next = summary.origin === 'subagent' && row.description
          ? { ...row, description: `${row.description} · ${t('row.subagent')}` }
          : row
        /* 按 cwd 分组，不按显示名：显示名后面再算，避免同名文件夹被合并。 */
        const bucket = groups.get(summary.cwd)
        if (bucket === undefined) groups.set(summary.cwd, [next])
        else bucket.push(next)
      }
      if (!sawSession) return rows

      const currentCwd = byId[session && session.sessionId] && byId[session.sessionId].cwd
      const labels = labelsFor([...groups.keys()], currentCwd)
      const ordered = [...groups.keys()].sort((left, right) => {
        if (left === currentCwd) return -1
        if (right === currentCwd) return 1
        return (labels.get(left) || left).localeCompare(labels.get(right) || right, 'zh-Hans-CN')
      })

      const out = [...head]
      for (const cwd of ordered) {
        const label = labels.get(cwd) || tailOf(cwd, 1) || t('section.folder.unknown')
        for (const row of groups.get(cwd)) out.push({ ...row, section: label })
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
     * ④ 菜单：吸顶标题 + 计数 + 右侧折叠按钮
     * ================================================================== */
    const folded = new Set()

    /**
     * 只返回 `@` 菜单的 listbox：菜单根节点带 `data-trigger-menu`，
     * 里面出现 reference / plugins 来源的 option id 才算。
     * 斜杠菜单、模型选择器之类的 listbox 一律不动。
     */
    function menuListboxes() {
      const lists = []
      let menus
      try {
        menus = document.querySelectorAll('[data-trigger-menu]')
      } catch {
        return lists
      }
      for (const menu of menus) {
        const list = menu.querySelector('[role="listbox"]')
        const mention = list !== null && list.querySelector('[id^="dsh-slash-option-reference-"], [id^="dsh-slash-option-plugins-"]') !== null
        if (!mention) {
          if (menu.hasAttribute('data-dshatp-mention')) menu.removeAttribute('data-dshatp-mention')
          continue
        }
        if (menu.getAttribute('data-dshatp-mention') !== '1') menu.setAttribute('data-dshatp-mention', '1')
        lists.push(list)
      }
      return lists
    }

    /**
     * 读一个分组标题的纯文本。
     * 不能把按钮/计数也算进去：组名会被污染，下次再比对「这组是不是折着的」
     * 就对不上（点了没反应就是这么来的）。优先读我们自己包的 `.dshatp-label`。
     */
    function sectionLabel(node) {
      const label = node.querySelector(':scope > .dshatp-label')
      let outside = ''
      for (const child of node.childNodes) {
        if (child === label) continue
        if (child.nodeType === 1 && /dshatp-(?:fold|count)/.test(child.className || '')) continue
        outside += child.textContent || ''
      }
      const text = outside.trim() !== '' ? outside : label === null ? '' : label.textContent
      return String(text).replace(/\s+/g, ' ').trim()
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

    /** 把 React 写进来的文本节点包一层 span，给它 ellipsis 和 flex 收缩的能力。 */
    function ensureLabel(title) {
      let label = title.querySelector(':scope > .dshatp-label')
      const outside = []
      for (const child of title.childNodes) {
        if (child === label) continue
        if (child.nodeType === 1 && /dshatp-(?:fold|count)/.test(child.className || '')) continue
        if (child.nodeType === 3 && String(child.textContent).trim() !== '') outside.push(child)
      }
      if (label !== null) {
        /* React 偶尔会把新文本作为新的直接子节点插进来；把新文本收进 label，
           否则 label 会停在旧内容上。 */
        if (outside.length > 0) {
          label.textContent = ''
          for (const node of outside) label.appendChild(node)
        }
        return label
      }
      label = document.createElement('span')
      label.className = 'dshatp-label'
      if (outside.length > 0) {
        for (const node of outside) label.appendChild(node)
      } else {
        label.textContent = sectionLabel(title)
      }
      title.insertBefore(label, title.firstChild)
      return label
    }

    function ensureCount(title, rows) {
      let count = title.querySelector(':scope > .dshatp-count')
      if (count === null) {
        count = document.createElement('span')
        count.className = 'dshatp-count'
        const button = title.querySelector(':scope > button.dshatp-fold')
        if (button !== null) title.insertBefore(count, button)
        else title.appendChild(count)
      }
      const button = title.querySelector(':scope > button.dshatp-fold')
      if (button !== null && count.nextSibling !== button) title.insertBefore(count, button)
      const text = String(rows)
      if (count.textContent !== text) count.textContent = text
      const hidden = rows < 2
      if (count.hidden !== hidden) count.hidden = hidden
      return count
    }

    function ensureTitleClick(title, t) {
      if (title.dataset.dshatpToggle === '1') return
      title.dataset.dshatpToggle = '1'
      /* 和候选行一样在 mousedown 阶段保住输入框焦点，否则点标题会让菜单失焦。 */
      title.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      title.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFold(title, t)
      })
    }

    function ensureFoldButton(title, t) {
      let button = title.querySelector(':scope > button.dshatp-fold')
      if (button !== null) return button

      button = document.createElement('button')
      button.type = 'button'
      button.className = 'dshatp-fold'
      button.setAttribute('aria-expanded', 'true')
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
      return button
    }

    /** 折起来／展开一组。组名每次现读，绝不用创建闭包时的旧值。 */
    function toggleFold(title, t) {
      if (title.querySelector(':scope > button.dshatp-fold') === null) return
      const label = sectionLabel(title)
      if (label === '') return
      if (folded.has(label)) folded.delete(label)
      else folded.add(label)
      applyFolds(t)
    }

    /**
     * 折叠后如果高亮正落在被藏起来的行上，菜单看起来会像「没有选中项」。
     * 用 mousemove 走菜单自己的 hover 通道，把高亮挪到最近一个可见行；
     * 菜单没有公开的「移动高亮」接口，但 hover 是它公开的指针入口。
     */
    function keepHighlightVisible(list, direction = 1) {
      if (typeof list.querySelectorAll !== 'function' || typeof MouseEvent !== 'function') return
      const active = list.querySelector('[role="option"][aria-selected="true"]')
      if (active === null || active.style.display !== 'none') return
      const options = [...list.querySelectorAll('[role="option"]')]
      const at = options.indexOf(active)
      const find = (from, to, step) => {
        if (from < 0 || from >= options.length) return null
        for (let index = from; index >= 0 && index < options.length && (step > 0 ? index < to : index >= to); index += step) {
          if (options[index].style.display !== 'none') return options[index]
        }
        return null
      }
      const forward = direction >= 0
      const target = at < 0
        ? (forward ? find(0, options.length, 1) : find(options.length - 1, -1, -1))
        : forward
          ? find(at + 1, options.length, 1) || find(0, at, 1)
          : find(at - 1, -1, -1) || find(options.length - 1, at, -1)
      if (target === null) return
      try {
        target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }))
      } catch {
        /* 高亮没挪动也不该影响菜单本身 */
      }
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
          ensureLabel(section.title)
          ensureTitleClick(section.title, t)
          const label = sectionLabel(section.title)
          if (label === '') continue
          const foldable = section.rows.length >= 3
          const isFolded = foldable && folded.has(label)
          ensureCount(section.title, section.rows.length)
          let button = section.title.querySelector(':scope > button.dshatp-fold')
          if (!foldable && button !== null) {
            button.remove()
            button = null
          }
          if (foldable) button = ensureFoldButton(section.title, t)
          /* 只在真的变了的时候写 DOM：写相同的 data 属性也会再触发一次 MutationObserver，容易自激。 */
          const flag = isFolded ? '1' : '0'
          if (section.title.dataset.dshatpFolded !== flag) section.title.dataset.dshatpFolded = flag
          const foldableFlag = foldable ? '1' : '0'
          if (section.title.dataset.dshatpFoldable !== foldableFlag) section.title.dataset.dshatpFoldable = foldableFlag
          if (button !== null) {
            const expanded = isFolded ? 'false' : 'true'
            if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded)
            const action = t(isFolded ? 'fold.expand' : 'fold.collapse')
            const aria = `${action} ${label}`
            if (button.getAttribute('aria-label') !== aria) button.setAttribute('aria-label', aria)
            if (button.title !== aria) button.title = aria
          }
          for (const row of section.rows) {
            const description = [...row.children].find((child) => /itemDescription/.test(child.className || ''))
            if (description !== undefined && description.textContent && description.getAttribute('title') !== description.textContent) {
              description.setAttribute('title', description.textContent)
            }
            if (isFolded) row.style.display = 'none'
            else if (row.style.display === 'none') row.style.display = ''
          }
        }
        keepHighlightVisible(list)
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
        const active = document.querySelector('[data-dshatp-mention="1"] [role="option"][aria-selected="true"]')
        if (active !== null && active.style.display === 'none') {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      document.addEventListener('keydown', guard, true)

      /*
       * 方向键仍由菜单自己处理，但它的高亮按数据算、会落进被折叠的行。
       * 等这一次按键的渲染结束后，如果高亮是不可见的，就沿同一方向
       * 找到最近的可见行，用 hover 通道把它挪过去。
       */
      let installed = true
      const skipHidden = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return
        if (document.querySelector('[data-trigger-menu]') === null) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setTimeout(() => {
          if (!installed) return
          for (const list of menuListboxes()) keepHighlightVisible(list, direction)
        }, 0)
      }
      document.addEventListener('keydown', skipHidden, true)

      return () => {
        installed = false
        observer.disconnect()
        document.removeEventListener('keydown', guard, true)
        document.removeEventListener('keydown', skipHidden, true)
        for (const list of menuListboxes()) {
          for (const section of collectSections(list)) {
            const button = section.title.querySelector(':scope > button.dshatp-fold')
            if (button !== null) button.remove()
            const count = section.title.querySelector(':scope > .dshatp-count')
            if (count !== null) count.remove()
            const label = section.title.querySelector(':scope > .dshatp-label')
            if (label !== null) {
              for (const child of [...label.childNodes]) section.title.insertBefore(child, label)
              label.remove()
            }
            section.title.removeAttribute('data-dshatp-folded')
            section.title.removeAttribute('data-dshatp-foldable')
            for (const row of section.rows) row.style.display = ''
          }
        }
        for (const menu of document.querySelectorAll('[data-trigger-menu]')) {
          if (menu.hasAttribute('data-dshatp-mention')) menu.removeAttribute('data-dshatp-mention')
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

        /* --- ④ 菜单：吸顶标题 + 计数 + 折叠按钮 --- */
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
              const rows = toRows(ctx, bundles, t, query)
              if (rows.length === 0 && String(query || '').trim() === '') {
                return [{ name: t('empty.title'), description: t('empty.hint'), icon: PluginGlyph }]
              }
              return rows
            } catch (error) {
              console.warn('[dsh-at-plugins] plugin list unavailable:', error && error.message ? error.message : error)
              return [{ name: t('error.title'), description: t('error.hint'), icon: WarningGlyph }]
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
