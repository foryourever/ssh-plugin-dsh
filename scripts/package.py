#!/usr/bin/env python3
"""Build an npm-compatible tarball without npm's implicit source-file exclusions."""
import gzip
import hashlib
import json
import pathlib
import tarfile
import platform
import sys

root = pathlib.Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'package.json').read_text())
selected = set()
for pattern in manifest['files'] + ['package.json', 'package-lock.json']:
    for candidate in root.glob(pattern):
        if candidate.is_dir():
            candidates = candidate.rglob('*')
        else:
            candidates = [candidate]
        for file in candidates:
            if file.is_symlink():
                raise SystemExit(f'Symlinks cannot be distributed: {file.relative_to(root)}')
            if file.is_file():
                relative = file.relative_to(root)
                if 'node_modules' in relative.parts or any(part in {'.npm-cache', '.git', '__pycache__'} for part in relative.parts):
                    raise SystemExit(f'Unexpected build/cache file: {relative}')
                selected.add(relative.as_posix())
inventory = json.loads((root / 'UPSTREAM.json').read_text())
for entry in inventory['files']:
    filename = 'original/' + entry['path']
    if filename not in selected:
        raise SystemExit(f'Missing original file: {filename}')
    if hashlib.sha256((root / filename).read_bytes()).hexdigest() != entry['sha256']:
        raise SystemExit(f'Changed original file: {filename}')
required = ['client.js', 'index.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json', 'icon.svg']
for filename in required:
    if filename not in selected:
        raise SystemExit(f'Missing runtime resource: {filename}')
platform_name = {'darwin': 'darwin', 'linux': 'linux', 'win32': 'windows'}.get(sys.platform, sys.platform)
architecture = 'arm64' if platform.machine().lower() in {'arm64', 'aarch64'} else 'x64'
platform = f'{platform_name}-{architecture}'
destination = root / 'dist'
destination.mkdir(exist_ok=True)
archive = destination / f'dsh-plugin-ssh-{manifest["version"]}-{platform}.tgz'
with archive.open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as package:
            for filename in sorted(selected):
                file = root / filename
                info = package.gettarinfo(str(file), arcname='package/' + filename)
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mtime = 0
                info.mode = 0o755 if filename.startswith('bin/dbx-plugin-ssh') else 0o644
                with file.open('rb') as source:
                    package.addfile(info, source)
with tarfile.open(archive, 'r:gz') as package:
    names = {entry.name.removeprefix('package/') for entry in package.getmembers() if entry.isfile()}
if names != selected:
    raise SystemExit('Archive file-list verification failed')
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix(archive.suffix + '.sha256')).write_text(f'{checksum}  {archive.name}\n')
report = {'archive': archive.name, 'bytes': archive.stat().st_size, 'sha256': checksum, 'fileCount': len(selected), 'originalFiles': inventory['fileCount'], 'files': sorted(selected)}
(destination / 'package-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'files'}, ensure_ascii=False, indent=2))
