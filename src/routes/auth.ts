import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture, Base64URLString } from "@simplewebauthn/server";
import type { Bindings } from "../index";
import { createJwt, requireAuth } from "../middleware/auth";
import { createDb } from "../db/index";
import { generateId, generateBase64URLId } from "../utils";

type Variables = {
  userId: string;
  credentialId: string;
};

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ========================
// 登録: オプション生成
// ========================
const USERNAME_MAX_LEN = 64;
const USERNAME_PATTERN = /^[\w\-.@]+$/u;

function validateUsername(raw: string): { value: string } | { error: string } {
  const value = raw?.trim() ?? "";
  if (!value) return { error: "ユーザー名は必須ですわ" };
  if (value.length > USERNAME_MAX_LEN)
    return { error: `ユーザー名は${USERNAME_MAX_LEN}文字以内にしてくださいませ` };
  if (!USERNAME_PATTERN.test(value)) return { error: "ユーザー名に使えない文字が含まれていますわ" };
  return { value };
}

auth.post("/register/options", async (c) => {
  const { username: rawUsername } = await c.req.json<{ username: string }>();
  const validated = validateUsername(rawUsername);
  if ("error" in validated) return c.json({ error: validated.error }, 400);
  const username = validated.value;

  const db = createDb(c.env);
  await db.cleanupExpiredChallenges();

  const existingUser = await db.findUserByUsername(username);
  const userId = existingUser?.id ?? generateId();

  const existingCreds = existingUser ? await db.findCredentialsByUserId(existingUser.id) : [];
  const excludeCredentials: { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[] =
    existingCreds.map((cred) => ({
      id: cred.id as Base64URLString,
      transports: cred.transports
        ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    }));

  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: username,
    userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    extensions: {
      // @ts-expect-error PRF型定義の回避
      prf: {},
    },
  });

  await db.createChallenge({
    id: generateId(),
    challenge: options.challenge,
    userId,
    type: "registration",
  });

  const prfSalt = generateBase64URLId();
  return c.json({ options, userId, prfSalt });
});

// ========================
// 登録: 検証・保存
// ========================
auth.post("/register/verify", async (c) => {
  const body = await c.req.json<{
    username: string;
    userId: string;
    prfSalt: string;
    prfCapable: boolean;
    credential: Record<string, unknown>;
  }>();
  const { username, userId, prfSalt, prfCapable, credential } = body;

  const db = createDb(c.env);

  // 既存ユーザーの場合はDBから正規のuserIdを取得し、クライアント送信値を無視する
  // （攻撃者が被害者のuserIdを使って認証器を追加する攻撃を防ぐ）
  const existingUserByName = await db.findUserByUsername(username);
  const authorizedUserId = existingUserByName?.id ?? userId;

  const challengeRow = await db.findLatestChallenge(authorizedUserId, "registration");
  if (!challengeRow) return c.json({ error: "チャレンジが見つからないか期限切れですわ" }, 400);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential as unknown as Parameters<
        typeof verifyRegistrationResponse
      >[0]["response"],
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    });
  } catch {
    return c.json({ error: "登録検証に失敗しましたわ" }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "登録が検証できませんでしたわ" }, 400);
  }

  const {
    credential: cred,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo;

  // authorizedUserId を使う（新規ユーザーでもクライアント送信 userId を信用しない）
  await db.createUserIfNotExists(authorizedUserId, username);

  const user = await db.findUserByUsername(username);
  if (!user) return c.json({ error: "ユーザーの作成に失敗しましたわ" }, 500);

  await db.createCredential({
    id: cred.id,
    userId: user.id,
    publicKey: cred.publicKey,
    counter: cred.counter,
    transports: cred.transports ? JSON.stringify(cred.transports) : null,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    prfCapable,
  });

  await db.createPrfSalt(cred.id, prfSalt);
  await db.deleteRegistrationChallenges(authorizedUserId);

  const token = await createJwt({ userId: user.id, credentialId: cred.id }, c.env.JWT_SECRET);
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: c.env.RP_ORIGIN.startsWith("https"),
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ verified: true, prfCapable });
});

