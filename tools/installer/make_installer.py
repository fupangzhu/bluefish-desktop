"""Build the single-file Windows installer from the portable zip.

Layout of the produced exe:  [setup-stub.exe][portable zip][int64 zip length]["BLUEFISH-PAYLOAD"]
setup-stub.cs is the self-extractor; compile it first (tools/build-release.ps1 does that):
    csc /nologo /codepage:65001 /target:winexe /win32icon:assets/icon.ico
        /out:dist/setup-stub.exe
        /reference:System.Windows.Forms.dll /reference:System.Drawing.dll
        /reference:System.IO.Compression.FileSystem.dll /reference:System.IO.Compression.dll
        tools/installer/setup-stub.cs

Usage:
    python tools/installer/make_installer.py [--out PATH]
Env:
    BLUEFISH_PYTHON is not used; run with any Python 3.8+ (no third-party packages).
"""
import argparse
import hashlib
import json
import os
import struct

MAGIC = b"BLUEFISH-PAYLOAD"  # 16 bytes, must match setup-stub.cs
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DIST = os.path.join(REPO, "dist")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    version = json.loads(open(os.path.join(REPO, "package.json"), encoding="utf8").read())["version"]
    stub = os.path.join(DIST, "setup-stub.exe")
    payload = os.path.join(DIST, "bluefish-desktop-v%s-windows-x64.zip" % version)
    out = args.out or os.path.join(DIST, "bluefish-setup-v%s.exe" % version)

    for path in (stub, payload):
        if not os.path.isfile(path):
            raise SystemExit("missing %s (build it first, see tools/build-release.ps1)" % path)

    stub_bytes = open(stub, "rb").read()
    with open(payload, "rb") as f:
        zip_bytes = f.read()

    with open(out, "wb") as f:
        f.write(stub_bytes)
        f.write(zip_bytes)
        f.write(struct.pack("<q", len(zip_bytes)))
        f.write(MAGIC)

    digest = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)

    size = os.path.getsize(out)
    print("installer:", out)
    print("stub_bytes:", len(stub_bytes))
    print("payload_bytes:", len(zip_bytes))
    print("installer_MB:", round(size / 1048576, 2))
    print("sha256:", digest.hexdigest())


if __name__ == "__main__":
    main()
