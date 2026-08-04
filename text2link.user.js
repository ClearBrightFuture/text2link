// ==UserScript==
// @name         text2link
// @name:zh-CN   text2link - 文本链接自动转可点击链接
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  将网页中的纯文本链接自动转换为可点击链接：http/https/www 网址、邮箱、ed2k（电驴）、thunder（迅雷）、磁力链接（magnet/40位哈希）；自动适配网页深浅色模式；支持网站黑名单（一键屏蔽/解除/管理）；悬停高亮、单击新标签页打开、拖选文字不跳转可正常复制
// @match        *://*/*
// @match        file://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // @noframes 已保证只在主框架运行，这里再做一次保险
  if (window.top !== window.self) return;

  const LINK_CLASS = 'sla-link';
  const DARK_CLASS = 'sla-dark';
  const LINK_RE =
    /(?:https?:\/\/|www\.)[^\s<>"'“”‘’，。；：！？、]+|magnet:\?xt=urn:btih:[^\s<>"'“”‘’，。；：！？、]+|ed2k:\/\/[^\s<>"'“”‘’，。；：！？、]+|thunder:\/\/[^\s<>"'“”‘’，。；：！？、]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[0-9A-Fa-f]{40}/gi;
  const SKIP_SELECTOR =
    'a, script, style, noscript, textarea, [contenteditable]:not([contenteditable="false"])';
  const BLOCK_KEY = 'blockedHosts';
  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  let blockedInMemory = [];

  // 结尾标点：直接剥掉
  const TRAILING_PUNCT = ".,;:!?…。，；：！？、'\"”’»—";
  // 结尾闭合括号：仅在括号不配对时剥掉（成对括号保留，避免破坏 维基百科_(词条) 这类网址）
  const BRACKET_PAIRS = {
    ')': '(',
    ']': '[',
    '}': '{',
    '）': '（',
    '】': '【',
    '》': '《'
  };

  // 文本节点 -> 上次处理过的内容；内容被页面脚本修改后允许重新处理
  const processed = new WeakMap();

  // 拖选检测状态
  let dragState = null;

  function cleanUrl(raw) {
    let url = raw;
    while (url.length > 0) {
      const last = url[url.length - 1];
      if (TRAILING_PUNCT.includes(last)) {
        url = url.slice(0, -1);
        continue;
      }
      const open = BRACKET_PAIRS[last];
      if (open) {
        let openCount = 0;
        let closeCount = 0;
        for (const ch of url) {
          if (ch === open) openCount++;
          else if (ch === last) closeCount++;
        }
        if (closeCount > openCount) {
          url = url.slice(0, -1);
          continue;
        }
      }
      break;
    }
    return url;
  }

  function classifyLink(raw) {
    if (/^www\./i.test(raw)) return 'www';
    if (/^https?:\/\//i.test(raw)) return 'http';
    if (/^magnet:\?xt=urn:btih:/i.test(raw)) return 'magnet';
    if (/^ed2k:\/\//i.test(raw)) return 'ed2k';
    if (/^thunder:\/\//i.test(raw)) return 'thunder';
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(raw)) return 'email';
    if (/^[0-9A-Fa-f]{40}$/.test(raw)) return 'hash';
    return 'http';
  }

  function buildHref(url, type) {
    if (type === 'www') return 'http://' + url;
    if (type === 'email') return 'mailto:' + url;
    if (type === 'hash') return 'magnet:?xt=urn:btih:' + url;
    return url;
  }

  // ---- 深浅色模式适配：按页面实际背景亮度自动切换配色 ----
  function parseColor(color) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }

  function findPageBackground() {
    let el = document.body;
    while (el) {
      const color = parseColor(getComputedStyle(el).backgroundColor);
      if (color && color.a > 0.05) return color;
      el = el.parentElement;
    }
    return null;
  }

  function luminance(r, g, b) {
    const f = function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function detectDarkMode() {
    const bg = findPageBackground();
    if (bg) return luminance(bg.r, bg.g, bg.b) < 0.35;
    // 页面背景不可测（如纯渐变/透明）时回退到系统配色偏好
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyDarkMode(on) {
    document.documentElement.classList.toggle(DARK_CLASS, on);
  }

  let darkCheckQueued = false;
  function scheduleDarkCheck() {
    if (darkCheckQueued) return;
    darkCheckQueued = true;
    requestAnimationFrame(function () {
      darkCheckQueued = false;
      applyDarkMode(detectDarkMode());
    });
  }

  function observeThemeChanges() {
    const observer = new MutationObserver(scheduleDarkCheck);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-bs-theme', 'data-mode', 'data-dark', 'data-color-scheme']
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-bs-theme', 'data-mode', 'data-dark', 'data-color-scheme']
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', scheduleDarkCheck);
      }
    }
  }

  // ---- 网站黑名单：屏蔽指定域名后，脚本不再运行 ----
  function getBlockedHosts() {
    try {
      if (hasGM) {
        const raw = GM_getValue(BLOCK_KEY, '[]');
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(list) ? list : [];
      }
      return blockedInMemory;
    } catch (e) {
      return [];
    }
  }

  function saveBlockedHosts(list) {
    try {
      if (hasGM) GM_setValue(BLOCK_KEY, JSON.stringify(list));
      else blockedInMemory = list.slice();
    } catch (e) { /* 存储失败不影响页面功能 */ }
  }

  function currentBlockKey() {
    return (location.hostname || '').toLowerCase();
  }

  function isCurrentBlocked() {
    const key = currentBlockKey();
    return !!key && getBlockedHosts().indexOf(key) !== -1;
  }

  function normalizeHostInput(input) {
    let s = String(input || '').trim().toLowerCase();
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // 去掉协议
    s = s.split(/[/?#]/)[0];                       // 去掉路径 / 查询 / 锚点
    s = s.replace(/:\d+$/, '');                    // 去掉端口
    return s;
  }

  function registerMenuCommands() {
    if (!hasGM || typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('屏蔽当前网站（加入黑名单）', function () {
      const key = currentBlockKey();
      if (!key) return;
      const list = getBlockedHosts();
      if (list.indexOf(key) === -1) {
        list.push(key);
        saveBlockedHosts(list);
      }
      location.reload();
    });
    GM_registerMenuCommand('解除屏蔽当前网站', function () {
      const key = currentBlockKey();
      if (!key) return;
      const list = getBlockedHosts();
      const idx = list.indexOf(key);
      if (idx !== -1) {
        list.splice(idx, 1);
        saveBlockedHosts(list);
        location.reload();
      }
    });
    GM_registerMenuCommand('黑名单管理（查看/删除）', openBlacklistPanel);
  }

  function injectBlacklistStyle() {
    if (document.getElementById('sla-blacklist-style')) return;
    const style = document.createElement('style');
    style.id = 'sla-blacklist-style';
    style.textContent = [
      '#sla-blacklist-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;}',
      '#sla-blacklist-panel{background:#fff;color:#1f2428;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);width:min(480px,90vw);max-height:80vh;display:flex;flex-direction:column;font:14px/1.6 system-ui,sans-serif;}',
      '#sla-blacklist-panel .sla-bl-header{padding:12px 16px;font-weight:600;border-bottom:1px solid #e5e7eb;}',
      '#sla-blacklist-panel .sla-bl-body{padding:12px 16px;overflow:auto;}',
      '#sla-blacklist-panel .sla-bl-status{color:#57606a;margin-bottom:8px;}',
      '#sla-blacklist-panel ul{margin:0 0 10px;padding:0;list-style:none;}',
      '#sla-blacklist-panel li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:6px;}',
      '#sla-blacklist-panel li .sla-bl-host{word-break:break-all;font-family:Consolas,Menlo,monospace;}',
      '#sla-blacklist-panel li .sla-bl-current{color:#6a737d;font-size:12px;}',
      '#sla-blacklist-panel button{cursor:pointer;border:1px solid #c9d1d9;border-radius:6px;background:#f6f8fa;padding:4px 10px;font:inherit;}',
      '#sla-blacklist-panel button:hover{background:#eaeef2;}',
      '#sla-blacklist-panel .sla-bl-remove{color:#b00000;border-color:#e8b0b0;}',
      '#sla-blacklist-panel .sla-bl-add{display:flex;gap:8px;margin:10px 0;}',
      '#sla-blacklist-panel .sla-bl-add input{flex:1;padding:6px 8px;border:1px solid #c9d1d9;border-radius:6px;font:inherit;}',
      '#sla-blacklist-panel .sla-bl-empty{color:#8b949e;padding:8px 0;border:none;}',
      '#sla-blacklist-panel .sla-bl-actions{text-align:right;border-top:1px solid #e5e7eb;padding:10px 16px;}',
      '#sla-blacklist-panel .sla-bl-hint{color:#57606a;font-size:13px;margin:4px 0 0;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  let blEscHandler = null;

  function closeBlacklistPanel() {
    const backdrop = document.getElementById('sla-blacklist-backdrop');
    if (backdrop) backdrop.remove();
    if (blEscHandler) {
      document.removeEventListener('keydown', blEscHandler);
      blEscHandler = null;
    }
  }

  function openBlacklistPanel() {
    injectBlacklistStyle();
    if (document.getElementById('sla-blacklist-backdrop')) return;
    const key = currentBlockKey();

    const backdrop = document.createElement('div');
    backdrop.id = 'sla-blacklist-backdrop';

    const panel = document.createElement('div');
    panel.id = 'sla-blacklist-panel';

    const header = document.createElement('div');
    header.className = 'sla-bl-header';
    header.textContent = 'text2link 黑名单';

    const panelBody = document.createElement('div');
    panelBody.className = 'sla-bl-body';

    const status = document.createElement('div');
    status.className = 'sla-bl-status';
    status.textContent = key
      ? '当前页面：' + key + '（' + (getBlockedHosts().indexOf(key) !== -1 ? '已屏蔽' : '未屏蔽') + '）'
      : '当前页面：本地文件（不支持屏蔽）';

    const listEl = document.createElement('ul');
    const hint = document.createElement('div');
    hint.className = 'sla-bl-hint';

    function renderList() {
      listEl.textContent = '';
      const list = getBlockedHosts();
      if (list.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'sla-bl-empty';
        empty.textContent = '黑名单为空，暂没有屏蔽任何网站';
        listEl.appendChild(empty);
        return;
      }
      list.forEach(function (host) {
        const li = document.createElement('li');
        const hostSpan = document.createElement('span');
        hostSpan.className = 'sla-bl-host';
        hostSpan.textContent = host;
        li.appendChild(hostSpan);
        if (host === key) {
          const cur = document.createElement('span');
          cur.className = 'sla-bl-current';
          cur.textContent = '当前';
          li.appendChild(cur);
        }
        const removeBtn = document.createElement('button');
        removeBtn.className = 'sla-bl-remove';
        removeBtn.textContent = '移除';
        removeBtn.addEventListener('click', function () {
          const list = getBlockedHosts();
          const idx = list.indexOf(host);
          if (idx !== -1) {
            list.splice(idx, 1);
            saveBlockedHosts(list);
            renderList();
            hint.textContent = host === key
              ? '已移除当前网站，刷新页面后脚本将重新生效'
              : '已移除 ' + host;
          }
        });
        li.appendChild(removeBtn);
        listEl.appendChild(li);
      });
    }

    const inputEl = document.createElement('input');
    inputEl.id = 'sla-bl-input';
    inputEl.type = 'text';
    inputEl.placeholder = '输入要屏蔽的域名，如 example.com';
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addHost();
    });

    function addHost() {
      const host = normalizeHostInput(inputEl.value);
      if (!host) {
        hint.textContent = '请输入有效的域名';
        return;
      }
      const list = getBlockedHosts();
      if (list.indexOf(host) !== -1) {
        hint.textContent = '该域名已在黑名单中';
        return;
      }
      list.push(host);
      saveBlockedHosts(list);
      inputEl.value = '';
      hint.textContent = '已添加 ' + host + (host === key ? '（当前网站，刷新后生效）' : '');
      renderList();
    }

    const addBtn = document.createElement('button');
    addBtn.id = 'sla-bl-add-btn';
    addBtn.textContent = '添加';
    addBtn.addEventListener('click', addHost);

    const addWrap = document.createElement('div');
    addWrap.className = 'sla-bl-add';
    addWrap.appendChild(inputEl);
    addWrap.appendChild(addBtn);

    renderList();
    panelBody.appendChild(status);
    panelBody.appendChild(listEl);
    panelBody.appendChild(addWrap);
    panelBody.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'sla-bl-actions';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'sla-bl-close-btn';
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', closeBlacklistPanel);
    actions.appendChild(closeBtn);

    panel.appendChild(header);
    panel.appendChild(panelBody);
    panel.appendChild(actions);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeBlacklistPanel();
    });
    blEscHandler = function (e) {
      if (e.key === 'Escape') closeBlacklistPanel();
    };
    document.addEventListener('keydown', blEscHandler);
    inputEl.focus();
  }

  function onMouseDown(e) {
    dragState = { x: e.clientX, y: e.clientY, dragging: false };
  }

  function onMouseMove(e) {
    if (!dragState || dragState.dragging) return;
    if ((e.buttons & 1) === 0) {
      dragState = null;
      return;
    }
    if (Math.abs(e.clientX - dragState.x) > 3 || Math.abs(e.clientY - dragState.y) > 3) {
      dragState.dragging = true;
    }
  }

  function onLinkClick(e) {
    const sel = window.getSelection();
    const isDragging = !!(dragState && dragState.dragging);
    const hasLinkSelection =
      !!sel &&
      !sel.isCollapsed &&
      typeof sel.containsNode === 'function' &&
      sel.containsNode(e.currentTarget, true);
    if (isDragging || hasLinkSelection) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function processTextNode(node) {
    const text = node.nodeValue;
    if (!text) return;
    if (processed.get(node) === text) return;

    const parentEl = node.parentElement;
    if (!parentEl || parentEl.closest(SKIP_SELECTOR)) {
      processed.set(node, text);
      return;
    }

    LINK_RE.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      matches.push(m);
    }

    if (matches.length === 0) {
      processed.set(node, text);
      return;
    }

    const parent = node.parentNode;
    if (!parent) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }
      const raw = match[0];
      const type = classifyLink(raw);
      let boundaryOk;
      if (type === 'hash') {
        // 哈希码两侧都不能紧邻十六进制字符，避免截取更长十六进制串的子串
        const prev = match.index > 0 ? text[match.index - 1] : '';
        const next = match.index + raw.length < text.length ? text[match.index + raw.length] : '';
        boundaryOk = !/[0-9A-Fa-f]/.test(prev) && !/[0-9A-Fa-f]/.test(next);
      } else {
        // 跳过嵌在单词中间的情况（如 myhttps://example.com），保持原文不动
        boundaryOk = match.index === 0 || !/[A-Za-z0-9_]/.test(text[match.index - 1]);
      }
      if (!boundaryOk) {
        frag.appendChild(document.createTextNode(raw));
        cursor = match.index + raw.length;
        continue;
      }
      const url = cleanUrl(raw);
      if (url) {
        const href = buildHref(url, type);
        const a = document.createElement('a');
        a.className = LINK_CLASS;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = type === 'hash' ? href : url;
        a.textContent = url;
        a.draggable = false; // 关闭链接拖拽，保证拖选文字时能正常选中、复制
        a.addEventListener('click', onLinkClick);
        frag.appendChild(a);
        // 被剥掉的结尾标点补回原文，保持页面文字一字不差
        if (url.length < raw.length) {
          frag.appendChild(document.createTextNode(raw.slice(url.length)));
        }
      }
      cursor = match.index + raw.length;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    processed.set(node, text);
    parent.replaceChild(frag, node);
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const parent = n.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // 先收集再处理：遍历中 replaceChild 会打断 TreeWalker，导致后续文本节点被跳过
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const n of nodes) processTextNode(n);
  }

  function injectStyle() {
    if (document.getElementById('sla-link-style')) return;
    const style = document.createElement('style');
    style.id = 'sla-link-style';
    style.textContent =
      'a.' + LINK_CLASS + '{' +
        'color:#1a0dab;text-decoration:underline;cursor:pointer;border-radius:2px;' +
        '-webkit-user-select:text;user-select:text;' +
        'transition:background-color .15s ease,color .15s ease;' +
      '}' +
      'a.' + LINK_CLASS + ':hover{' +
        'color:#b00000;background-color:#ffe08a;' +
      '}' +
      'html.' + DARK_CLASS + ' a.' + LINK_CLASS + '{' +
        'color:#82b1ff;' +
      '}' +
      'html.' + DARK_CLASS + ' a.' + LINK_CLASS + ':hover{' +
        'color:#ffd54f;background-color:rgba(255,213,79,.22);' +
      '}';
    (document.head || document.documentElement).appendChild(style);
  }

  let pendingRoots = [];
  let rafId = null;

  function scheduleScan(roots) {
    pendingRoots.push(...roots);
    if (rafId !== null) return;
    rafId = requestAnimationFrame(function () {
      rafId = null;
      const batch = pendingRoots;
      pendingRoots = [];
      for (const root of batch) {
        if (!root.isConnected) continue;
        scan(root);
      }
    });
  }

  function handleMutations(mutations) {
    const addedSet = new Set();
    const textTargets = [];
    for (const mut of mutations) {
      if (mut.type === 'characterData') {
        if (mut.target.nodeType === Node.TEXT_NODE) textTargets.push(mut.target);
        continue;
      }
      for (const n of mut.addedNodes) addedSet.add(n);
    }

    for (const t of textTargets) processTextNode(t);

    const roots = [];
    for (const n of addedSet) {
      let p = n.parentElement;
      let nested = false;
      while (p) {
        if (addedSet.has(p)) {
          nested = true;
          break;
        }
        p = p.parentElement;
      }
      if (!nested) roots.push(n);
    }
    scheduleDarkCheck();
    if (roots.length) scheduleScan(roots);
  }

  function init() {
    registerMenuCommands();
    // 黑名单内的网站：完全不运行转换逻辑（菜单保留，方便随时解除屏蔽）
    if (isCurrentBlocked()) return;
    injectStyle();
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    scan(document.body || document.documentElement);
    applyDarkMode(detectDarkMode());
    observeThemeChanges();
    new MutationObserver(handleMutations).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
