import { vi } from "vitest";
import type { DbAdapter } from "../../db/adapter";
import type { Todo } from "../../db/types";

/** テスト用インメモリ DbAdapter */
export function createMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  const todos: Todo[] = [];

  const base: DbAdapter = {
    findUserByUsername: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue(null),
    createUserIfNotExists: vi.fn().mockResolvedValue(undefined),

    findCredentialsByUserId: vi.fn().mockResolvedValue([]),
    findCredentialsWithSaltByUserId: vi.fn().mockResolvedValue([]),
    findCredentialById: vi.fn().mockResolvedValue(null),
    createCredential: vi.fn().mockResolvedValue(undefined),
    updateCredentialCounter: vi.fn().mockResolvedValue(undefined),

    cleanupExpiredChallenges: vi.fn().mockResolvedValue(undefined),
    createChallenge: vi.fn().mockResolvedValue(undefined),
    findLatestChallenge: vi.fn().mockResolvedValue(null),
    deleteRegistrationChallenges: vi.fn().mockResolvedValue(undefined),
    deleteAuthChallengeByValue: vi.fn().mockResolvedValue(undefined),

    createPrfSalt: vi.fn().mockResolvedValue(undefined),

    findTodosByUserId: vi.fn().mockImplementation(async (userId: string) =>
      todos.filter((t) => t.user_id === userId),
    ),
    findTodoById: vi.fn().mockImplementation(async (id: string, userId: string) =>
      todos.find((t) => t.id === id && t.user_id === userId) ?? null,
    ),
    createTodo: vi.fn().mockImplementation(
      async (id: string, userId: string, encrypted_data: string, iv: string, order_index: number) => {
        const now = new Date().toISOString();
        const todo: Todo = { id, user_id: userId, encrypted_data, iv, order_index, created_at: now, updated_at: now };
        todos.push(todo);
        return todo;
      },
    ),
    getMaxOrderIndex: vi.fn().mockImplementation(async (userId: string) => {
      const userTodos = todos.filter((t) => t.user_id === userId);
      return userTodos.length === 0 ? 0 : Math.max(...userTodos.map((t) => t.order_index)) + 1;
    }),
    updateTodo: vi.fn().mockImplementation(
      async (id: string, userId: string, encrypted_data: string, iv: string) => {
        const todo = todos.find((t) => t.id === id && t.user_id === userId);
        if (todo) { todo.encrypted_data = encrypted_data; todo.iv = iv; }
      },
    ),
    deleteTodo: vi.fn().mockImplementation(async (id: string, userId: string) => {
      const idx = todos.findIndex((t) => t.id === id && t.user_id === userId);
      if (idx === -1) return 0;
      todos.splice(idx, 1);
      return 1;
    }),
    reorderTodos: vi.fn().mockResolvedValue(undefined),
    bulkUpdateTodos: vi.fn().mockResolvedValue(undefined),
  };

  return { ...base, ...overrides };
}
