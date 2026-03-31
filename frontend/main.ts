/**
 * WebAuthn TODO - フロントエンド (TypeScript)
 *
 * WebAuthn PRF拡張でAES-GCM-256鍵を導出し、
 * TODOコンテンツをクライアントサイドで暗号化するゼロナレッジTODOアプリ
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';

// ========================
// 型定義
// ========================

interface EncryptedTodo {
  id: string;
  encrypted_data: string;
  iv: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

interface TodoData {
  title: string;
  completed: boolean;
}

interface DecryptedTodo extends EncryptedTodo, TodoData {}

type Filter = 'all' | 'active' | 'completed';

// ========================
// 状態管理
// ========================

/** PRF由来の暗号鍵（メモリのみ・ページ離脱で消失） */
let encryptionKey: CryptoKey | null = null;
let todosCache: EncryptedTodo[] = [];
let decryptedCache: DecryptedTodo[] = [];
let currentFilter: Filter = 'all';

// ========================
// 起動処理
// ========================

async function init(): Promise<void> {
  if (!browserSupportsWebAuthn()) {
    alert('このブラウザはWebAuthnをサポートしていませんわ');
    return;
  }

  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const user = await res.json() as { id: string; username: string };
      showUnlockSection(user.username);
    } else {
      showLP();
    }
  } catch {
    showLP();
  }
}

// ========================
// 画面切り替え
// ========================

function hideAll(): void {
  document.getElementById('lp-section')!.style.display = 'none';
  document.getElementById('auth-section')!.style.display = 'none';
  document.getElementById('unlock-section')!.style.display = 'none';
  document.getElementById('todo-section')!.style.display = 'none';
  document.getElementById('lock-status')!.style.display = 'none';
  document.getElementById('logout-btn')!.style.display = 'none';
  document.getElementById('site-footer')!.style.display = '';
}

function showLP(): void {
  hideAll();
  document.getElementById('lp-section')!.style.display = '';
}

