(() => {
  const treeEl = document.getElementById('tree');
  const readerEl = document.getElementById('reader');
  const indexNavEl = document.getElementById('index');

  const modeSwitchEl = document.getElementById('mode-switch');
  const mailSidebarEl = document.getElementById('mail-sidebar');
  const mailListEl = document.getElementById('mail-list');
  const mailHamburgerEl = document.getElementById('mail-hamburger');
  const mailAvatarEl = document.getElementById('mail-avatar');
  const mailAvatarFallbackEl = document.getElementById('mail-avatar-fallback');
  const mailAccountNameEl = document.getElementById('mail-account-name');
  const mailAccountEmailEl = document.getElementById('mail-account-email');
  const mailSwitcherEl = document.getElementById('mail-account-switcher');

  let ROOT = null;
  const nodesByPath = new Map();
  const parentByPath = new Map();
  const openPaths = new Set();
  let currentPath = null; // used to work out swipe/animation direction

  let MAIL_ACCOUNTS = [];
  const accountsById = new Map();
  let mode = 'docs'; // 'docs' | 'mail'
  let lastDocsPath = ''; // remembered so switching back to Documents restores where you were
  const readMessages = new Set(); // `${accountId}::${messageId}` — in-memory only, resets on reload
  let switcherOpen = false;

  const STAMPS = ['CASE FILE', 'ON RECORD', 'ARCHIVED', 'CLEARED'];

  init();

  async function init() {
    bindModeSwitch();
    bindMailUi();

    try {
      const res = await fetch('data/index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('index not found');
      ROOT = await res.json();
      indexNodes(ROOT, null);
      renderTree();
      bindGlobalNav();
    } catch (err) {
      treeEl.innerHTML = `<div class="tree-error">Could not load data/index.json.<br>Run the build script or push to trigger the GitHub Action.</div>`;
      readerEl.innerHTML = `<div class="doc-empty">No index yet. See the sidebar for details.</div>`;
      console.error(err);
    }

    try {
      const res = await fetch('data/mail.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        MAIL_ACCOUNTS = (data && data.accounts) || [];
        MAIL_ACCOUNTS.forEach((acc) => {
          accountsById.set(acc.id, acc);
          (acc.messages || []).forEach((m) => {
            if (!m.unread) readMessages.add(`${acc.id}::${m.id}`);
          });
        });
      }
    } catch (err) {
      console.error('Could not load data/mail.json', err);
    }

    if (!MAIL_ACCOUNTS.length && modeSwitchEl) {
      const mailBtn = modeSwitchEl.querySelector('[data-mode="mail"]');
      if (mailBtn) mailBtn.hidden = true;
    }

    window.addEventListener('hashchange', route);
    route(true);
  }

  function indexNodes(node, parent) {
    nodesByPath.set(node.path, node);
    if (parent) parentByPath.set(node.path, parent.path);
    // root and top-level categories start open; everything deeper starts collapsed
    if (node.path === '' || node.path.split('/').length === 1) openPaths.add(node.path);
    (node.children || []).forEach((c) => indexNodes(c, node));
  }

  // ---------- routing ----------

  function parseHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (raw.startsWith('mail:')) {
      const rest = raw.slice(5);
      const sep = rest.indexOf(':');
      if (sep === -1) return { mode: 'mail', accountId: rest, messageId: null };
      return { mode: 'mail', accountId: rest.slice(0, sep), messageId: rest.slice(sep + 1) || null };
    }
    if (raw.startsWith('docs:')) return { mode: 'docs', path: raw.slice(5) };
    return { mode: 'docs', path: raw }; // bare hash = docs path, for backward compatibility
  }

  function route(isInitial) {
    const parsed = parseHash();

    if (parsed.mode === 'mail' && MAIL_ACCOUNTS.length) {
      setMode('mail', { skipNav: true });
      const account = accountsById.get(parsed.accountId) || MAIL_ACCOUNTS[0];
      renderMailSidebar(account.id);
      renderMailReader(account, parsed.messageId);
      return;
    }

    setMode('docs', { skipNav: true });
    const path = parsed.path || '';
    const node = nodesByPath.get(path) || ROOT;
    lastDocsPath = node.path;
    const parts = node.path ? node.path.split('/') : [];
    let acc = '';
    parts.forEach((p, i) => {
      acc = i === 0 ? p : acc + '/' + p;
      openPaths.add(acc);
    });
    openPaths.add('');
    renderTree();
    renderDoc(node, isInitial ? 'up' : undefined);
  }

  function navigate(path) {
    if (mode === 'docs' && path === currentPath) return;
    location.hash = `docs:${encodeURIComponent(path)}`;
  }

  function navigateMail(accountId, messageId) {
    location.hash = `mail:${encodeURIComponent(accountId)}${messageId ? ':' + encodeURIComponent(messageId) : ''}`;
  }

  // ---------- mode switching (Documents / Mail) ----------

  function setMode(next, opts) {
    opts = opts || {};
    mode = next;
    if (modeSwitchEl) {
      modeSwitchEl.querySelectorAll('.mode-btn').forEach((btn) => {
        const active = btn.dataset.mode === next;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      });
    }
    indexNavEl.hidden = next !== 'docs';
    mailSidebarEl.hidden = next !== 'mail';
    // Belt-and-braces: set the inline style directly too. [hidden] should be
    // enough on its own, but an inline style can't be shadowed by any stylesheet
    // rule, ordering, or stale cached CSS — so the two panels can never both be
    // visible at once no matter what.
    indexNavEl.style.display = next === 'docs' ? '' : 'none';
    mailSidebarEl.style.display = next === 'mail' ? '' : 'none';
    if (next !== 'mail') closeSwitcher();
    if (!opts.skipNav) {
      if (next === 'mail' && MAIL_ACCOUNTS.length) {
        navigateMail(MAIL_ACCOUNTS[0].id, null);
      } else {
        navigate(lastDocsPath || '');
      }
    }
  }

  function bindModeSwitch() {
    if (!modeSwitchEl) return;
    modeSwitchEl.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        setMode(btn.dataset.mode);
      });
    });
  }

  function toggleOpen(path) {
    if (openPaths.has(path)) openPaths.delete(path); else openPaths.add(path);
    renderTree();
  }

  // ---------- sibling helpers (power the swipe / prev-next nav) ----------

  function getSiblings(path) {
    const parentPath = parentByPath.get(path);
    if (parentPath === undefined) return [ROOT];
    const parent = nodesByPath.get(parentPath);
    return (parent && parent.children) || [];
  }

  function getAdjacent(path, dir) {
    const siblings = getSiblings(path);
    const idx = siblings.findIndex((s) => s.path === path);
    if (idx === -1) return null;
    const next = siblings[idx + dir];
    return next || null;
  }

  // ---------- sidebar tree ----------

  function renderTree() {
    treeEl.innerHTML = '';
    treeEl.appendChild(buildTreeNode(ROOT, true));
  }

  function buildTreeNode(node, isRoot) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';

    const hasChildren = node.children && node.children.length > 0;
    const isOpen = openPaths.has(node.path);
    const activePath = decodeURIComponent(location.hash.replace(/^#/, '')) || '';
    const isActive = (activePath === node.path) || (isRoot && activePath === '');

    if (!isRoot) {
      const row = document.createElement('div');
      row.className = 'tree-row' + (isActive ? ' active' : '');
      row.tabIndex = 0;
      row.setAttribute('role', 'treeitem');
      if (hasChildren) row.setAttribute('aria-expanded', String(isOpen));

      const caret = document.createElement('span');
      caret.className = 'tree-caret' + (hasChildren ? (isOpen ? ' open' : '') : ' leaf');
      caret.textContent = '▸';
      if (hasChildren) {
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.Sound) Sound.click();
          toggleOpen(node.path);
        });
      }

      const tab = document.createElement('span');
      tab.className = 'tree-tab' + (node.hasContent ? '' : ' folder-only');

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = node.title;

      row.append(caret, tab, label);
      row.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        // clicking a category you're already viewing just opens/closes it
        if (hasChildren && node.path === currentPath) {
          toggleOpen(node.path);
          return;
        }
        if (hasChildren) openPaths.add(node.path);
        navigate(node.path);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });

      wrap.appendChild(row);
    }

    if (hasChildren) {
      const childWrap = document.createElement('div');
      childWrap.className = 'tree-children' + (isOpen || isRoot ? ' open' : '');
      node.children.forEach((child) => childWrap.appendChild(buildTreeNode(child, false)));
      wrap.appendChild(childWrap);
    }

    return wrap;
  }

  // ---------- document reader ----------

  function renderDoc(node) {
    if (!node) {
      readerEl.innerHTML = `<div class="doc-empty">Nothing here yet.</div>`;
      currentPath = null;
      return;
    }

    currentPath = node.path;
    if (window.Sound) Sound.slide();

    if (!node.hasContent) {
      const list = (node.children || []).map((c) => (
        `<div class="doc-child-link" data-path="${escapeAttr(c.path)}"><span class="arrow">›</span>${escapeHtml(c.title)}</div>`
      )).join('');
      readerEl.innerHTML = `
        <article class="doc-page enter-right">
          <div class="doc-meta">Category</div>
          <h1 class="doc-title">${escapeHtml(node.title)}</h1>
          <div class="doc-divider"></div>
          <div class="doc-children">
            <div class="doc-children-label">Contents</div>
            ${list || '<div class="doc-empty" style="padding:0;text-align:left;">Empty — add a content.txt somewhere inside this folder.</div>'}
          </div>
        </article>`;
      bindChildLinks();
      readerEl.scrollTop = 0;
      return;
    }

    const stamp = STAMPS[hashCode(node.path) % STAMPS.length];
    const childList = (node.children || []).map((c) => (
      `<div class="doc-child-link" data-path="${escapeAttr(c.path)}"><span class="arrow">›</span>${escapeHtml(c.title)}</div>`
    )).join('');

    const headerHtml = node.image ? `
      <div class="doc-header">
        <div class="doc-photo"><img src="${escapeAttr(node.image)}" alt="${escapeAttr(node.title)}" loading="lazy"></div>
        <div class="doc-header-text">
          <h1 class="doc-title">${escapeHtml(node.title)}</h1>
          ${node.tagline ? `<p class="doc-tagline">${inline(node.tagline)}</p>` : ''}
        </div>
      </div>
    ` : `
      <h1 class="doc-title">${escapeHtml(node.title)}</h1>
      ${node.tagline ? `<p class="doc-tagline">${inline(node.tagline)}</p>` : ''}
    `;

    const siblings = getSiblings(node.path);
    const idx = siblings.findIndex((s) => s.path === node.path);
    const prev = idx > 0 ? siblings[idx - 1] : null;
    const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    const navHtml = siblings.length > 1 ? `
      <div class="doc-nav">
        <button class="doc-nav-btn" data-nav="-1" ${prev ? '' : 'disabled'}>‹ Previous</button>
        <span class="doc-nav-pos">${idx + 1} / ${siblings.length}</span>
        <button class="doc-nav-btn" data-nav="1" ${next ? '' : 'disabled'}>Next ›</button>
      </div>` : '';

    readerEl.innerHTML = `
      <article class="doc-page enter-right">
        <div class="doc-stamp">${stamp}</div>
        <div class="doc-meta">${escapeHtml(node.path || 'root')}</div>
        ${headerHtml}
        <div class="doc-divider"></div>
        <div class="doc-body">${node.html}</div>
        ${node.children && node.children.length ? `
        <div class="doc-children">
          <div class="doc-children-label">Related</div>
          ${childList}
        </div>` : ''}
        ${navHtml}
      </article>`;
    bindChildLinks();
    bindDocNav();
    readerEl.scrollTop = 0;
  }

  function bindChildLinks() {
    readerEl.querySelectorAll('.doc-child-link').forEach((el) => {
      el.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        navigate(el.dataset.path);
      });
    });
  }

  function bindDocNav() {
    readerEl.querySelectorAll('.doc-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        const dir = parseInt(btn.dataset.nav, 10);
        const adj = getAdjacent(currentPath, dir);
        if (adj) navigate(adj.path);
      });
    });
  }

  function parseRuDate(str) {
    if (!str) return null;
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(str.trim());
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const d = new Date(year, month, day); // local time, 0:00 — no time-of-day is stored
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
    return d;
  }

  function pluralizeRu(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
  }

  // Renders a "date" field dynamically as relative time from *now*, recomputed
  // on every render (not baked in at build time) so it keeps counting up the
  // longer the page stays live. Accepts "ДД.ММ.ГГГГ"; anything else that
  // doesn't parse is shown as-is, for backward compatibility with free text.
  function formatMailDate(raw) {
    if (!raw) return '';
    const date = parseRuDate(raw);
    if (!date) return raw;

    const today = new Date();
    const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((todayMid - date) / 86400000);

    if (diffDays === 0) return 'сегодня';
    if (diffDays === 1) return 'вчера';
    if (diffDays > 1) return `${diffDays} ${pluralizeRu(diffDays, ['день', 'дня', 'дней'])} назад`;
    if (diffDays === -1) return 'завтра';
    const abs = Math.abs(diffDays);
    return `через ${abs} ${pluralizeRu(abs, ['день', 'дня', 'дней'])}`;
  }

  // ---------- mail sidebar (topbar, account switcher, Gmail-style list) ----------

  function initials(name) {
    return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
  }

  function setAvatar(imgEl, fallbackEl, src, name) {
    if (src) {
      imgEl.src = src;
      imgEl.alt = name || '';
      imgEl.hidden = false;
      fallbackEl.hidden = true;
    } else {
      imgEl.hidden = true;
      fallbackEl.hidden = false;
      fallbackEl.textContent = initials(name);
    }
  }

  function renderMailSidebar(activeAccountId) {
    const account = accountsById.get(activeAccountId) || MAIL_ACCOUNTS[0];
    if (!account) return;

    setAvatar(mailAvatarEl, mailAvatarFallbackEl, account.avatar, account.name);
    mailAccountNameEl.textContent = account.name;
    mailAccountEmailEl.textContent = account.email || '';

    renderAccountSwitcher(account.id);
    renderMessageList(account);
  }

  function renderAccountSwitcher(activeAccountId) {
    mailSwitcherEl.innerHTML = MAIL_ACCOUNTS.map((acc) => {
      const avatarHtml = acc.avatar
        ? `<img class="mail-avatar" src="${escapeAttr(acc.avatar)}" alt="">`
        : `<div class="mail-avatar mail-avatar-fallback">${escapeHtml(initials(acc.name))}</div>`;
      return `
        <div class="mail-switcher-item${acc.id === activeAccountId ? ' active' : ''}" data-account="${escapeAttr(acc.id)}">
          ${avatarHtml}
          <span class="mail-switcher-name">${escapeHtml(acc.name)}</span>
        </div>`;
    }).join('');
    mailSwitcherEl.querySelectorAll('.mail-switcher-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        closeSwitcher();
        navigateMail(el.dataset.account, null);
      });
    });
  }

  function openSwitcher() {
    switcherOpen = true;
    mailSwitcherEl.hidden = false;
    mailHamburgerEl.setAttribute('aria-expanded', 'true');
  }
  function closeSwitcher() {
    switcherOpen = false;
    mailSwitcherEl.hidden = true;
    mailHamburgerEl.setAttribute('aria-expanded', 'false');
  }

  function bindMailUi() {
    if (!mailHamburgerEl) return;
    mailHamburgerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.Sound) Sound.click();
      if (switcherOpen) closeSwitcher(); else openSwitcher();
    });
    document.addEventListener('click', (e) => {
      if (switcherOpen && !mailSwitcherEl.contains(e.target) && e.target !== mailHamburgerEl) closeSwitcher();
    });
  }

  function renderMessageList(account) {
    const currentParsed = parseHash();
    const activeMessageId = currentParsed.mode === 'mail' ? currentParsed.messageId : null;

    const messages = account.messages || [];
    if (!messages.length) {
      mailListEl.innerHTML = `<div class="mail-list-empty">Пусто — в этом ящике пока нет писем.</div>`;
      return;
    }

    // newest first: files are named/sorted oldest-first on disk (01_, 02_, ...)
    const ordered = messages.slice().reverse();

    mailListEl.innerHTML = ordered.map((m) => {
      const key = `${account.id}::${m.id}`;
      const unread = !readMessages.has(key);
      const active = m.id === activeMessageId;
      return `
        <div class="mail-item${unread ? ' unread' : ''}${active ? ' active' : ''}" data-msg="${escapeAttr(m.id)}">
          <div class="mail-item-row">
            <span class="mail-item-subject"><span class="mail-item-dot"></span>${escapeHtml(m.subject)}</span>
            ${m.date ? `<span class="mail-item-date">${escapeHtml(formatMailDate(m.date))}</span>` : ''}
          </div>
          ${m.preview ? `<div class="mail-item-preview">${escapeHtml(m.preview)}</div>` : ''}
        </div>`;
    }).join('');

    mailListEl.querySelectorAll('.mail-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (window.Sound) Sound.click();
        navigateMail(account.id, el.dataset.msg);
      });
    });
  }

  function renderMailReader(account, messageId) {
    // Deliberately no Sound.slide() here — browsing mail (switching accounts,
    // opening the inbox) stays silent; only actually opening a message chimes.
    currentPath = null; // mail isn't part of the docs prev/next chain

    if (!messageId) {
      readerEl.innerHTML = `<div class="doc-empty">Выберите письмо слева, чтобы прочитать его.</div>`;
      readerEl.scrollTop = 0;
      return;
    }

    const message = (account.messages || []).find((m) => m.id === messageId);
    if (!message) {
      readerEl.innerHTML = `<div class="doc-empty">Письмо не найдено.</div>`;
      readerEl.scrollTop = 0;
      return;
    }

    readMessages.add(`${account.id}::${message.id}`);
    renderMessageList(account); // refresh unread dot + active highlight in the list
    if (window.Sound) Sound.mail();

    const avatarHtml = account.avatar
      ? `<img class="mail-avatar" src="${escapeAttr(account.avatar)}" alt="">`
      : `<div class="mail-avatar mail-avatar-fallback">${escapeHtml(initials(account.name))}</div>`;

    readerEl.innerHTML = `
      <article class="doc-page enter-right">
        <button class="mail-return" type="button">‹ Назад к списку</button>
        <div class="doc-meta">${escapeHtml(account.email || account.name)}</div>
        <h1 class="doc-title">${escapeHtml(message.subject)}</h1>
        <div class="mail-from">
          ${avatarHtml}
          <div class="mail-from-text">
            <div class="mail-from-name">${escapeHtml(account.name)}</div>
            <div class="mail-from-email">${escapeHtml(account.email || '')}</div>
          </div>
          ${message.date ? `<div class="mail-from-date">${escapeHtml(formatMailDate(message.date))}</div>` : ''}
        </div>
        <div class="doc-divider"></div>
        <div class="doc-body">${message.html}</div>
      </article>`;

    readerEl.querySelector('.mail-return').addEventListener('click', () => {
      if (window.Sound) Sound.click();
      navigateMail(account.id, null);
    });
    readerEl.scrollTop = 0;
  }

  // ---------- global swipe + keyboard navigation ----------

  function bindGlobalNav() {
    let touchStartX = null;
    let touchStartY = null;

    readerEl.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    readerEl.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const dir = dx < 0 ? 1 : -1; // swipe left -> next document
      const adj = getAdjacent(currentPath, dir);
      if (adj) navigate(adj.path);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') {
        const adj = getAdjacent(currentPath, 1);
        if (adj) navigate(adj.path);
      } else if (e.key === 'ArrowLeft') {
        const adj = getAdjacent(currentPath, -1);
        if (adj) navigate(adj.path);
      }
    });
  }

  // tagline still gets bold/italic support; everything else is pre-rendered by
  // scripts/build_index.py and injected as node.html above
  function inline(text) {
    let out = text; // raw HTML passes through untouched, same as the body renderer
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
    return out;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
})();
