export interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  changes: { type: "feat" | "fix" | "security" | "perf" | "refactor"; text: string }[];
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: "1.5",
    date: "2026-04-01",
    title: "セキュリティ強化 + Lexicalエディタ修正",
    changes: [
      {
        type: "fix",
        text: "Lexicalリッチテキストエディタに contenteditable を明示設定し入力不可バグを修正",
      },
      {
        type: "security",
        text: "/todos/bulk エンドポイントにペイロードサイズ・IV長・ID長の検証を追加（未検証データの大量書き込みを防止）",
      },
      { type: "security", text: "querySelector へのCSSセレクター注入を CSS.escape() で防止" },
      {
        type: "fix",
        text: "UTC日付バグ修正: toISOString().slice(0,10) を localDateString() に統一（タイムゾーンによるずれを解消）",
      },
      {
        type: "refactor",
        text: "CSS変数 --color-sunday / --color-saturday を追加しハードコード色を置換",
      },
    ],
  },
  {
    version: "1.4",
    date: "2026-04-01",
    title: "カスタム日付ピッカー + テスト基盤",
    changes: [
      {
        type: "feat",
        text: "日付ピッカーをブラウザデフォルトからサイトデザインに合わせたカスタムカレンダーUIに刷新",
      },
      { type: "feat", text: "Vitest ユニットテスト（認証・TODO API・DBアダプター）42件を追加" },
      { type: "feat", text: "Playwright E2Eテスト: CDP仮想認証器でWebAuthnフルフローを自動検証" },
      { type: "fix", text: "Lexicalノートパネルが楽観的UI更新時に消える問題を差分DOM更新で修正" },
      { type: "refactor", text: "encryptAndSave ヘルパー抽出と syncEncryptedCache 順序バグ修正" },
      { type: "security", text: "ユーザー名列挙対策・入力サイズ制限・innerHTML排除" },
    ],
  },
  {
    version: "1.3",
    date: "2026-03-28",
    title: "カンバンボード + ユーザー設定",
    changes: [
      {
        type: "feat",
        text: "カンバンビュー: 未着手 / 進行中 / 完了の3列。ドラッグ&ドロップでステータス変更",
      },
      {
        type: "feat",
        text: "ユーザー設定: アクセントカラー・フォントサイズ・カンバン列名をカスタマイズ可能",
      },
      { type: "feat", text: "スマートフォンでカンバンの横スクロール対応" },
      { type: "perf", text: "DnDリスナー蓄積・スクロールブロックのパフォーマンス問題を修正" },
    ],
  },
  {
    version: "1.2",
    date: "2026-03-25",
    title: "期日・GCal連携・DnD・Lexicalメモ",
    changes: [
      { type: "feat", text: "期日設定: 本日・翌日・期限超過を色分け表示" },
      {
        type: "feat",
        text: "Google Calendar連携: 期日付きTODOをワンクリックでGCalイベント作成ページへ",
      },
      { type: "feat", text: "ドラッグ&ドロップ並び替え（デスクトップ・スマートフォン対応）" },
      {
        type: "feat",
        text: "Lexicalリッチテキストメモ: TODOごとのノート。太字・イタリック・リスト・引用対応",
      },
      { type: "feat", text: "TODO優先度バッジ（高/中/低）: クリックでサイクル" },
    ],
  },
  {
    version: "1.1",
    date: "2026-03-20",
    title: "PWA対応・UI刷新",
    changes: [
      { type: "feat", text: "PWA対応: ホーム画面への追加、オフラインキャッシュ" },
      { type: "feat", text: "OGP / Twitter Card メタタグ追加" },
      { type: "feat", text: "LP（ランディングページ）追加・全体デザイン刷新" },
      { type: "feat", text: "テキスト検索: 復号済みキャッシュをクライアントサイドで絞り込み" },
      { type: "feat", text: "フィルター: すべて / 未完了 / 完了済みの切り替え" },
      { type: "security", text: "認証チャレンジをユーザー単位で管理し、チャレンジ再利用を防止" },
    ],
  },
  {
    version: "1.0",
    date: "2026-03-15",
    title: "初期リリース",
    changes: [
      { type: "feat", text: "WebAuthn パスキー認証（PRF拡張必須）" },
      {
        type: "feat",
        text: "AES-GCM-256 クライアントサイド暗号化。サーバーはTODOを読めないゼロナレッジ設計",
      },
      { type: "feat", text: "TODO CRUD: 追加・完了切り替え・インライン編集・削除" },
      { type: "feat", text: "Cloudflare Workers + Hono + Turso によるサーバーレス構成" },
      { type: "feat", text: "複数パスキー登録: 全TODOの再暗号化で安全に追加可能" },
    ],
  },
];
