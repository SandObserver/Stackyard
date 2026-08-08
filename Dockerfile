FROM node:24-alpine

LABEL org.opencontainers.image.title="Stackyard" \
      org.opencontainers.image.description="Self-hosted homelab dashboard" \
      org.opencontainers.image.source="https://github.com/SandObserver/stackyard"

# Remove the package managers the base image ships with. Nothing here uses
# them: the API has no dependencies to install, and the container runs nginx,
# node and python3 only. They are removed rather than tolerated because their
# own bundled dependencies are the whole of this image's vulnerability surface
# (tar, brace-expansion, ip-address and undici accounted for every HIGH and
# CRITICAL the release scan reported), and because a runtime container with a
# package manager in it hands one to anyone who gets inside.
#
# Globbed rather than pinned: the yarn directory carries its version, and a base
# image bump would silently stop matching an exact path. Verified immediately
# after, so a rename upstream fails the build instead of quietly shipping them.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg && \
    if command -v npm || command -v npx || command -v yarn || command -v corepack; then \
      echo "a package manager survived removal; check the base image layout" >&2; exit 1; \
    fi && \
    node -e "process.exit(0)"

# Install Nginx and supervisor
RUN apk add --no-cache nginx supervisor && \
    # Remove default nginx config from both possible locations
    rm -f /etc/nginx/conf.d/default.conf /etc/nginx/http.d/default.conf && \
    # Log/run paths for nginx and supervisor
    mkdir -p /var/log/nginx /var/log/supervisor /var/lib/nginx /run/nginx && \
    # Data and icons dirs — users mount volumes here.
    # Owned by the node user (UID 1000, provided by the base image) so the
    # API process can write config and uploaded icons without running as root.
    mkdir -p /data /icons && \
    chown -R node:node /data /icons

# Copy Nginx config — Alpine nginx reads from http.d/
COPY nginx/dashboard.conf /etc/nginx/http.d/dashboard.conf
COPY nginx/security-headers.conf /etc/nginx/http.d/security-headers.conf
COPY nginx/csp-default.conf /etc/nginx/http.d/csp-default.conf
# Replaced at container start by docker-entrypoint.sh; present here so the
# config is valid at build time.
COPY nginx/realip.conf /etc/nginx/http.d/realip.conf

# Copy UI static files
COPY ui/ /usr/share/nginx/html/

# Copy API source, owned by the node user
# The image mirrors the repository layout: api/ and ui/ keep their names and their
# position relative to each other. Rules that both the browser and the server
# enforce can then live in one file and be reached by the same relative path in
# both places, rather than being copied and kept in step by hand.
COPY --chown=node:node api/ /app/api/
# Only the shared modules from ui/, not the whole UI: nginx serves that from the
# web root above. See ui/js/link-url.js.
COPY --chown=node:node ui/js/link-url.js /app/ui/js/link-url.js
# The supervisord event listener that exits the container when a program cannot
# be started. See scripts/exit-on-fatal.py.
COPY scripts/exit-on-fatal.py /app/scripts/exit-on-fatal.py
# supervisor is a Python program, so apk pulls python3 in with it. Asserted
# rather than assumed: if that ever stops being true the image fails to build,
# instead of shipping a listener that cannot start and leaving the very failure
# it exists to catch undetected.
RUN /usr/bin/python3 -c "import ast,sys; ast.parse(open('/app/scripts/exit-on-fatal.py').read())"

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/stackyard.conf

WORKDIR /app/api

# Version baked from the release tag by CI (docker/metadata-action → build-arg).
# Placed late so version-only rebuilds don't bust earlier layers.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 80

# Healthcheck runs through Nginx → Node, covering both processes.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:80/health > /dev/null || exit 1

# supervisord runs as root so it can bind port 80 (nginx) and spawn processes.
# It drops the API process to the unprivileged 'node' user (see supervisord.conf).
# nginx drops its worker processes to the 'nginx' user automatically.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    # Proves the config parses in the image that ships, which also proves nginx
    # was built with the realip module the entrypoint depends on. A missing
    # module fails the build here rather than at a user's container start.
    printf 'set_real_ip_from 127.0.0.1;\nreal_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' > /etc/nginx/http.d/realip.conf && \
    nginx -t && \
    printf '# Placeholder, replaced at container start by docker-entrypoint.sh.\n' > /etc/nginx/http.d/realip.conf

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/stackyard.conf"]
