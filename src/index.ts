import { Hono } from 'hono';
import authRoutes from './routes/auth';
import todoRoutes from './routes/todos';

export type Bindings = {
  ASSETS: Fetcher;
  // Turso 接続情報
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  // WebAuthn 設定
  RP_NAME: string;
  RP_ID: string;
  RP_ORIGIN: string;
  // JWT 署名鍵（wrangler secret）
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/api/auth', authRoutes);
app.route('/api/todos', todoRoutes);

export default app;
