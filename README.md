# dsh-at-plugins

**中文** ｜ [English](README.en.md)

> DeepSeek Harness 的 `@` 菜单增强：插件按「系统 / 用户」分组、会话按所在文件夹归类、分组标题可折叠。

在输入框打 `@` 时，DSH 默认只给「文件」和「会话」。这个插件把**你装了哪些插件**也变成一类可 `@` 的候选，顺手把长列表切成看得清的小块。

<p align="center">
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DSH-%E2%89%A50.2.1--rc.3-4C6EF5">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <a href="https://github.com/thynon/dsh-at-plugins/actions/workflows/check.yml"><img alt="check" src="https://github.com/thynon/dsh-at-plugins/actions/workflows/check.yml/badge.svg"></a>
</p>

<!-- 截图占位：收到 before.png / after.png 后取消下面这段注释

## 截图

| 装之前 | 装之后 |
|---|---|
| ![装之前](docs/before.png) | ![装之后](docs/after.png) |

-->

## 为什么

`@` 菜单是 DSH 里最快的一条指令通道，但它只认识文件和工作区里的会话。装上插件之后，「这个功能是哪个插件带来的」只能靠记忆去翻「设置 → 插件」。

于是：把插件清单接进 `@`，并且按来源分清楚——**系统**（随客户端发的）和**用户**（自己 `dsh plugin add` 装的）。长名单再加两个扶手：分组标题可折叠、会话按文件夹归类。

## 功能

### 插件：系统 / 用户

| 判据 | 归类 |
|---|---|
| `availability === 'installation'`（包在 DSH 安装目录的 `package.json` 里，随客户端发） | 系统 |
| `official === true`（官方维护的随附／可选包） | 系统 |
| 其余只出现在 profile `dependencies` 里的（`dsh plugin add` 装的） | 用户 |

系统在前、用户在后；组内已启用在前，未启用的描述里带「未启用」。
随包发但**没启用**的系统插件不列——`@` 了也没有任何东西会响应。

数据来自宿主 `pluginManager.listBundles`，只读，不装、不卸、不改启停。

### 会话：按所在文件夹分组

会话原来一律挂在「会话」标题下。现在按 `cwd` 的目录名分组：

```
default-workspace
  修 bug                 1h
  子会话                 3min · 子代理
Minecraft
  看盘                   现在
```

- 当前会话所在的文件夹排最前，其余按名字
- 子代理会话留在它自己那个文件夹里，描述后面标「子代理」
- 本地查不到的会话（别的工作区、已经清掉的）退回原来的「会话」组排在最后，不塞进「其他文件夹」

### 分组标题可折叠

标题右侧有个 `▾`／`▸`，点按钮或点标题本身都能折叠这一组（3 行以上才出现按钮）。折叠状态在窗口里一直保留。
标题本身也加大了一档（14px / 700，加分隔线），跟 13px 的候选行拉开层次。

### 插件引用是一枚原子 chip

选中插件后插进草稿的是一枚**原子引用**，跟文件／会话引用同一种节点，不是一行普通字符：

- 输入框里显示成 `@ 插件市场` 的胶囊，退格一次删整块
- 提交时由 `codec.serialize` 还原成模型形态
- 聊天记录里用 `conversation.user.text.node` 渲染成同款 chip

模型看到的是：

```
@[插件市场](dsh-plugin:dshmarket) 帮我把这个源列表刷新一下
```

宿主半端还会往系统提示词里加一段，告诉模型这种写法是什么意思：用户点名了某个插件，优先用它的能力。

## 安装

要求：DeepSeek Harness ≥ 0.2.1-rc.3、Node ≥ 22。

```bash
git clone git@github.com:thynon/dsh-at-plugins.git
cd dsh-at-plugins

# 1. 把包挂进 profile：写 dependencies + dsh.profile.bundles
node install.mjs ~/.dsh/profiles/desktop .

# 2. 建 node_modules 链接
cd ~/.dsh/profiles/desktop && pnpm install
```

然后**重启 DeepSeek Harness**（新 bundle 要重新组合 profile；之后只改 `client.js` 的话刷新页面就够）。

不放心脚本的话，手工改两处也一样：

```jsonc
// ~/.dsh/profiles/desktop/package.json
{
  "dsh": { "profile": { "bundles": [ /* … */, "dsh-at-plugins" ] } },
  "dependencies": {
    "dsh-at-plugins": "link:/绝对路径/dsh-at-plugins"
  }
}
```

## 卸载

把 `dsh-at-plugins` 从 `dsh.profile.bundles` 里删掉（依赖那行可以留着），重启即可。它没有改任何宿主数据，除了一枚挂在系统提示词上的段落，卸载即回收。

## 语言

- **插件界面**跟随 DSH 的语言设置（设置 → 常规），即时切换：字典 `zh` / `en` 各一份，走 `ctx.locale.register`。分组标题、按钮文案、空态提示都会跟着变。
- **README** 有中文和英文两份，GitHub 不支持按语言自动切换，只能在页首点过去。

## 实现要点

| 做的事 | 怎么做的 |
|---|---|
| 插件候选 | `inputTriggers.registerSource({ trigger: '@', ... })` |
| 会话分组 | 拦 `reference` 来源的 `candidates()`，只重写 `kind: 'session'` 行的 `section`，文件行原样透传 |
| 折叠按钮 | `MutationObserver` + 对 `[role="listbox"] > [role="presentation"]` 的 DOM 增强 |
| 行内 chip | 原子 `insert` + `codec` + `conversation.user.text.node` 渲染器 |

几处踩过的坑，写在代码注释里：组名不能读 `textContent`（折叠按钮自己的 `▾` 会被算进组名，状态永远对不上）；写相同值的 `data` 属性会再次触发 `MutationObserver`，容易自激；折叠按钮要同步补，排到下一帧就会在打字时闪烁。

## 边界与已知限制

- 只列**在跑的**包（`installed` 或 `enabled`）；没装的官方可选包、随包发但没启用的系统插件都不列。
- 只读：不装、不卸、不改启停。要改去「设置 → 插件」。
- 插件清单缓存 5 秒。
- 折叠是**视觉**折叠：被折起来的行仍在菜单数据里，所以方向键仍会穿过它们；回车／Tab 落在看不见的行上会被拦掉，不会误插。
- 会话分组依赖上游 `ui-reference` 的行结构（`value` 里的 `kind: 'session'`）与 `sessions.list` 的 `cwd`。上游改了，会退化成原样显示，不丢候选。
- 菜单增强用的是 `[role="listbox"]` / `[role="presentation"]` 这类语义选择器，不依赖内部哈希类名；但菜单结构大改时仍可能失效——失效表现为「按钮不见了」，不影响 `@` 本身。

## 开发

```bash
node check.mjs
```

不开浏览器、不装 DSH，用一套极小的 React／DOM 替身把 `client.js` 真跑一遍：候选分组与排序、会话按文件夹归类、折叠按钮的点击回环、`onPick` 的插入形态与 `codec`、chip 渲染。CI 在每次 push 时跑同一份。

## License

MIT © [thynon](https://github.com/thynon)
