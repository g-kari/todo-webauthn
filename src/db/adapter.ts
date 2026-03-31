import type {
  User,
  Credential,
  CredentialWithSalt,
  Challenge,
  Todo,
  CreateCredentialData,
  CreateChallengeData,
  TodoUpdate,
} from './types';

/**
 * DBアダプターインターフェース
 * D1・Turso など異なるバックエンドを統一的に扱う
 */
export interface DbAdapter {
  // ===== ユーザー =====
  findUserByUsername(username: string): Promise<User | null>;
  findUserById(id: string): Promise<(User & { credentialCount: number }) | null>;
  /** ユーザーが存在しない場合のみ作成する */
  createUserIfNotExists(id: string, username: string): Promise<void>;

  // ===== クレデンシャル =====
  findCredentialsByUserId(userId: string): Promise<Credential[]>;
  findCredentialsWithSaltByUserId(userId: string): Promise<CredentialWithSalt[]>;
  findCredentialById(id: string): Promise<Credential | null>;
  createCredential(data: CreateCredentialData): Promise<void>;
  updateCredentialCounter(id: string, counter: number): Promise<void>;

  // ===== チャレンジ =====
  cleanupExpiredChallenges(): Promise<void>;
  createChallenge(data: CreateChallengeData): Promise<void>;
  findLatestChallenge(
    userId: string | null,
    type: 'registration' | 'authentication'
  ): Promise<Challenge | null>;
  deleteRegistrationChallenges(userId: string): Promise<void>;
  /** 認証済みチャレンジをchallenge値で特定して削除する（他ユーザーのチャレンジを巻き込まない） */
  deleteAuthChallengeByValue(challenge: string): Promise<void>;

  // ===== PRFソルト =====
  createPrfSalt(credentialId: string, salt: string): Promise<void>;

  // ===== TODO =====
  findTodosByUserId(userId: string): Promise<Todo[]>;
  findTodoById(id: string, userId: string): Promise<Todo | null>;
  createTodo(
    id: string,
    userId: string,
    encryptedData: string,
    iv: string,
    orderIndex: number
  ): Promise<Todo | null>;
  getMaxOrderIndex(userId: string): Promise<number>;
  updateTodo(id: string, userId: string, encryptedData: string, iv: string): Promise<void>;
  deleteTodo(id: string, userId: string): Promise<number>;
  reorderTodos(ids: string[], userId: string): Promise<void>;
  bulkUpdateTodos(updates: TodoUpdate[], userId: string): Promise<void>;
}