function showAuthCard(): void {
  hideAll();
  document.getElementById('auth-section')!.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showUnlockSection(username: string): void {
  hideAll();
  document.getElementById('unlock-section')!.style.display = '';
  document.getElementById('lock-status')!.style.display = '';
  document.getElementById('lock-status')!.className = 'lock-status locked';
  document.getElementById('lock-icon')!.textContent = '🔒';
  document.getElementById('lock-label')!.textContent = username;
  document.getElementById('logout-btn')!.style.display = '';
}

function showTodoSection(username: string): void {
  hideAll();
  document.getElementById('todo-section')!.style.display = '';
  document.getElementById('lock-status')!.style.display = '';
  document.getElementById('lock-status')!.className = 'lock-status unlocked';
  document.getElementById('lock-icon')!.textContent = '🔓';
  document.getElementById('lock-label')!.textContent = username;
  document.getElementById('logout-btn')!.style.display = '';
}

// ========================
// タブ切り替え（グローバル公開）
// ========================

function switchTab(tab: 'login' | 'register'): void {
  const isLogin = tab === 'login';
  document.getElementById('tab-login')!.className = 'tab-btn' + (isLogin ? ' active' : '');
  document.getElementById('tab-register')!.className = 'tab-btn' + (!isLogin ? ' active' : '');
  document.getElementById('login-form')!.style.display = isLogin ? '' : 'none';
  document.getElementById('register-form')!.style.display = isLogin ? 'none' : '';
}

// ========================
// 登録
// ========================

async function doRegister(): Promise<void> {
  const usernameEl = document.getElementById('reg-username') as HTMLInputElement;
  const username = usernameEl.value.trim();
  if (!username) {
    showMessage('register-message', 'ユーザー名を入力してくださいませ', 'error');
    return;
  }

  const btn = document.getElementById('register-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'パスキーを登録中...';
  clearMessage('register-message');

  try {
    const optRes = await fetch('/api/auth/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!optRes.ok) {
      const err = await optRes.json() as { error: string };
      throw new Error(err.error);
    }
    const { options, userId, prfSalt } = await optRes.json() as {
      options: Parameters<typeof startRegistration>[0]['optionsJSON'];
      userId: string;
      prfSalt: string;
    };

    // PRF拡張を追加
    (options as Record<string, unknown>).extensions = {
      ...((options as Record<string, unknown>).extensions as object ?? {}),
      prf: {},
    };

    let credential;
    try {
      credential = await startRegistration({ optionsJSON: options });
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === 'NotAllowedError') throw new Error('キャンセルされましたわ');
      throw err;
    }

    const prfCapable = (credential.clientExtensionResults as Record<string, unknown> & {
      prf?: { enabled?: boolean };
    })?.prf?.enabled === true;

    if (!prfCapable) {
      throw new Error(
        'お使いの認証器はPRF拡張をサポートしていませんわ。\n' +
        '1Password・iCloud Keychain・YubiKey(FW5.7+)などが対応していますわ。'
      );
    }

    const verRes = await fetch('/api/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, userId, prfSalt, prfCapable, credential }),
    });
    if (!verRes.ok) {
      const err = await verRes.json() as { error: string };
      throw new Error(err.error);
    }

    showMessage('register-message', '登録完了ですわ！ログインしてください', 'success');
    usernameEl.value = '';
    setTimeout(() => switchTab('login'), 1500);
  } catch (err: unknown) {
    showMessage('register-message', String((err as Error).message ?? err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'パスキーを登録';
  }
}

// ========================
// ログイン
// ========================

async function doLogin(): Promise<void> {
  const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
  if (!username) {
    showMessage('login-message', 'ユーザー名を入力してくださいませ', 'error');
    return;
  }

  const btn = document.getElementById('login-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '認証中...';
  clearMessage('login-message');

  try {
    await performAuthentication(username, 'login-message');
  } finally {
    btn.disabled = false;
    btn.textContent = 'パスキーでログイン';
  }
}

// ========================
// アンロック
// ========================

async function doUnlock(): Promise<void> {
  clearMessage('unlock-message');

  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) { showLP(); return; }
    const user = await meRes.json() as { username: string };
    await performAuthentication(user.username, 'unlock-message');
  } catch (err: unknown) {
    showMessage('unlock-message', String((err as Error).message ?? err), 'error');
  }
}

// ========================
// 認証共通処理
// ========================

async function performAuthentication(username: string, messageId: string): Promise<void> {
  const optRes = await fetch('/api/auth/login/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!optRes.ok) {
    const err = await optRes.json() as { error: string };
    throw new Error(err.error);
  }
  const { options, prfSalts } = await optRes.json() as {
    options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
    prfSalts: Record<string, string>;
  };

  // PRF evalByCredential を構築
  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  for (const [credId, saltBase64] of Object.entries(prfSalts)) {
    evalByCredential[credId] = { first: base64urlToBuffer(saltBase64) };
  }

  (options as Record<string, unknown>).extensions = {
    ...((options as Record<string, unknown>).extensions as object ?? {}),
    prf: Object.keys(evalByCredential).length > 0 ? { evalByCredential } : {},
  };

  let credential;
  try {
    credential = await startAuthentication({ optionsJSON: options });
  } catch (err: unknown) {
    const e = err as { name?: string };
    if (e.name === 'NotAllowedError') throw new Error('キャンセルされましたわ');
    throw err;
  }

  const prfResults = (credential.clientExtensionResults as Record<string, unknown> & {
    prf?: { results?: { first?: ArrayBuffer } };
  })?.prf?.results?.first;

  if (!prfResults) {
    throw new Error('PRF出力が得られませんでしたわ。PRF対応の認証器が必要ですわ。');
  }

  // PRF出力はサーバーに送らない
  const verRes = await fetch('/api/auth/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential),
  });
  if (!verRes.ok) {
    const err = await verRes.json() as { error: string };
    throw new Error(err.error);
  }

  // PRF出力 → HKDF → AES-GCM-256鍵
  encryptionKey = await deriveEncryptionKey(prfResults);

  const meRes = await fetch('/api/auth/me');
  if (meRes.ok) {
    const user = await meRes.json() as { username: string };
    showTodoSection(user.username);
    await loadTodos();
  }

  void messageId; // 使われなかった場合の警告回避
}

// ========================
// ログアウト
// ========================

document.getElementById('logout-btn')!.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  encryptionKey = null;
  todosCache = [];
  decryptedCache = [];
  currentFilter = 'all';
  showLP();
});

// ========================
// 暗号化ユーティリティ
// ========================

