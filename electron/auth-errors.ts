// Human-friendly messages for Microsoft device-code sign-in. No secrets are logged or exposed.
export function friendlyAuthError(error: unknown, step: 'microsoft' | 'minecraft'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed, timed out|expired_token|authorization_expired|code expired/i.test(message)) {
    return step === 'microsoft'
      ? 'Истекло время ожидания Microsoft. Начни вход заново и введи НОВЫЙ код из лаунчера на microsoft.com/link. Если сайт уже подтвердил вход, проверь дату и время Windows, VPN/прокси и соединение с Microsoft.'
      : 'Microsoft подтвердил вход, но проверка Xbox/Minecraft не ответила вовремя. Проверь интернет и повтори попытку.';
  }
  if (/invalid_client|unauthorized_client/i.test(message)) {
    return 'Microsoft отклонил идентификатор приложения, используемый для входа. Это проблема OAuth-настройки лаунчера, а не твоего пароля. Сообщи разработчику, что сервер вернул invalid_client.';
  }
  if (/invalid_grant|bad_verification_code|invalid_verification_code/i.test(message)) {
    return 'Microsoft не принял запрос на получение токена (invalid_grant). Начни вход заново с новым кодом. Если браузер уже показал «Готово!», проблема может быть в ответе OAuth-сервера.';
  }
  if (/slow_down|too_many_requests|429\b/i.test(message)) {
    return 'Сервер Microsoft временно ограничивает запросы. Повтори авторизацию позже.';
  }
  if (/authorization_declined|access_denied|authorization_rejected/i.test(message)) {
    return 'Microsoft не разрешил подключение. Попробуй снова и подтверди вход в браузере.';
  }
  if (/failed to request live\.com device code|network|fetch failed|econnreset|enotfound|etimedout/i.test(message)) {
    return 'Не удалось связаться с Microsoft. Проверь интернет, доступность microsoft.com/link, настройки VPN/прокси и повтори вход.';
  }
  return message || 'Неизвестная ошибка входа через Microsoft.';
}
