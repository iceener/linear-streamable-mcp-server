import type { UnifiedConfig } from '../../shared/config/env.js';
import { createEncryptor } from '../../shared/crypto/aes-gcm.js';
import type { TokenStore } from '../../shared/storage/interface.js';
import { KvTokenStore } from '../../shared/storage/kv.js';
import { MemoryTokenStore } from '../../shared/storage/memory.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

interface TokenKvNamespace {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkerStorageEnv {
  TOKENS?: TokenKvNamespace;
  RS_TOKENS_ENC_KEY?: string;
}

/** Create the isolate-scoped store while preserving existing KV keys and values. */
export function initializeWorkerTokenStore(
  env: WorkerStorageEnv,
  config: UnifiedConfig,
): TokenStore | undefined {
  if (!env.TOKENS) {
    logger.error('worker_storage', {
      message: 'No TOKENS KV namespace bound',
    });
    return undefined;
  }

  let encrypt: (value: string) => Promise<string>;
  let decrypt: (value: string) => Promise<string>;
  if (env.RS_TOKENS_ENC_KEY) {
    const encryptor = createEncryptor(env.RS_TOKENS_ENC_KEY);
    encrypt = encryptor.encrypt;
    decrypt = encryptor.decrypt;
  } else {
    encrypt = async (value) => value;
    decrypt = async (value) => value;
    if (config.NODE_ENV === 'production') {
      logger.warning('worker_storage', {
        message: 'RS_TOKENS_ENC_KEY is not set; OAuth records are unencrypted',
      });
    }
  }

  return new KvTokenStore(env.TOKENS, {
    encrypt,
    decrypt,
    fallback: new MemoryTokenStore(),
  });
}
