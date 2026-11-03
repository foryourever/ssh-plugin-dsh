#!/usr/bin/env python3
"""Download the pinned official backend using only Python's standard library.

Invoked explicitly by setup-backend.mjs; never by an npm lifecycle hook.
Every range and the complete archive digest are checked before extraction.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
HEADERS = {"User-Agent": "dbx-ssh-backend-setup", "Accept-Encoding": "identity"}


def request(url, **kwargs):
    return urllib.request.urlopen(urllib.request.Request(url, **kwargs), timeout=90)


def resolve_asset(lock, asset):
    # API redirect avoids stale cached GitHub download redirects.
    api = "https://api.github.com/repos/{}/releases/assets/{}?download={}".format(
        lock["repository"], asset["id"], time.time_ns())
    try:
        with request(api, headers={**HEADERS, "Accept": "application/octet-stream"}, method="HEAD") as response:
            if response.headers.get("Content-Type", "").startswith("application/json"):
                raise RuntimeError("GitHub returned metadata instead of a release asset")
            return response.url
    except Exception as error:
        print("API redirect unavailable ({}); trying official release URL".format(error), flush=True)
        url = "https://github.com/{}/releases/download/{}/{}".format(
            lock["repository"], lock["tag"], asset["name"])
        with request(url, headers=HEADERS, method="HEAD") as response:
            return response.url


def download(url, asset, destination, workers):
    size = asset["size"]
    chunk_size = 512 * 1024
    ranges = [(start, min(start + chunk_size, size) - 1) for start in range(0, size, chunk_size)]

    def fetch(bounds):
        start, end = bounds
        expected_range = "bytes {}-{}/{}".format(start, end, size)
        for attempt in range(4):
            try:
                with request(url, headers={**HEADERS, "Range": "bytes={}-{}".format(start, end)}) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                        raise RuntimeError("Invalid range response: status {}, Content-Range {!r}; expected {!r}".format(
                            response.status, response.headers.get("Content-Range"), expected_range))
                    data = response.read(end - start + 2)
                    if len(data) != end - start + 1:
                        raise RuntimeError("Incomplete or oversized range {}-{}".format(start, end))
                return start, data
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)

    with destination.open("wb") as output:
        output.truncate(size)
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(fetch, bounds) for bounds in ranges]
            for future in concurrent.futures.as_completed(futures):
                start, data = future.result()
                output.seek(start)
                output.write(data)
                completed += len(data)
                print("Downloaded {:,}/{:,} bytes ({:.0%})".format(completed, size, completed / size), flush=True)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    if digest != asset["sha256"]:
        raise RuntimeError("Archive SHA256 mismatch: {} (expected {})".format(digest, asset["sha256"]))
    print("Verified archive SHA256: " + digest, flush=True)


def install(archive, target_platform):
    executable = "dbx-plugin-ssh.exe" if target_platform.startswith("win32-") else "dbx-plugin-ssh"
    target = ROOT / "bin" / executable
    target.parent.mkdir(exist_ok=True)
    # Read just the backend member; never extract archive-supplied paths.
    with zipfile.ZipFile(archive) as bundle:
        archive_platform = target_platform.replace("win32-", "windows-", 1)
        candidates = [entry for entry in bundle.infolist()
                      if entry.filename in ("bin/{}/{}".format(archive_platform, executable),
                                            "bin/" + executable, executable)]
        if len(candidates) != 1:
            raise RuntimeError("Expected exactly one backend archive member; found {}. Members: {}".format(
                len(candidates), ", ".join(bundle.namelist()[:30])))
        entry = candidates[0]
        if stat.S_ISLNK(entry.external_attr >> 16) or entry.file_size > 256 * 1024 * 1024:
            raise RuntimeError("Invalid backend archive member")
        fd, temporary = tempfile.mkstemp(prefix=".backend-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as output, bundle.open(entry) as source:
                shutil.copyfileobj(source, output)
            os.chmod(temporary, 0o755)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print("Installed {} ({:,} bytes)".format(target, target.stat().st_size), flush=True)


def main():
    architecture = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine(), platform.machine())
    system = {"Darwin": "darwin", "Linux": "linux", "Windows": "win32"}.get(platform.system(), platform.system().lower())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", default=system + "-" + architecture)
    parser.add_argument("--workers", type=int, default=12, help="parallel validated HTTP ranges (1-32)")
    arguments = parser.parse_args()
    if not 1 <= arguments.workers <= 32:
        parser.error("--workers must be between 1 and 32")
    lock = json.loads((ROOT / "upstream-release-lock.json").read_text())
    asset = lock["assets"].get(arguments.platform)
    if asset is None:
        parser.error("Unsupported platform {}; supported: {}".format(arguments.platform, ", ".join(lock["assets"])))
    print("Downloading official {} backend for {}".format(lock["tag"], arguments.platform), flush=True)
    with tempfile.TemporaryDirectory(prefix="dbx-backend-") as directory:
        archive = Path(directory) / asset["name"]
        download(resolve_asset(lock, asset), asset, archive, arguments.workers)
        install(archive, arguments.platform)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Backend setup failed: {}".format(error))
