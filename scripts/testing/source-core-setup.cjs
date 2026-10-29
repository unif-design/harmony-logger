Reflect.set(globalThis, '__DEV__', true);

jest.mock('@kit.CryptoArchitectureKit', () => {
  const assert = require('node:assert/strict');
  const { createHash } = require('node:crypto');
  return {
    cryptoFramework: {
      createMd(algorithm) {
        assert.equal(algorithm, 'SHA256');
        const digest = createHash('sha256');
        return {
          updateSync({ data }) { digest.update(data); },
          digestSync() { return { data: new Uint8Array(digest.digest()) }; },
        };
      },
    },
  };
}, { virtual: true });

jest.mock('@kit.ArkTS', () => {
  const { TextEncoder } = require('node:util');
  return {
    util: {
      TextEncoder: class {
        // 鸿蒙 encodeInto 返回字节数组；Node 对应接口是 encode。
        encodeInto(text) { return new TextEncoder().encode(text); }
      },
    },
  };
}, { virtual: true });
