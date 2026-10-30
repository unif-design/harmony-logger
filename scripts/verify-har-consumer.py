#!/usr/bin/env python3
"""Verify the built Logger HAR and compile the real example without library sources."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def exported_names(source):
    groups = re.findall(r'export\s+(?:type\s+)?\{([^}]+)\}', source)
    names = [name.strip() for group in groups for name in group.split(',') if name.strip()]
    assert names and len(names) == len(set(names)), 'Missing or duplicate public exports'
    return sorted(names)


def main():
    root = Path(__file__).resolve().parents[1]
    artifact = root / 'library/build/default/outputs/default/library.har'
    source_package = json.loads((root / 'library/oh-package.json5').read_text())
    source_provenance = json.loads((root / 'library/src/main/resources/rawfile/logger-provenance.json').read_text())
    with tarfile.open(artifact) as archive:
        def read(name):
            entry = archive.extractfile('package/' + name)
            assert entry is not None, name
            return entry.read()

        package = json.loads(read('oh-package.json5'))
        assert package['name'] == '@unif/harmony-logger'
        assert package['version'] == source_package['version'] == source_provenance['version']
        assert package['dependencies'] == {}
        assert package['types'] == 'Index.d.ts'
        assert sorted(package['oh-exports']) == ['Files.d.ts', 'Index.d.ts']
        assert package['compatibleSdkVersion'] == 26
        assert package['metadata']['byteCodeHar'] is True
        assert len(read('ets/modules.abc')) > 0
        for entry in ['Index', 'Files']:
            declaration = read(entry + '.d.ts').decode()
            assert '/Users/' not in declaration
            assert exported_names(declaration) == exported_names((root / f'library/{entry}.ts').read_text())
        provenance = json.loads(read('src/main/resources/rawfile/logger-provenance.json'))
        assert provenance == source_provenance, 'HAR is stale; rebuild from the checked source'
        for item in provenance['inputs'] + provenance['nativeFiles']:
            # RN 根 barrel 已改写为公开 Index，未使用的 generated/index 不进入 HAR。
            target = 'Index.ts' if item['path'] == 'src/index.ts' else item.get('target', item['path']).removeprefix('library/')
            assert read(target.removesuffix('.ts') + '.d.ts'), target
        for name in ['README.md', 'FORMAT.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md']:
            assert read(name) == (root / 'library' / name).read_bytes(), name
        assert b'ohpm install @unif/harmony-logger' in read('README.md')

    consumer = Path(tempfile.mkdtemp(prefix='unif-logger-har-consumer-'))
    for name in ['AppScope', 'hvigor', 'example']:
        shutil.copytree(root / name, consumer / name,
                        ignore=shutil.ignore_patterns('build', 'oh_modules', 'oh-package-lock.json5', '.hvigor'))
    for name in ['hvigorfile.ts', 'oh-package.json5']:
        shutil.copy2(root / name, consumer / name)
    profile = json.loads((root / 'build-profile.json5').read_text())
    profile['modules'] = [item for item in profile['modules'] if item['name'] == 'example']
    assert len(profile['modules']) == 1
    (consumer / 'build-profile.json5').write_text(json.dumps(profile, indent=2) + '\n')
    (consumer / 'packages').mkdir()
    shutil.copy2(artifact, consumer / 'packages/harmony-logger.har')
    host_manifest = consumer / 'example/oh-package.json5'
    host_package = json.loads(host_manifest.read_text())
    host_package['dependencies'] = {'@unif/harmony-logger': 'file:../packages/harmony-logger.har'}
    host_manifest.write_text(json.dumps(host_package, indent=2) + '\n')
    assert not (consumer / 'library').exists()
    print(f'Isolated example: {consumer}', flush=True)
    print(f'HAR SHA-256: {hashlib.sha256(artifact.read_bytes()).hexdigest()}', flush=True)
    subprocess.run(['devecocli', 'build', '--modules', 'example', '--build-mode', 'debug'], cwd=consumer, check=True)
    hap = consumer / 'example/build/default/outputs/default/example-default-unsigned.hap'
    assert hap.is_file() and hap.stat().st_size > 0
    print(f'Public root and Files entry compiled from HAR: {hap}')
    print('Build evidence only; no device execution, registry installation or publication.')


if __name__ == '__main__':
    main()
