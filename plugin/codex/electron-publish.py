"""Publish validated VM pictures through the role sandbox without following links."""
import os
from pathlib import Path
import shutil
import sys
import uuid

contract, pictures = sys.argv[1:]
directory = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
fd = os.open(".", directory)
run = "electron-" + uuid.uuid4().hex
try:
    for name in (".sz", "evidence", contract):
        try:
            child = os.open(name, directory, dir_fd=fd)
        except FileNotFoundError:
            try:
                os.mkdir(name, mode=0o755, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(name, directory, dir_fd=fd)
        os.close(fd)
        fd = child
    os.mkdir(run, mode=0o755, dir_fd=fd)
    child = os.open(run, directory, dir_fd=fd)
    os.close(fd)
    fd = child
    for picture in sorted(Path(pictures).iterdir()):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        with os.fdopen(os.open(picture.name, flags, 0o644, dir_fd=fd), "wb") as out, picture.open("rb") as src:
            shutil.copyfileobj(src, out)
        print(f".sz/evidence/{contract}/{run}/{picture.name}")
finally:
    os.close(fd)