// ========================
// 認証: オプション生成
// ========================
auth.post("/login/options", async (c) => {
  const { username } = await c.req.json<{ username?: string }>();

  const db = createDb(c.env);
  await db.cleanupExpiredChallenges();

  let allowCredentials: { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[] = [];
  let userId: string | null = null;
  const prfSalts: Record<string, string> = {};

  if (username) {
    const validated = validateUsername(username);
    if ("error" in validated) return c.json({ error: validated.error }, 400);
    const user = await db.findUserByUsername(validated.value);
    // 存在しないユーザーも 200 を返しユーザー名列挙を防ぐ
    if (!user) {
      const dummyOptions = await generateAuthenticationOptions({
        rpID: c.env.RP_ID,
        allowCredentials: [],
        userVerification: "required",
      });
      await db.createChallenge({
        id: generateId(),
        challenge: dummyOptions.challenge,
        userId: null,
        type: "authentication",
      });
      return c.json({ options: dummyOptions, prfSalts: {} });
    }

    userId = user.id;
    const creds = await db.findCredentialsWithSaltByUserId(userId);

    allowCredentials = creds.map((cred) => ({
      id: cred.id as Base64URLString,
      transports: cred.transports
        ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    }));
    for (const cred of creds) {
      if (cred.salt) prfSalts[cred.id] = cred.salt;
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    allowCredentials,
    userVerification: "required",
  });

  await db.createChallenge({
    id: generateId(),
    challenge: options.challenge,
    userId,
    type: "authentication",
  });

  return c.json({ options, prfSalts });
});

// ========================
// 認証: 検証・セッション発行
// ========================
auth.post("/login/verify", async (c) => {
  const credential = await c.req.json<Record<string, unknown>>();
  const credentialId = credential.id as string;

  const db = createDb(c.env);

  const storedCred = await db.findCredentialById(credentialId);
  if (!storedCred) return c.json({ error: "クレデンシャルが見つかりませんわ" }, 404);

  // クレデンシャルのユーザーに紐付いたチャレンジのみを取得（並行ログイン時の混線を防ぐ）
  const challengeRow = await db.findLatestChallenge(storedCred.user_id, "authentication");
  if (!challengeRow) return c.json({ error: "チャレンジが見つからないか期限切れですわ" }, 400);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential as unknown as Parameters<
        typeof verifyAuthenticationResponse
      >[0]["response"],
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      credential: {
        id: storedCred.id as Base64URLString,
        publicKey: storedCred.public_key as Uint8Array<ArrayBuffer>,
        counter: storedCred.counter,
        transports: storedCred.transports
          ? (JSON.parse(storedCred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return c.json({ error: "認証検証に失敗しましたわ" }, 400);
  }

  if (!verification.verified) return c.json({ error: "認証が検証できませんでしたわ" }, 400);

  await db.updateCredentialCounter(credentialId, verification.authenticationInfo.newCounter);
  // 特定のチャレンジ値で削除（他ユーザーのチャレンジを巻き込まない）
  await db.deleteAuthChallengeByValue(challengeRow.challenge);

  const token = await createJwt({ userId: storedCred.user_id, credentialId }, c.env.JWT_SECRET);
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: c.env.RP_ORIGIN.startsWith("https"),
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ verified: true });
});

// ========================
// セッション確認
// ========================
auth.get("/me", requireAuth(), async (c) => {
  const userId = c.get("userId");
  const db = createDb(c.env);

  const user = await db.findUserById(userId);
  if (!user) return c.json({ error: "ユーザーが見つかりませんわ" }, 404);

  return c.json({
    id: user.id,
    username: user.username,
    createdAt: user.created_at,
    credentialCount: user.credentialCount,
  });
});

// ========================
// ログアウト
// ========================
auth.post("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});

export default auth;
