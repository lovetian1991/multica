/**
 * Map backend auth errors to user-facing strings. The backend returns raw
 * English messages that are fine for logs but should not surface as-is —
 * we map the known shapes to friendlier copy and fall back to the caller's
 * default for anything unrecognised.
 */
export function mapAuthError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message.toLowerCase();
  if (/invalid|incorrect|wrong/.test(msg)) {
    return "验证码不正确，请检查后重试。";
  }
  if (/expired/.test(msg)) {
    return "验证码已过期，请重新发送。";
  }
  if (/rate.?limit|too many|throttle/.test(msg)) {
    return "尝试次数过多，请稍后再试。";
  }
  if (/network|fetch|timeout|unreachable/.test(msg)) {
    return "无法连接鸿翼灵工，请检查网络后重试。";
  }
  return fallback;
}
