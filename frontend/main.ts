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
import {
  createEditor,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { registerRichText, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  ListNode,
  ListItemNode,
  registerList,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from '@lexical/list';

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

type Priority = 'high' | 'medium' | 'low';
type KanbanStatus = 'todo' | 'doing' | 'done';
type ViewMode = 'list' | 'kanban';

interface TodoData {
  title: string;
  completed: boolean;
  priority?: Priority;
  dueDate?: string;        // "YYYY-MM-DD"
  notes?: string;          // Lexical editor state JSON string
  status?: KanbanStatus;   // カンバン列
}

interface DecryptedTodo extends EncryptedTodo, TodoData {}

type Filter = 'all' | 'active' | 'completed';

interface UserSettings {
  view: ViewMode;
  kanbanColumns: Record<KanbanStatus, string>;
  accentColor: string;
  fontSize: 'sm' | 'md' | 'lg';
}

const DEFAULT_SETTINGS: UserSettings = {
  view: 'list',
  kanbanColumns: { todo: '未着手', doing: '進行中', done: '完了' },
  accentColor: '#73862d',
  fontSize: 'md',
};

const ACCENT_PRESETS = ['#73862d', '#2d6886', '#862d3c', '#6b4c86', '#86632d', '#2d7055'] as const;
const FONT_SIZE_MAP: Record<UserSettings['fontSize'], string> = { sm: '14px', md: '16px', lg: '18px' };
const KANBAN_ORDER: KanbanStatus[] = ['todo', 'doing', 'done'];

const PRIORITY_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_NEXT: Record<Priority, Priority> = { high: 'medium', medium: 'low', low: 'high' };
const PRIORITY_TITLE: Record<Priority, string> = {
  high: '優先度: 高（クリックで変更）',
  medium: '優先度: 中（クリックで変更）',
  low: '優先度: 低（クリックで変更）',
};

// ========================
// 状態管理
// ========================

/** PRF由来の暗号鍵（メモリのみ・ページ離脱で消失） */
let encryptionKey: CryptoKey | null = null;
let todosCache: EncryptedTodo[] = [];
let decryptedCache: DecryptedTodo[] = [];
let currentFilter: Filter = 'all';

/** 開いているLexicalエディタのマップ */
const openEditors = new Map<string, { editor: LexicalEditor; cleanup: (() => void)[] }>();

/** ドラッグ中のTodo ID */
let draggedId: string | null = null;
let dragOverId: string | null = null;

/** ユーザー設定 */
let settings: UserSettings = { ...DEFAULT_SETTINGS };
let currentView: ViewMode = 'list';

// ========================
// 起動処理
// ========================

async function init(): Promise<void> {
  if (!browserSupportsWebAuthn()) {
    alert('このブラウザはWebAuthnをサポートしていませんわ');
    return;
  }

  loadSettings();
  applySettings();

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
  closeAllEditors();
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
  // エディタを全部閉じる（再描画するため）
  closeAllEditors();

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
    const errEl = document.createElement('div');
    errEl.className = 'message error show';
    errEl.textContent = (err as Error).message;
    listEl.replaceChildren(errEl);
  }
}

function applyFilter(todos: DecryptedTodo[]): DecryptedTodo[] {
  if (currentFilter === 'active') return todos.filter((t) => !t.completed);
  if (currentFilter === 'completed') return todos.filter((t) => t.completed);
  return todos;
}

const EMPTY_MESSAGES: Record<Filter, string> = {
  active: '未完了のTODOはありませんわ！',
  completed: '完了済みのTODOはありませんわ',
  all: 'TODOがありませんわ。追加してみてくださいませ！',
};

// ========================
// 期日ユーティリティ
// ========================

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff === 0) return '今日';
  if (diff === 1) return '明日';
  if (diff === -1) return '昨日';
  if (diff > 0 && diff < 7) return `${diff}日後`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

