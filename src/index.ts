/**
 * go-easy — Google APIs made easy.
 *
 * @example
 * ```ts
 * import { getAuth } from '@marcfargas/go-easy/auth';
 * import { search, send } from '@marcfargas/go-easy/gmail';
 *
 * const auth = await getAuth('gmail', 'marc@blegal.eu');
 * const results = await search(auth, { query: 'is:unread' });
 * ```
 */

// Auth
export { getAuth, listAccounts, listAllAccounts, clearAuthCache } from './auth.js';
export type { GoogleService } from './auth.js';

// Auth Store
export type {
  GoEasyAccount,
  AccountStore,
  OAuthToken,
  OAuthCredentials,
} from './auth-store.js';

// Scopes
export { SCOPES, ALL_SCOPES, scopeToService } from './scopes.js';

// Safety
export { setSafetyContext, resetSafetyContext, guardOperation } from './safety.js';
export type { SafetyContext, SafetyLevel, OperationInfo } from './safety.js';

// Errors
export {
  GoEasyError,
  AuthError,
  NotFoundError,
  QuotaError,
  SafetyError,
} from './errors.js';

// Service modules (re-exported as namespaces)
import * as gmail from './gmail/index.js';
import * as drive from './drive/index.js';
import * as calendar from './calendar/index.js';

export { gmail, drive, calendar };
