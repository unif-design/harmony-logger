function parse(text: string): { sigBytes: number } {
  // encodeURIComponent preserves the source library's rejection of malformed UTF-16.
  return { sigBytes: encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, '_').length };
}

export default { parse };
