import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';

export default function sha256(text: string): string {
  encodeURIComponent(text);
  const digest = cryptoFramework.createMd('SHA256');
  if (text.length > 0) {
    const bytes = new util.TextEncoder().encodeInto(text);
    if (!bytes) throw new Error('Logger UTF-8 encoding failed');
    digest.updateSync({ data: bytes });
  }
  return Array.from(digest.digestSync().data).map((byte: number): string => byte.toString(16).padStart(2, '0')).join('');
}
