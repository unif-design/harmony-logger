export function isLogFileUri(uri: string): boolean {
  const match = /^file:\/\/([a-z\d_.-]*)(\/[^\s?#\\]+)$/i.exec(uri);
  if (!match) return false;
  if (match[1] && !/^[a-z\d_]+(?:[.-][a-z\d_]+)*$/i.test(match[1])) return false;
  try {
    const path = decodeURIComponent(match[2]);
    return !/[\u0000-\u001f\u007f\\]/.test(path) && !path.split('/').some((part: string): boolean => part === '.' || part === '..');
  } catch {
    return false;
  }
}