async function deriveEncryptionKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('webauthn-todo-encryption-v1'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptTodo(data: TodoData): Promise<{ encrypted_data: string; iv: string }> {
  if (!encryptionKey) throw new Error('暗号鍵がありませんわ');
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);
  return { encrypted_data: bufferToBase64(ciphertext), iv: bufferToBase64(iv.buffer as ArrayBuffer) };
}

async function decryptTodo(encryptedData: string, ivStr: string): Promise<TodoData> {
  if (!encryptionKey) throw new Error('暗号鍵がありませんわ');
  const ciphertext = base64ToBuffer(encryptedData);
  const iv = base64ToBuffer(ivStr);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as TodoData;
}

// ========================
// TODO操作
// ========================

async function loadTodos(): Promise<void> {
  const listEl = document.getElementById('todo-list')!;
  listEl.innerHTML = '<div class="loading"><span class="spinner"></span>読み込み中...</div>';

  try {
    const res = await fetch('/api/todos');
    if (!res.ok) throw new Error('取得に失敗しましたわ');

    const encrypted = await res.json() as EncryptedTodo[];
    todosCache = encrypted;

    decryptedCache = await Promise.all(
      encrypted.map(async (todo) => {
        const data = await decryptTodo(todo.encrypted_data, todo.iv);
        return { ...todo, ...data };
      })
    );

    renderTodos(decryptedCache);
  } catch (err: unknown) {
    listEl.innerHTML = `<div class="message error show">${escapeHtml((err as Error).message)}</div>`;
  }
}

function applyFilter(todos: DecryptedTodo[]): DecryptedTodo[] {
  if (currentFilter === 'active') return todos.filter((t) => !t.completed);
  if (currentFilter === 'completed') return todos.filter((t) => t.completed);
  return todos;
}

function renderTodos(todos: DecryptedTodo[]): void {
  const listEl = document.getElementById('todo-list')!;
  const countEl = document.getElementById('todo-count')!;
  const clearWrap = document.getElementById('clear-completed-wrap')!;

  const total = todos.length;
  const done = todos.filter((t) => t.completed).length;
  const hasCompleted = done > 0;

  countEl.textContent = total === 0 ? '' : `${done} / ${total} 完了`;
  clearWrap.style.display = hasCompleted ? '' : 'none';

  const filtered = applyFilter(todos);

  if (filtered.length === 0) {
    const emptyMsg = currentFilter === 'active'
      ? '未完了のTODOはありませんわ！'
      : currentFilter === 'completed'
      ? '完了済みのTODOはありませんわ'
      : 'TODOがありませんわ。追加してみてくださいませ！';

    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>${emptyMsg}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (todo) => `
    <div class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
      <button class="todo-checkbox"
        onclick="window.__toggleTodo('${todo.id}', ${!todo.completed})"
        title="${todo.completed ? '未完了に戻す' : '完了にする'}"
      >${todo.completed ? '✓' : ''}</button>
      <span class="todo-title"
        ondblclick="window.__editTodo('${todo.id}', '${escapeAttr(todo.title)}')"
        title="ダブルクリックで編集"
      >${escapeHtml(todo.title)}</span>
      <button class="btn-danger" onclick="window.__deleteTodo('${todo.id}')" title="削除">×</button>
    </div>`
    )
    .join('');
}

async function addTodo(): Promise<void> {
  const input = document.getElementById('new-todo-input') as HTMLInputElement;
  const title = input.value.trim();
  if (!title) return;

  try {
    const { encrypted_data, iv } = await encryptTodo({ title, completed: false });
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_data, iv }),
    });
    if (!res.ok) throw new Error('追加に失敗しましたわ');
    input.value = '';
    await loadTodos();
  } catch (err: unknown) {
    alert((err as Error).message);
  }
}

async function toggleTodo(id: string, completed: boolean): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  try {
    const data = await decryptTodo(todo.encrypted_data, todo.iv);
    const { encrypted_data, iv } = await encryptTodo({ ...data, completed });
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_data, iv }),
    });
    if (!res.ok) throw new Error('更新に失敗しましたわ');
    await loadTodos();
  } catch (err: unknown) {
    alert((err as Error).message);
  }
}

async function deleteTodo(id: string): Promise<void> {
  if (!confirm('このTODOを削除しますわよ？')) return;
  try {
    const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('削除に失敗しましたわ');
    await loadTodos();
  } catch (err: unknown) {
    alert((err as Error).message);
  }
}

// ========================
// インライン編集
// ========================

