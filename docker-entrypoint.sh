#!/bin/sh
# Renders the nginx and supervisord runtime config, then hands off to supervisord.
# nginx/dashboard.conf, nginx.conf and supervisord.conf name these paths.
set -eu

. /usr/local/lib/stackyard/entrypoint.sh

stackyard_main /run/stackyard /data /icons /proc/net/if_inet6 /proc/sys/net/ipv4/ip_unprivileged_port_start -- "$@"
