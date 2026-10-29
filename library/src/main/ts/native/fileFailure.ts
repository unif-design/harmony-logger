// API 26 CoreFileKit error codes; unknown codes retain the source diagnostic policy.
const fileReasons = new Map<number, string>([
  [13900001, 'permission_denied'],
  [13900002, 'not_found'],
  [13900005, 'io_error'],
  [13900012, 'permission_denied'],
  [13900014, 'storage_busy'],
  [13900025, 'storage_full'],
  [13900027, 'read_only'],
  [13900041, 'storage_full'],
  [13900044, 'network_unreachable'],
]);

export function nativeFileReason(code: string | number | undefined): string | undefined {
  return typeof code === 'number' ? fileReasons.get(code) : undefined;
}
