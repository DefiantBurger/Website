#!/bin/sh
# systemd needs a writable cgroup tree. The container runs with a private cgroup
# namespace, so this is its own subtree, not the host's.
mount -o remount,rw /sys/fs/cgroup
exec /lib/systemd/systemd
