FROM node:24-alpine

LABEL org.opencontainers.image.title="Stackyard" \
      org.opencontainers.image.description="Self-hosted homelab dashboard" \
      org.opencontainers.image.source="https://github.com/SandObserver/stackyard"

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

# Copy UI static files
COPY ui/ /usr/share/nginx/html/

# Copy API source, owned by the node user
COPY --chown=node:node api/ /app/

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/stackyard.conf

WORKDIR /app

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
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/stackyard.conf"]
