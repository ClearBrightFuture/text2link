# text2link · 文本即链

**网页文本链接自动转可点击链接** · A Tampermonkey userscript that turns plain-text links on web pages into real clickable links.

把网页正文里以纯文本形式出现的网址、邮箱和下载协议链接，自动转换为可点击的真实 `<a>` 链接：悬停有突出高亮、单击在新标签页打开、拖选文字不会误跳转，并自动适配网页的深色 / 浅色模式。

![version](https://img.shields.io/badge/version-1.3.0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

---

## 项目特点

- **六类链接全覆盖**：HTTP/HTTPS/www 网址、邮箱、电驴（ed2k）、迅雷（thunder）、磁力链接（magnet）以及裸 40 位十六进制哈希码。
- **悬停突出变化**：链接默认着色加下划线，悬停时变色并叠加高亮背景，视觉反馈明显且平滑（0.15s 过渡）。
- **选中不误跳转**：拖选链接文字不会触发跳转，选区保留，可正常复制、右键操作；单击（无选区）才打开链接。
- **深浅色模式自动适配**：按网页实际背景亮度自动切换两套高对比配色，并实时跟随页面主题切换。
- **网站黑名单**：通过篡改猴菜单一键屏蔽 / 解除屏蔽当前网站，打开管理面板可查看、逐个移除或手动添加域名，按域名精确匹配。
- **动态内容自动处理**：通过 MutationObserver 监听页面变化，SPA 翻页、懒加载评论区等后插入的文本会自动转换。
- **文本一字不差**：转换后页面文字完全不变，标点正确归位，成对括号（如维基百科词条）不会被截断。
- **零依赖、零网络请求**：纯原生 JavaScript，只使用脚本管理器提供的本地存储与菜单 API，数据仅保存在本地，不收集任何数据。
- **不干扰页面**：所有类名使用 `sla-` 命名空间，不修改页面原有样式和脚本行为。

## 支持的链接类型

| 类型 | 示例 | 转换结果 |
| --- | --- | --- |
| HTTP/HTTPS | `https://example.com/page` | 原样可点击 |
| www 开头 | `www.example.com` | 自动补全为 `http://www.example.com` |
| 邮箱 | `user@example.com` | `mailto:user@example.com` |
| 电驴 | `ed2k://\|file\|...\|/` | 原样可点击 |
| 迅雷 | `thunder://QUF...` | 原样可点击 |
| 磁力 | `magnet:?xt=urn:btih:...` | 原样可点击 |
| 40 位哈希 | `0123456789abcdef0123456789abcdef01234567` | `magnet:?xt=urn:btih:哈希` |

## 运行环境

- **脚本管理器**：Tampermonkey（推荐）、Violentmonkey 等兼容用户脚本管理器。
- **浏览器**：Chrome / Edge 等 Chromium 内核浏览器（开发期已在真实 Chromium 中完整验证）；Firefox 预期可用。
- **页面范围**：所有网页（`@match *://*/*`）；另含 `@match file://*/*`，方便本地测试。
- **运行时机**：`@run-at document-idle`，仅在主框架运行（`@noframes`）。
- **权限说明**：使用篡改猴提供的 `GM_getValue` / `GM_setValue` / `GM_registerMenuCommand` 实现黑名单的持久化存储与菜单命令，不涉及浏览器级权限。
- **技术要求**：浏览器需支持 ES6+（`TreeWalker`、`MutationObserver`、`WeakMap`、`matchMedia`、`requestAnimationFrame`），即 2018 年后的主流浏览器版本。

## 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome 网上应用店 / Edge 加载项 / Firefox Add-ons）。
2. 任选一种方式安装脚本：
   - 打开篡改猴面板 →「实用工具」→「导入」，选择 `text2link.user.js`；
   - 或将文件直接拖入浏览器窗口，按提示确认安装；
   - 或复制文件内容，在篡改猴「创建新脚本」中粘贴并保存。
3. 刷新任意网页即可生效，无需任何配置。

## 使用方法

- **单击链接**：在新标签页打开目标（`target="_blank"`，附 `rel="noopener noreferrer"`）；中键 / Ctrl+单击的原生行为不受影响。
- **选中复制**：按住鼠标从链接前或链接后的文字拖过链接，或从链接文字中部开始拖选，选区不会触发跳转，可 Ctrl+C 复制、右键复制。
- **本地体验**：直接打开项目内的 [test-page.html](test-page.html)，覆盖全部链接类型与负例，页面顶部还有「切换到深色模式」按钮，可直观对比两套配色。

### 网站黑名单

点击浏览器工具栏的篡改猴图标 →「text2link」菜单，可看到三个命令：

- **屏蔽当前网站（加入黑名单）**：把当前域名加入黑名单并刷新，该网站不再执行本脚本；
- **解除屏蔽当前网站**：把当前域名移出黑名单并刷新，脚本恢复生效；
- **黑名单管理（查看/删除）**：弹出管理面板，可查看全部被屏蔽的域名、逐个移除，也可以手动输入域名添加（自动忽略协议、端口和路径）。

黑名单按域名匹配（不区分大小写），例如添加 `example.com` 不会连带屏蔽 `www.example.com`；本地 `file://` 页面不支持屏蔽。即使网站已在黑名单中，管理菜单仍然可用，随时可以解除屏蔽。

## 适配度与已知限制

- **深浅色判定**：脚本测量网页实际背景亮度（标准相对亮度阈值 0.35）决定配色，不依赖操作系统设置；背景不可测时回退到 `prefers-color-scheme`。
- **自动跳过**：已有链接、`textarea`、可编辑区、`script` / `style` / `noscript` 内部均不处理，避免破坏原页面。
- **已知限制**：
  1. Chromium 浏览器中，从链接文字**正中间**按住拖拽是原生「拖拽链接」行为（所有普通链接如此），此时不会产生选区；从链接前后文字拖过链接是最稳妥的选中方式。Firefox 支持从链接上直接选中，脚本的拦截逻辑同样覆盖。
  2. 按需求设计，正文中任何独立的 40 位十六进制字符串（包括 Git 提交哈希）都会被识别为磁力哈希。
  3. 极少数启用严格 CSP 的站点可能屏蔽注入的样式，此时悬停配色会退化为浏览器默认链接样式，点击功能不受影响。
  4. 邮箱需满足 `用户名@域名.后缀` 且后缀至少 2 位字母，`foo@bar.c` 这类无效地址不会被转换。
  5. 黑名单按主机名（域名）精确匹配，`example.com` 与 `www.example.com` 是两个独立条目。

## 工作原理

1. **扫描**：用 `TreeWalker` 遍历页面文本节点，跳过不应处理的区域，先收集再替换，避免遍历被替换打断。
2. **识别**：按类型优先级用正则匹配（HTTP/www → magnet → ed2k → thunder → 邮箱 → 40 位哈希），并做单词边界、十六进制边界校验，防止误转。
3. **清洗**：剥掉结尾标点；闭合括号仅在括号不配对时才剥除，并把剥掉的字符原样补回正文。
4. **交互**：文档级监听按下 / 移动判断拖选；点击链接时若发生拖选或选区包含该链接，则阻止跳转并保留选区。
5. **动态更新**：`MutationObserver` + `requestAnimationFrame` 防抖处理新增节点与文本变化。
6. **主题适配**：按页面背景亮度切换 `<html>` 上的 `sla-dark` 类，两套配色由注入的独立样式表提供。

## 项目结构

```text
text2link.user.js   # 用户脚本本体（唯一交付物）
test-page.html      # 本地测试页：全部用例 + 深浅色切换
README.md           # 本文件
CHANGELOG.md        # 更新日志
CONTRIBUTING.md     # 贡献指南
SECURITY.md         # 安全说明
LICENSE             # MIT 许可证
```

## 测试

- 开发期使用 Playwright + 真实 Chromium 完成 43 项端到端检查，覆盖：六类链接转换与文本保真、防误伤、深浅色切换、悬停样式、单击新标签页、拖选不跳转、剪贴板复制、动态内容、无重复转换。
- 日常验证可直接打开 [test-page.html](test-page.html) 手动检查。

## 参与贡献与安全

参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © text2link contributors
