/** Microsoft Entra application (public client) ID. This is not a password or token. */
export const MICROSOFT_CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeMicrosoftClientId(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('Microsoft Client ID должен быть строкой UUID.');
  const id = value.trim();
  if (!id) return '';
  if (!MICROSOFT_CLIENT_ID_RE.test(id)) {
    throw new Error('Microsoft Client ID: введи идентификатор приложения в формате UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx), без секретов.');
  }
  return id.toLowerCase();
}

export interface MicrosoftDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  message: string;
}
type RawDeviceCode = {
  userCode?: unknown;
  user_code?: unknown;
  verificationUri?: unknown;
  verification_uri?: unknown;
  expiresOn?: unknown;
  expires_in?: unknown;
  expiresIn?: unknown;
  message?: unknown;
};
/** Handle prismarine-auth live/sisu and MSAL's different device-code field names. */
export function normalizeDeviceCode(raw: RawDeviceCode, now = Date.now()): MicrosoftDeviceCode | null {
  const userCode = typeof raw.userCode === 'string' ? raw.userCode.trim()
    : typeof raw.user_code === 'string' ? raw.user_code.trim() : '';
  if (!userCode || userCode.length > 80) return null;

  const url = typeof raw.verificationUri === 'string' ? raw.verificationUri
    : typeof raw.verification_uri === 'string' ? raw.verification_uri : '';
  const verificationUri = url || 'https://www.microsoft.com/link';
  if (verificationUri.length > 220) return null;
  try {
    const parsed = new URL(verificationUri);
    if (parsed.protocol !== 'https:' ||
      !['www.microsoft.com', 'microsoft.com', 'login.microsoftonline.com', 'login.live.com'].includes(parsed.hostname)) {
      return null;
    }
  } catch { return null; }

  let expiresAt = NaN;
  if (raw.expiresOn instanceof Date) expiresAt = raw.expiresOn.getTime();
  else if (typeof raw.expiresOn === 'string') expiresAt = Date.parse(raw.expiresOn);
  else if (typeof raw.expiresOn === 'number' && Number.isFinite(raw.expiresOn)) {
    expiresAt = raw.expiresOn > 1e12 ? raw.expiresOn : raw.expiresOn * 1000;
  }
  if (!Number.isFinite(expiresAt)) {
    const seconds = Number(raw.expires_in ?? raw.expiresIn);
    expiresAt = now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000;
  }
  return { userCode, verificationUri, expiresAt, message: typeof raw.message === 'string' ? raw.message.slice(0, 250) : '' };
}
