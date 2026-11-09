// Human-friendly messages for Microsoft device-code sign-in. No secrets are logged or exposed.
export function friendlyAuthError(error: unknown, step: 'microsoft' | 'minecraft'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed, timed out|expired_token|authorization_expired|code expired/i.test(message)) {
    return step === 'microsoft'
      ? 'Истекло время ожидания Microsoft. Начни вход заново и введи НОВЫЙ код из лаунчера на microsoft.com/link. Если сайт уже подтвердил вход, проверь дату и время Windows, VPN/прокси и соединение с Microsoft.'
      : 'Microsoft подтвердил вход, но проверка Xbox/Minecraft не ответила вовремя. Проверь интернет и повтори попытку.';
  }
  if (/authorization_declined|access_denied|authorization_rejected/i.test(message)) {
    return 'Microsoft не разрешил подключение. Попробуй снова и подтверди вход в браузере.';
  }
  if (/failed to request live\.com device code|network|fetch failed|econnreset|enotfound|etimedout/i.test(message)) {
    return 'Не удалось связаться с Microsoft. Проверь интернет, доступность microsoft.com/link, настройки VPN/прокси и повтори вход.';
  }
  return message || 'Неизвестная ошибка входа через Microsoft.';
}
