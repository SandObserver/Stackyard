# Both stages are pinned by digest. Change both together.
# This stage stamps the asset URLs. Assets are served immutable for a year, so an
# unstamped tree keeps serving the old file after an upgrade.
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS assets
WORKDIR /src
COPY ui/ ./ui/
COPY scripts/bump-cache-busting.js ./scripts/bump-cache-busting.js
RUN node scripts/bump-cache-busting.js

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

LABEL org.opencontainers.image.title="Stackyard" \
      org.opencontainers.image.description="Self-hosted homelab dashboard" \
      org.opencontainers.image.source="https://github.com/SandObserver/stackyard" \
      org.opencontainers.image.licenses="Apache-2.0"

# No package manager in the runtime image. The check fails the build if a base
# image change makes a path stop matching.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg && \
    if command -v npm || command -v npx || command -v yarn || command -v corepack; then \
      echo "a package manager survived removal; check the base image layout" >&2; exit 1; \
    fi && \
    node -e "process.exit(0)"

# Keep `apk upgrade` first. The base image is pinned by digest and gets no
# security updates without it.
RUN apk upgrade --no-cache && \
    apk add --no-cache nginx supervisor && \
    rm -f /etc/nginx/conf.d/default.conf /etc/nginx/http.d/default.conf && \
    mkdir -p /var/log/nginx /var/log/supervisor /var/lib/nginx /run/nginx && \
    # Users mount volumes here. Owned by node so the API can write config and
    # icons without running as root.
    mkdir -p /data /icons && \
    chown -R node:node /data /icons && \
    # Delete setuptools in the layer that installs it. In a later layer the
    # files stay in this one.
    rm -rf /usr/lib/python3*/site-packages/setuptools \
           /usr/lib/python3*/site-packages/setuptools-*.dist-info \
           /usr/lib/python3*/site-packages/_distutils_hack \
           /usr/lib/python3*/site-packages/distutils-precedence.pth && \
    if python3 -c 'import setuptools' 2>/dev/null; then \
      echo 'setuptools survived removal'; exit 1; \
    fi && \
    supervisord --version

# Alpine nginx reads from http.d/
COPY nginx/dashboard.conf /etc/nginx/http.d/dashboard.conf
COPY nginx/security-headers.conf /etc/nginx/http.d/security-headers.conf
COPY nginx/csp-default.conf /etc/nginx/http.d/csp-default.conf
# Replaced at container start by docker-entrypoint.sh. Present so the config is
# valid at build time.
COPY nginx/realip.conf /etc/nginx/http.d/realip.conf

COPY --from=assets /src/ui/ /usr/share/nginx/html/

# The image mirrors the repository layout. Shared modules keep the same relative
# path in both places.
COPY --chown=node:node api/ /app/api/
COPY --chown=node:node ui/js/link-url.js /app/ui/js/link-url.js
COPY scripts/exit-on-fatal.py /app/scripts/exit-on-fatal.py
# Fails the build if python3 is no longer present. Without it the event listener
# cannot start and no failure is reported.
RUN /usr/bin/python3 -c "import ast,sys; ast.parse(open('/app/scripts/exit-on-fatal.py').read())"

COPY supervisord.conf /etc/supervisor/conf.d/stackyard.conf

WORKDIR /app/api

# Late, so a version-only rebuild does not bust earlier layers.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 80

# Runs through nginx to Node, so it covers both processes.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:80/health > /dev/null || exit 1

# supervisord runs as root to bind port 80. It drops the API process to the node
# user. See supervisord.conf.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    # Proves the shipped config parses and that nginx carries the realip module
    # the entrypoint needs.
    printf 'listen [::]:80;\n' > /etc/nginx/listen-ipv6.inc && \
    printf 'set_real_ip_from 127.0.0.1;\nreal_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' > /etc/nginx/http.d/realip.conf && \
    nginx -t && \
    printf '# Placeholder, replaced at container start by docker-entrypoint.sh.\n' > /etc/nginx/http.d/realip.conf && \
    printf '# Placeholder, replaced at container start by docker-entrypoint.sh.\n' > /etc/nginx/listen-ipv6.inc

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/stackyard.conf"]
