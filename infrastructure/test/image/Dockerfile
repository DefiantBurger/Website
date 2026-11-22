# Close to a GCE Debian 13 image for the startup script: systemd as PID 1, sudo (visudo),
# python3, man-db (which the script removes), and iproute2 (for the firewall test). Unlike
# Docker's Debian image, GCE lets packages start their services during install, so
# policy-rc.d goes.
FROM debian:trixie
RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo man-db procps python3 iproute2 \
    && rm -rf /var/lib/apt/lists/* /usr/sbin/policy-rc.d

# Stand-ins for Google's side: gcloud (secrets, release bucket) and the metadata server's
# guest attributes, reached through --add-host metadata.google.internal:127.0.0.2
# (see metadata-server.path for when it starts).
COPY gcloud /usr/local/bin/gcloud
COPY metadata-server.py fake-cloudflared.py /usr/local/lib/test/
COPY metadata-server.service metadata-server.path /etc/systemd/system/
RUN systemctl enable metadata-server.path
# The guest agent's plugin manager, which apply_changes restarts, and the disabled legacy agent.
COPY google-guest-agent-manager /usr/local/lib/test/
COPY google-guest-agent-manager.service google-guest-agent.service /etc/systemd/system/
RUN ln -s /bin/sleep /usr/local/lib/test/mwlid_extension && systemctl enable google-guest-agent-manager.service
# Answers cloudflared's /ready without a real tunnel; vm.test.sh removes it to test the real one.
COPY fake-cloudflared.conf /etc/systemd/system/cloudflared.service.d/fake.conf
# /proc/sys is read-only in an unprivileged container, which also keeps the host's
# kernel settings safe; this just reports what would be applied.
COPY sysctl /usr/local/sbin/sysctl

COPY init.sh /init.sh
STOPSIGNAL SIGRTMIN+3
CMD ["/init.sh"]
