/**
 * dsh-at-plugins —— 宿主半端
 * ============================================================================
 * 这半边只干一件事：告诉模型 `@[标题](dsh-plugin:包名)` 是什么意思。
 * 列表本身由浏览器半端（client.js）从 pluginManager.listBundles 读取。
 * ============================================================================
 * @license Source-available, noncommercial — see LICENSE. © 2026 thynon
 */

export const name = 'at-plugins'

/** 只依赖系统提示词注册表；缺了就装不活，别半残启动。 */
export const inject = ['systemPrompt']

const SECTION = 'plugin-mentions'
const SECTION_ORDER = 8000

const TEXT = [
  '用户消息里的 `@[标题](dsh-plugin:包名)` 表示用户从 @ 菜单里点名了一个已安装的 DSH 插件，',
  '`包名` 就是 profile 依赖里的包名（例如 `@[抖音自动聊天](dsh-plugin:dsh-douyin-chat)`）。',
  '遇到这种引用就优先用该插件提供的工具/界面来办事；不确定它提供什么时，先说明它是个插件，再问清要办的事。',
].join('')

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION,
    order: SECTION_ORDER,
    text: TEXT,
  }), 'at-plugins: @plugin mention prompt')
}