function startEditTodo(id: string, currentTitle: string): void {
  const item = document.querySelector<HTMLElement>(`.todo-item[data-id="${id}"]`);
  if (!item) return;

  const titleEl = item.querySelector<HTMLElement>('.todo-title');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.className = 'todo-edit-input';
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;

  const save = async (): Promise<void> => {
    if (cancelled) return;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      try {
        await updateTodoTitle(id, newTitle);
      } catch (err: unknown) {
        alert((err as Error).message);
        await loadTodos();
      }
    } else {
      await loadTodos();
    }
  };

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      cancelled = true;
      await loadTodos();
    }
  });

  input.addEventListener('blur', save);
}

async function updateTodoTitle(id: string, newTitle: string): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  const data = await decryptTodo(todo.encrypted_data, todo.iv);
  const { encrypted_data, iv } = await encryptTodo({ ...data, title: newTitle });
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_data, iv }),
  });
  if (!res.ok) throw new Error('更新に失敗しましたわ');
  await loadTodos();
}

// ========================
// フィルター
// ========================

function setFilter(filter: Filter): void {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach((btn) => btn.classList.remove('active'));
  document.getElementById(`filter-${filter}`)?.classList.add('active');
  renderTodos(decryptedCache);
}

// ========================
// 完了済み一括削除
// ========================

async function clearCompleted(): Promise<void> {
  const completedIds = decryptedCache.filter((t) => t.completed).map((t) => t.id);
  if (completedIds.length === 0) return;
  if (!confirm(`完了済み ${completedIds.length} 件を削除しますわよ？`)) return;

  try {
    await Promise.all(
      completedIds.map((id) =>
        fetch(`/api/todos/${id}`, { method: 'DELETE' })
      )
    );
    await loadTodos();
  } catch (err: unknown) {
    alert((err as Error).message);
  }
}

// ========================
// プライバシーポリシー
// ========================

function showPrivacyPolicy(e?: Event): void {
  e?.preventDefault();
  const modal = document.getElementById('privacy-modal')!;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function hidePrivacyPolicy(e?: Event): void {
  if (e && e.target !== document.getElementById('privacy-modal')) return;
  const modal = document.getElementById('privacy-modal')!;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Escキーでモーダルを閉じる
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('privacy-modal')!;
    if (modal.style.display !== 'none') {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }
});

// ========================
// UIユーティリティ
// ========================

function showMessage(id: string, text: string, type: 'error' | 'success' | 'warning'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type} show`;
}

function clearMessage(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.className = 'message';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** onclick属性値用エスケープ（シングルクォート・バックスラッシュ） */
function escapeAttr(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ========================
// Base64 / ArrayBuffer 変換
// ========================

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return base64ToBuffer(pad ? padded + '='.repeat(4 - pad) : padded);
}

// ========================
// グローバルハンドラ（HTML onclick 用）
// ========================

declare global {
  interface Window {
    __toggleTodo: (id: string, completed: boolean) => void;
    __deleteTodo: (id: string) => void;
    __editTodo: (id: string, currentTitle: string) => void;
    switchTab: (tab: 'login' | 'register') => void;
    loginHandler: () => void;
    registerHandler: () => void;
    unlockHandler: () => void;
    addTodoHandler: () => void;
    setFilter: (filter: Filter) => void;
    clearCompletedHandler: () => void;
    showAuthFromLP: () => void;
    showLP: () => void;
    showPrivacyPolicy: (e?: Event) => void;
    hidePrivacyPolicy: (e?: Event) => void;
  }
}

window.switchTab = switchTab;
window.loginHandler = doLogin;
window.registerHandler = doRegister;
window.unlockHandler = doUnlock;
window.addTodoHandler = addTodo;
window.__toggleTodo = toggleTodo;
window.__deleteTodo = deleteTodo;
window.__editTodo = startEditTodo;
window.setFilter = setFilter;
window.clearCompletedHandler = clearCompleted;
window.showAuthFromLP = showAuthCard;
window.showLP = showLP;
window.showPrivacyPolicy = showPrivacyPolicy;
window.hidePrivacyPolicy = hidePrivacyPolicy;

// ========================
// Service Worker 登録
// ========================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SWの登録失敗は非クリティカル（PWA機能なしで動作続行）
    });
  });
}

// ========================
// エントリポイント
// ========================

init();
