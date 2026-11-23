"""Boot a disposable offline Mac. The guest can read only the two staged shares."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess as sp
import sys
import threading
import time
import uuid

SHARED = "/private/tmp/sz-input"
OUT = "/tmp/sz-evidence"
TART = "/opt/homebrew/bin/tart"
PER_PICTURE = 16 * 1024 * 1024
TOTAL = 64 * 1024 * 1024


def bounded(argv, limit):
    with sp.Popen(argv, stdout=sp.PIPE) as proc:
        try:
            data = proc.stdout.read(limit + 1)
            if len(data) > limit:
                raise ValueError("guest evidence exceeds the size limit")
            if proc.wait() != 0:
                raise RuntimeError("could not read guest evidence")
            return data
        finally:
            if proc.poll() is None:
                proc.kill()


def pictures(vm, job):
    # Read only a bounded list of flat PNGs. All guest output, including names,
    # is untrusted. Never unpack guest archives or follow a link on the host.
    run = [TART, "exec", vm]
    listing = 'const fs=require("node:fs"); console.log(JSON.stringify(fs.readdirSync(process.argv[1],{withFileTypes:true}).filter(e=>e.isFile() && e.name.endsWith(".png")).map(e=>e.name)))'
    names = json.loads(bounded(run + [f"{SHARED}/runtime/node", "-e", listing, OUT], 32768))
    if not isinstance(names, list) or len(names) > 128:
        raise ValueError("invalid guest evidence list")
    remaining = TOTAL
    for name in names:
        if not isinstance(name, str) or not re.fullmatch(r"[\w-][\w .-]{0,160}\.png", name):
            raise ValueError("invalid guest picture name")
        data = bounded(run + ["/bin/cat", f"{OUT}/{name}"], min(PER_PICTURE, remaining))
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("invalid PNG from guest")
        with (job / "pictures" / name).open("xb") as out:
            out.write(data)
        remaining -= len(data)


def observe(home, job, args):
    vm = "sz-" + uuid.uuid4().hex[:16]
    os.environ.update(TART_HOME=str(home), TART_NO_AUTO_PRUNE="1")
    # The VM sees an Ethernet device with no peer that forwards traffic. The
    # guest agent uses a separate virtualization socket and needs no network.
    nic, isolated = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    with nic, isolated, (home / "sz-electron.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        proc = None
        try:
            sp.run([TART, "clone", "sz-electron-base", vm], check=True, timeout=90)
            cmd = [TART, "run", "--no-graphics", "--no-audio", "--no-usb-accessories", "--no-clipboard",
                   f"--net-fd={nic.fileno()}", f"--dir=project:{job}/project:ro,tag=sz-input",
                   f"--dir=runtime:{job}/runtime:ro,tag=sz-input", vm]
            proc = sp.Popen(cmd, pass_fds=(nic.fileno(),))
            run = [TART, "exec", vm]
            until = time.monotonic() + 180
            while True:
                if proc.poll() is not None:
                    raise RuntimeError(f"local VM exited before login ({proc.returncode})")
                try:
                    ready = sp.run(run + ["/bin/sh", "-c",
                        'test "$(stat -f %Su /dev/console)" = "$(id -un)"'],
                        stderr=sp.DEVNULL, timeout=10)
                except sp.TimeoutExpired:
                    ready = None
                if ready and ready.returncode == 0:
                    break
                if time.monotonic() >= until:
                    raise RuntimeError("local macOS guest did not reach a logged-in desktop")
                time.sleep(1)
            # Some native tools treat absolute paths as URIs. Give the guest a
            # real mount point without spaces so paths from realpath() work too.
            sp.run(run + ["/bin/mkdir", "-p", SHARED, OUT], check=True, timeout=15)
            sp.run(run + ["/usr/bin/sudo", "-n", "/sbin/mount_virtiofs", "sz-input", SHARED], check=True, timeout=20)
            # argv remains opaque to the host and to the guest shell. The
            # project's Node script and Electron children all run inside the VM.
            script = 'cd "$1" || exit; shift; PATH="$1:$PATH"; export PATH; shift; exec /usr/bin/env "$@"'
            result = sp.run(run + ["/bin/sh", "-c", script, "sz", f"{SHARED}/project",
                                   f"{SHARED}/runtime", *args], timeout=600)
            pictures(vm, job)
            return result.returncode
        finally:
            if proc and proc.poll() is None:
                proc.send_signal(signal.SIGINT)
                try:
                    proc.wait(timeout=15)
                except sp.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            if (home / "vms" / vm).exists():
                sp.run([TART, "delete", vm], check=True, timeout=60)


def cancel(*_):
    raise RuntimeError("local VM observation interrupted or timed out")


if __name__ == "__main__":
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
        signal.signal(sig, cancel)
    signal.alarm(1500)
    parent = os.getppid()

    def watch_worker():
        while os.getppid() == parent and parent != 1:
            time.sleep(2)
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=watch_worker, daemon=True).start()
    try:
        sys.exit(observe(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:]))
    except (OSError, ValueError, RuntimeError, sp.SubprocessError) as err:
        sys.exit(f"Local Electron VM: {err}")