function createDueDateElement(todo: DecryptedTodo): HTMLElement {
  const container = document.createElement('span');
  container.className = 'todo-date-wrap';

  if (todo.dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = todo.dueDate < today && !todo.completed;
    const isToday = todo.dueDate === today;

    const badge = document.createElement('button');
    badge.className = `todo-due-date${isOverdue ? ' overdue' : isToday ? ' today' : ''}`;
    badge.textContent = formatDueDate(todo.dueDate);
    badge.title = `期日: ${todo.dueDate}（クリックで変更）`;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showDueDatePicker(todo.id, badge, todo.dueDate);
    });
    container.append(badge);
  } else {
    const addBtn = document.createElement('button');
    addBtn.className = 'todo-add-date';
    addBtn.title = '期日を追加';
    addBtn.setAttribute('aria-label', '期日を追加');
    addBtn.textContent = '📅';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDueDatePicker(todo.id, addBtn, undefined);
    });
    container.append(addBtn);
  }

  return container;
}

function showDueDatePicker(todoId: string, anchor: HTMLElement, currentDate: string | undefined): void {
  document.querySelector('.due-date-picker-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'due-date-picker-popup';

  const input = document.createElement('input');
  input.type = 'date';
  input.value = currentDate ?? '';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-ghost btn-sm';
  clearBtn.textContent = '期日を削除';
  clearBtn.style.marginTop = '6px';
  clearBtn.addEventListener('click', () => {
    popup.remove();
    void setDueDate(todoId, null);
  });

  input.addEventListener('change', () => {
    const val = input.value;
    popup.remove();
    if (val) void setDueDate(todoId, val);
  });

  popup.append(input, clearBtn);
  document.body.append(popup);

  const rect = anchor.getBoundingClientRect();
  const popupH = 90;
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > popupH
    ? rect.bottom + window.scrollY + 4
    : rect.top + window.scrollY - popupH - 4;
  popup.style.top = `${top}px`;
  popup.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 200)}px`;

  setTimeout(() => {
    input.focus();
    const closeHandler = (e: MouseEvent): void => {
      if (!popup.contains(e.target as Node)) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

async function setDueDate(id: string, date: string | null): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  try {
    const data = await decryptTodo(todo.encrypted_data, todo.iv);
    const newData: TodoData = { ...data };
    if (date) {
      newData.dueDate = date;
    } else {
      delete newData.dueDate;
    }
    const { encrypted_data, iv } = await encryptTodo(newData);
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

// ========================
// Google Calendar連携
// ========================

function openGCalLink(title: string, dueDate: string | undefined): void {
  const params = new URLSearchParams({ text: title });
  if (dueDate) {
    const dateStr = dueDate.replace(/-/g, '');
    const d = new Date(dueDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const nextStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    params.set('dates', `${dateStr}/${nextStr}`);
  }
  window.open(
    `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`,
    '_blank',
    'noopener,noreferrer'
  );
}

// ========================
// ユーザー設定
// ========================

const SETTINGS_KEY = 'wa-todo-settings';

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) as Partial<UserSettings> };
      settings.kanbanColumns = { ...DEFAULT_SETTINGS.kanbanColumns, ...settings.kanbanColumns };
    }
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  currentView = settings.view;
}

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings(): void {
  const root = document.documentElement;
  root.style.setProperty('--color-accent', settings.accentColor);
  root.style.setProperty('--font-size-base', FONT_SIZE_MAP[settings.fontSize]);
  // ビュー切り替えボタンの状態更新
  document.getElementById('view-list')?.classList.toggle('active', currentView === 'list');
  document.getElementById('view-kanban')?.classList.toggle('active', currentView === 'kanban');
}

function setView(view: ViewMode): void {
  currentView = view;
  settings.view = view;
  saveSettings();
  applySettings();
  renderTodos(decryptedCache);
}

function toggleSettingsPanel(): void {
  const panel = document.getElementById('settings-panel')!;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  buildSettingsPanel(panel);
}

function buildSettingsPanel(panel: HTMLElement): void {
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'settings-header';
  const title = document.createElement('span');
  title.textContent = '設定';
  title.className = 'settings-title';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
  header.append(title, closeBtn);
  panel.append(header);

  // 表示モード
  const viewSection = createSettingsSection('表示モード');
  const viewBtns = document.createElement('div');
  viewBtns.className = 'settings-row';
  for (const [v, label] of [['list', '☰ リスト'], ['kanban', '⬛ カンバン']] as const) {
    const btn = document.createElement('button');
    btn.className = `settings-choice${currentView === v ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      setView(v);
      buildSettingsPanel(panel);
    });
    viewBtns.append(btn);
  }
  viewSection.append(viewBtns);
  panel.append(viewSection);

  // カンバン列名
  const colSection = createSettingsSection('カンバン列名');
  for (const status of KANBAN_ORDER) {
    const row = document.createElement('div');
    row.className = 'settings-input-row';
    const lbl = document.createElement('label');
    lbl.className = 'settings-label';
    lbl.textContent = { todo: '未着手', doing: '進行中', done: '完了' }[status];
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = settings.kanbanColumns[status];
    inp.className = 'settings-input';
    inp.addEventListener('change', () => {
      settings.kanbanColumns[status] = inp.value.trim() || DEFAULT_SETTINGS.kanbanColumns[status];
      saveSettings();
      if (currentView === 'kanban') renderTodos(decryptedCache);
    });
    row.append(lbl, inp);
    colSection.append(row);
  }
  panel.append(colSection);

  // アクセントカラー
  const colorSection = createSettingsSection('アクセントカラー');
  const colorRow = document.createElement('div');
  colorRow.className = 'settings-row settings-colors';
  for (const color of ACCENT_PRESETS) {
    const swatch = document.createElement('button');
    swatch.className = `color-swatch${settings.accentColor === color ? ' active' : ''}`;
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      settings.accentColor = color;
      saveSettings();
      applySettings();
      buildSettingsPanel(panel);
    });
    colorRow.append(swatch);
  }
  colorSection.append(colorRow);
  panel.append(colorSection);

  // フォントサイズ
  const fontSection = createSettingsSection('フォントサイズ');
  const fontRow = document.createElement('div');
  fontRow.className = 'settings-row';
  for (const [sz, label] of [['sm', 'S 小'], ['md', 'M 中'], ['lg', 'L 大']] as [UserSettings['fontSize'], string][]) {
    const btn = document.createElement('button');
    btn.className = `settings-choice${settings.fontSize === sz ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      settings.fontSize = sz;
      saveSettings();
      applySettings();
      buildSettingsPanel(panel);
    });
    fontRow.append(btn);
  }
  fontSection.append(fontRow);
  panel.append(fontSection);
}

function createSettingsSection(title: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'settings-section';
  const h = document.createElement('div');
  h.className = 'settings-section-title';
  h.textContent = title;
  section.append(h);
  return section;
}

// ========================
// カンバン
// ========================

function getEffectiveStatus(todo: DecryptedTodo): KanbanStatus {
  if (todo.status) return todo.status;
  return todo.completed ? 'done' : 'todo';
}

function renderKanban(todos: DecryptedTodo[], container: HTMLElement): void {
  container.className = 'kanban-board';

  const columns = KANBAN_ORDER.map((status) => {
    const col = document.createElement('div');
    col.className = 'kanban-col';
    col.dataset.status = status;

    const header = document.createElement('div');
    header.className = 'kanban-col-header';
    const nameEl = document.createElement('span');
    nameEl.textContent = settings.kanbanColumns[status];
    const countEl = document.createElement('span');
    const colTodos = todos.filter((t) => getEffectiveStatus(t) === status);
    countEl.textContent = String(colTodos.length);
    countEl.className = 'kanban-col-count';
    header.append(nameEl, countEl);

    const body = document.createElement('div');
    body.className = 'kanban-col-body';
    body.dataset.status = status;

    colTodos.forEach((todo) => body.append(renderKanbanCard(todo)));

    // + 追加ボタン（未着手列のみ）
    if (status === 'todo') {
      const addBtn = document.createElement('button');
      addBtn.className = 'kanban-add-btn';
      addBtn.textContent = '+ TODO追加';
      addBtn.addEventListener('click', () => {
        document.getElementById('new-todo-input')?.focus();
        document.getElementById('todo-section')?.scrollIntoView({ behavior: 'smooth' });
      });
      body.append(addBtn);
    }

    col.append(header, body);
    return col;
  });

  container.replaceChildren(...columns);
  setupKanbanDnD(container);
}

function renderKanbanCard(todo: DecryptedTodo): HTMLElement {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.dataset.id = todo.id;
  card.draggable = true;

  // ヘッダー行: 優先度 + タイトル
  const cardHeader = document.createElement('div');
  cardHeader.className = 'kanban-card-header';

  const priority = todo.priority ?? 'medium';
  const pBadge = document.createElement('span');
  pBadge.className = `todo-priority priority-${priority}`;
  pBadge.textContent = PRIORITY_LABEL[priority];

  const titleEl = document.createElement('span');
  titleEl.className = 'kanban-card-title';
  titleEl.textContent = todo.title;
  titleEl.title = 'ダブルクリックで編集';
  titleEl.addEventListener('dblclick', () => startEditTodo(todo.id, todo.title));

  cardHeader.append(pBadge, titleEl);

  // フッター行: 期日 + GCal + メモ + 削除
  const cardFooter = document.createElement('div');
  cardFooter.className = 'kanban-card-footer';

  if (todo.dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = todo.dueDate < today && !todo.completed;
    const badge = document.createElement('span');
    badge.className = `todo-due-date${isOverdue ? ' overdue' : todo.dueDate === today ? ' today' : ''}`;
    badge.textContent = formatDueDate(todo.dueDate);
    cardFooter.append(badge);
  }

  const gcalBtn = document.createElement('button');
  gcalBtn.className = 'todo-gcal-btn';
  gcalBtn.title = 'Google Calendarに追加';
  gcalBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 3h-1V1h-2v2H8V1H6v2H5C3.9 3 3 3.9 3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 19V8h14v11H5zm2-9h5v5H7z"/></svg>';
  gcalBtn.addEventListener('click', () => openGCalLink(todo.title, todo.dueDate));

  const notesBtn = document.createElement('button');
  notesBtn.className = `todo-notes-btn${todo.notes ? ' has-notes' : ''}`;
  notesBtn.title = todo.notes ? 'メモを編集' : 'メモを追加';
  notesBtn.textContent = '📝';
  notesBtn.addEventListener('click', () => toggleNotesPanel(todo.id, card, todo.notes));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger';
  deleteBtn.title = '削除';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => { void deleteTodo(todo.id); });

  cardFooter.append(gcalBtn, notesBtn, deleteBtn);
  card.append(cardHeader, cardFooter);
  return card;
}

let kanbanDraggedId: string | null = null;

function setupKanbanDnD(board: HTMLElement): void {
  board.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.kanban-card');
    if (!card) return;
    kanbanDraggedId = card.dataset.id ?? null;
    card.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    const col = (e.target as HTMLElement).closest<HTMLElement>('.kanban-col-body');
    if (!col) return;
    board.querySelectorAll('.kanban-col-body.drag-over').forEach((el) => el.classList.remove('drag-over'));
    col.classList.add('drag-over');
  });

  board.addEventListener('dragleave', (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>('.kanban-col-body');
    if (col && !col.contains(e.relatedTarget as Node)) col.classList.remove('drag-over');
  });

  board.addEventListener('drop', (e) => {
    e.preventDefault();
    board.querySelectorAll('.dragging, .drag-over').forEach((el) => el.classList.remove('dragging', 'drag-over'));
    const col = (e.target as HTMLElement).closest<HTMLElement>('.kanban-col-body');
    const newStatus = col?.dataset.status as KanbanStatus | undefined;
    const id = kanbanDraggedId;
    kanbanDraggedId = null;
    if (!id || !newStatus) return;
    void moveToKanbanColumn(id, newStatus);
  });

  board.addEventListener('dragend', () => {
    board.querySelectorAll('.dragging, .drag-over').forEach((el) => el.classList.remove('dragging', 'drag-over'));
    kanbanDraggedId = null;
  });
}

async function moveToKanbanColumn(id: string, newStatus: KanbanStatus): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  try {
    const data = await decryptTodo(todo.encrypted_data, todo.iv);
    const newData: TodoData = {
      ...data,
      status: newStatus,
      completed: newStatus === 'done',
    };
    const { encrypted_data, iv } = await encryptTodo(newData);
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_data, iv }),
    });
    if (!res.ok) throw new Error('移動に失敗しましたわ');
    await loadTodos();
  } catch (err: unknown) {
    alert((err as Error).message);
  }
}

// ========================
// Lexicalメモエディタ
// ========================

function closeAllEditors(): void {
  for (const [, entry] of openEditors) {
    for (const c of entry.cleanup) c();
    entry.editor.setRootElement(null);
  }
  openEditors.clear();
}

function closeEditorForTodo(todoId: string): void {
  const entry = openEditors.get(todoId);
  if (!entry) return;
  for (const c of entry.cleanup) c();
  entry.editor.setRootElement(null);
  openEditors.delete(todoId);
}

function toggleNotesPanel(todoId: string, wrapper: HTMLElement, currentNotes: string | undefined): void {
  const existing = wrapper.querySelector('.todo-notes-panel');
  if (existing) {
    closeEditorForTodo(todoId);
    existing.remove();
    return;
  }
  openNotesPanel(todoId, wrapper, currentNotes);
}

function openNotesPanel(todoId: string, wrapper: HTMLElement, initialNotes: string | undefined): void {
  closeEditorForTodo(todoId);

  const panel = document.createElement('div');
  panel.className = 'todo-notes-panel';

  // ツールバー
  const toolbar = document.createElement('div');
  toolbar.className = 'lexical-toolbar';

  const toolbarDefs: { label: string; title: string; action: (ed: LexicalEditor) => void }[] = [
    { label: 'B', title: '太字 (Ctrl+B)', action: (ed) => ed.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold') },
    { label: 'I', title: 'イタリック (Ctrl+I)', action: (ed) => ed.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic') },
    { label: 'S', title: '取り消し線', action: (ed) => ed.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough') },
    { label: '<>', title: 'コード', action: (ed) => ed.dispatchCommand(FORMAT_TEXT_COMMAND, 'code') },
    { label: '• リスト', title: '箇条書き', action: (ed) => ed.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) },
    { label: '1. リスト', title: '番号付きリスト', action: (ed) => ed.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) },
  ];

  const toolbarBtnEls: HTMLButtonElement[] = [];
  for (const def of toolbarDefs) {
    const btn = document.createElement('button');
    btn.className = 'lexical-toolbar-btn';
    btn.textContent = def.label;
    btn.title = def.title;
    btn.type = 'button';
    toolbarBtnEls.push(btn);
    toolbar.append(btn);
  }

  const sep = document.createElement('span');
  sep.className = 'lexical-toolbar-sep';
  toolbar.append(sep);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lexical-toolbar-btn lexical-close-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = '閉じる';
  closeBtn.type = 'button';
  toolbar.append(closeBtn);

  // エディタ領域
  const editorEl = document.createElement('div');
  editorEl.className = 'lexical-editor';
  editorEl.setAttribute('spellcheck', 'false');

  panel.append(toolbar, editorEl);
  wrapper.append(panel);

  // Lexicalエディタ生成
  const editor = createEditor({
    namespace: `todo-notes-${todoId}`,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    theme: {
      paragraph: 'lp',
      heading: { h1: 'lh1', h2: 'lh2' },
      text: { bold: 'lb', italic: 'li', strikethrough: 'ls', code: 'lc' },
      list: { ul: 'lul', ol: 'lol', listitem: 'lli', nested: { listitem: 'lli-nested' } },
      quote: 'lq',
    },
    onError: (err) => { console.error('Lexical error:', err); },
  });

  editor.setRootElement(editorEl);

  const unregRich = registerRichText(editor);
  const unregHistory = registerHistory(editor, createEmptyHistoryState(), 300);
  const unregList = registerList(editor);

  // 初期ステートを読み込む
  if (initialNotes) {
    try {
      const state = editor.parseEditorState(initialNotes);
      editor.setEditorState(state);
    } catch {
      // 不正なステートは無視
    }
  }

  // ツールバーボタンをエディタと接続
  for (let i = 0; i < toolbarDefs.length; i++) {
    const def = toolbarDefs[i];
    const btn = toolbarBtnEls[i];
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // エディタのfocusを維持
      def.action(editor);
    });
  }

  closeBtn.addEventListener('click', () => {
    closeEditorForTodo(todoId);
    panel.remove();
  });

  // 自動保存（800ms debounce）
  let saveTimeout: number | null = null;
  const unregUpdate = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
    if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
    if (saveTimeout !== null) clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
      const json = JSON.stringify(editorState.toJSON());
      void saveNotes(todoId, json);
    }, 800);
  });

  openEditors.set(todoId, {
    editor,
    cleanup: [
      unregRich,
      unregHistory,
      unregList,
      unregUpdate,
      () => { if (saveTimeout !== null) clearTimeout(saveTimeout); },
    ],
  });

  // フォーカスを当てる
  editor.focus();
}

async function saveNotes(id: string, notesJson: string): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  try {
    const data = await decryptTodo(todo.encrypted_data, todo.iv);
    const { encrypted_data, iv } = await encryptTodo({ ...data, notes: notesJson });
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_data, iv }),
    });
    if (!res.ok) return;
    // キャッシュのみ更新（フルリロード不要）
    const cached = todosCache.find((t) => t.id === id);
    if (cached) { cached.encrypted_data = encrypted_data; cached.iv = iv; }
    const dec = decryptedCache.find((t) => t.id === id);
    if (dec) { dec.notes = notesJson; dec.encrypted_data = encrypted_data; dec.iv = iv; }
  } catch (err) {
    console.error('メモ保存エラー:', err);
  }
}

// ========================
// ドラッグ＆ドロップ
// ========================

function setupDragAndDrop(listEl: HTMLElement): void {
  listEl.addEventListener('dragstart', (e) => {
    const handle = (e.target as HTMLElement).closest('.drag-handle');
    if (!handle) { e.preventDefault(); return; }
    const wrapper = (e.target as HTMLElement).closest<HTMLElement>('.todo-wrapper');
    if (!wrapper) return;
    draggedId = wrapper.dataset.id ?? null;
    wrapper.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId ?? '');
    }
  });

  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const wrapper = (e.target as HTMLElement).closest<HTMLElement>('.todo-wrapper');
    if (!wrapper || wrapper.dataset.id === draggedId) return;
    listEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    wrapper.classList.add('drag-over');
    dragOverId = wrapper.dataset.id ?? null;
  });

  listEl.addEventListener('dragleave', (e) => {
    const wrapper = (e.target as HTMLElement).closest<HTMLElement>('.todo-wrapper');
    if (wrapper && !wrapper.contains(e.relatedTarget as Node)) {
      wrapper.classList.remove('drag-over');
    }
  });

  listEl.addEventListener('drop', (e) => {
    e.preventDefault();
    listEl.querySelectorAll('.dragging, .drag-over').forEach((el) => {
      el.classList.remove('dragging', 'drag-over');
    });
    void handleDrop();
  });

  listEl.addEventListener('dragend', () => {
    listEl.querySelectorAll('.dragging, .drag-over').forEach((el) => {
      el.classList.remove('dragging', 'drag-over');
    });
    draggedId = null;
    dragOverId = null;
  });
}

async function handleDrop(): Promise<void> {
  const fromId = draggedId;
  const toId = dragOverId;
  draggedId = null;
  dragOverId = null;

  if (!fromId || !toId || fromId === toId) return;

  const allIds = decryptedCache.map((t) => t.id);
  const fromIdx = allIds.indexOf(fromId);
  let toIdx = allIds.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return;

  // 楽観的更新
  const newIds = [...allIds];
  newIds.splice(fromIdx, 1);
  if (fromIdx < toIdx) toIdx--;
  newIds.splice(toIdx, 0, fromId);

  const idMap = new Map(decryptedCache.map((t) => [t.id, t]));
  decryptedCache = newIds.map((id) => idMap.get(id)!).filter(Boolean);
  const encIdMap = new Map(todosCache.map((t) => [t.id, t]));
  todosCache = newIds.map((id) => encIdMap.get(id)!).filter(Boolean);
  renderTodos(decryptedCache);

  try {
    const res = await fetch('/api/todos/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: newIds }),
    });
    if (!res.ok) throw new Error('並び替えに失敗しましたわ');
  } catch (err: unknown) {
    alert((err as Error).message);
    await loadTodos();
  }
}

// ========================
// TODO描画
// ========================

function renderTodoItem(todo: DecryptedTodo): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'todo-wrapper';
  wrapper.dataset.id = todo.id;
  wrapper.draggable = true;

  const item = document.createElement('div');
  item.className = `todo-item${todo.completed ? ' completed' : ''}`;
  item.dataset.id = todo.id;

  // ドラッグハンドル
  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.setAttribute('aria-hidden', 'true');
  dragHandle.textContent = '⠿';
  dragHandle.title = 'ドラッグで並び替え';

  // チェックボックス
  const checkbox = document.createElement('button');
  checkbox.className = 'todo-checkbox';
  checkbox.title = todo.completed ? '未完了に戻す' : '完了にする';
  checkbox.textContent = todo.completed ? '✓' : '';
  checkbox.addEventListener('click', () => { void toggleTodo(todo.id, !todo.completed); });

  // 優先度バッジ
  const priority = todo.priority ?? 'medium';
  const priorityBtn = document.createElement('button');
  priorityBtn.className = `todo-priority priority-${priority}`;
  priorityBtn.title = PRIORITY_TITLE[priority];
  priorityBtn.textContent = PRIORITY_LABEL[priority];
  priorityBtn.addEventListener('click', () => { void cyclePriority(todo.id, priority); });

  // タイトル
  const titleEl = document.createElement('span');
  titleEl.className = 'todo-title';
  titleEl.textContent = todo.title;
  titleEl.title = 'ダブルクリックで編集';
  titleEl.addEventListener('dblclick', () => startEditTodo(todo.id, todo.title));

  // 期日バッジ
  const dueDateEl = createDueDateElement(todo);

  // Google Calendarボタン
  const gcalBtn = document.createElement('button');
  gcalBtn.className = 'todo-gcal-btn';
  gcalBtn.title = 'Google Calendarに追加';
  gcalBtn.setAttribute('aria-label', 'Google Calendarに追加');
  gcalBtn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M19 3h-1V1h-2v2H8V1H6v2H5C3.9 3 3 3.9 3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z' +
    'M5 19V8h14v11H5zm2-9h5v5H7z"/></svg>';
  gcalBtn.addEventListener('click', () => openGCalLink(todo.title, todo.dueDate));

  // メモボタン
  const notesBtn = document.createElement('button');
  notesBtn.className = `todo-notes-btn${todo.notes ? ' has-notes' : ''}`;
  notesBtn.title = todo.notes ? 'メモを編集' : 'メモを追加';
  notesBtn.setAttribute('aria-label', todo.notes ? 'メモを編集' : 'メモを追加');
  notesBtn.textContent = '📝';
  notesBtn.addEventListener('click', () => toggleNotesPanel(todo.id, wrapper, todo.notes));

  // 削除ボタン
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger';
  deleteBtn.title = '削除';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => { void deleteTodo(todo.id); });

  item.append(dragHandle, checkbox, priorityBtn, titleEl, dueDateEl, gcalBtn, notesBtn, deleteBtn);
  wrapper.append(item);
  return wrapper;
}

function renderTodos(todos: DecryptedTodo[]): void {
  const listEl = document.getElementById('todo-list')!;
  const countEl = document.getElementById('todo-count')!;
  const clearWrap = document.getElementById('clear-completed-wrap')!;

  const done = todos.filter((t) => t.completed).length;
  countEl.textContent = todos.length === 0 ? '' : `${done} / ${todos.length} 完了`;
  clearWrap.style.display = done > 0 && currentView === 'list' ? '' : 'none';

  if (currentView === 'kanban') {
    renderKanban(todos, listEl);
    return;
  }

  const filtered = applyFilter(todos);

  if (filtered.length === 0) {
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '📝';
    const msg = document.createElement('p');
    msg.textContent = EMPTY_MESSAGES[currentFilter];
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.append(icon, msg);
    listEl.replaceChildren(empty);
    return;
  }

  listEl.replaceChildren(...filtered.map(renderTodoItem));
  setupDragAndDrop(listEl);
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

async function cyclePriority(id: string, current: Priority): Promise<void> {
  const todo = todosCache.find((t) => t.id === id);
  if (!todo) return;
  try {
    const data = await decryptTodo(todo.encrypted_data, todo.iv);
    const { encrypted_data, iv } = await encryptTodo({ ...data, priority: PRIORITY_NEXT[current] });
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
      completedIds.map(async (id) => {
        const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`削除に失敗しましたわ (${id})`);
      })
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
    setView: (view: ViewMode) => void;
    toggleSettingsPanel: () => void;
  }
}

window.switchTab = switchTab;
window.loginHandler = doLogin;
window.registerHandler = doRegister;
window.unlockHandler = doUnlock;
window.addTodoHandler = addTodo;
window.setFilter = setFilter;
window.clearCompletedHandler = clearCompleted;
window.showAuthFromLP = showAuthCard;
window.showLP = showLP;
window.showPrivacyPolicy = showPrivacyPolicy;
window.hidePrivacyPolicy = hidePrivacyPolicy;
window.setView = setView;
window.toggleSettingsPanel = toggleSettingsPanel;

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
