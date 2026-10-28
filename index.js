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
  '用户消息里的 `@[标题](dsh-plugin:包名)` 表示用户从 @ 菜单里点名了一个已安装的 DSH 插件；',
  '`包名` 是 profile 依赖里的包名（例如 `@[抖音自动聊天](dsh-plugin:dsh-douyin-chat)`）。',
  '处理规则：优先用该插件注册的工具或界面完成任务；',
  '不确定它提供什么能力时，先说明这是一条插件引用，再问清用户具体想做什么，不要凭空猜测；',
  '不要把它当成文件路径或会话引用。',
].join('')

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION,
    order: SECTION_ORDER,
    text: TEXT,
  }), 'at-plugins: @plugin mention prompt')
}
