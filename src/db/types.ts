/** DB の共通データ型定義 */

export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface Credential {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  prf_capable: number;
  created_at: string;
}

export interface Challenge {
  id: string;
  challenge: string;
  user_id: string | null;
  type: 'registration' | 'authentication';
  expires_at: string;
}

export interface PrfSaltRow {
  credential_id: string;
  salt: string;
}

export interface CredentialWithSalt extends Credential {
  salt: string | null;
}

export interface Todo {
  id: string;
  user_id: string;
  encrypted_data: string;
  iv: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCredentialData {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string | null;
  deviceType: string;
  backedUp: boolean;
  prfCapable: boolean;
}

export interface CreateChallengeData {
  id: string;
  challenge: string;
  userId: string | null;
  type: 'registration' | 'authentication';
}

export interface TodoUpdate {
  id: string;
  encrypted_data: string;
  iv: string;
}
