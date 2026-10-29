const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function createLoader(mocks = {}) {
  const cache = new Map();
  function resolve(file) {
    const full = path.resolve(file);
    for (const candidate of [full, `${full}.ts`, path.join(full, 'index.ts')]) {
      if (Object.hasOwn(mocks, candidate) || (fs.existsSync(candidate) && fs.statSync(candidate).isFile())) return candidate;
    }
    throw new Error(`Missing test module: ${full}`);
  }
  function load(file) {
    const full = resolve(file);
    if (Object.hasOwn(mocks, full)) return mocks[full];
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} };
    cache.set(full, module);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: full,
    }).outputText;
    const localRequire = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(full), specifier));
      throw new Error(`Unmocked platform import: ${specifier}`);
    };
    new Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, full, path.dirname(full));
    return module.exports;
  }
  return load;
}

module.exports = { createLoader };
