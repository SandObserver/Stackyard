FROM node:24-alpine

LABEL org.opencontainers.image.title="Stackyard" \
      org.opencontainers.image.description="Self-hosted homelab dashboard" \
      org.opencontainers.image.source="https://github.com/SandObserver/stackyard"

# Install Nginx and supervisor
RUN apk add --no-cache nginx supervisor && \
    # Remove default nginx config from both possible locations
    rm -f /etc/nginx/conf.d/default.conf /etc/nginx/http.d/default.conf && \
    # Nginx runs as non-root inside container; ensure log paths exist
    mkdir -p /var/log/nginx /var/log/supervisor && \
    # Data and icons dirs — users mount volumes here
    mkdir -p /data /icons

# Copy Nginx config — Alpine nginx reads from http.d/
COPY nginx/dashboard.conf /etc/nginx/http.d/dashboard.conf

# Copy UI static files
COPY ui/ /usr/share/nginx/html/

# Copy API source
COPY api/ /app/

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/stackyard.conf

WORKDIR /app

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:80/api/health > /dev/null || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/stackyard.conf"]
