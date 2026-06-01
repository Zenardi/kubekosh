# syntax=docker/dockerfile:1

# ── Stage 1: builder — compiles native node modules + builds the frontend ─────
# Compilers (g++/make/python3) live ONLY here and never ship in the final image.
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend production deps (native modules: better-sqlite3, node-pty).
# npm ci installs exactly what the committed lockfile pins — reproducible.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Frontend build (needs devDeps: vite).
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
ARG VITE_APP_VERSION=dev
RUN cd frontend && VITE_APP_VERSION=${VITE_APP_VERSION} npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV KUBECONFIG=/etc/rancher/k3s/k3s.yaml
# k3s writes its kubeconfig here; make kubectl pick it up automatically
ENV K3S_KUBECONFIG_MODE=644

# ── System deps (no compilers — those stayed in the builder) ─────────────────
# vim/nano/git/jq/htop are intentional: the lab user gets an interactive shell.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git vim nano jq bash bash-completion \
    ca-certificates gnupg lsb-release \
    nginx \
    iproute2 iptables iputils-ping \
    procps htop \
    mount kmod \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 runtime ───────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── k3s — pinned-capable + checksum-verified ─────────────────────────────────
# Defaults to the latest release; set --build-arg K3S_VERSION=vX.Y.Z+k3s1 to pin.
# The binary is verified against k3s's published sha256sum for the same release.
ARG K3S_VERSION=latest
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64)  arch="amd64"; bin="k3s" ;; \
      aarch64) arch="arm64"; bin="k3s-arm64" ;; \
      *) echo "Unsupported arch: $(uname -m)"; exit 1 ;; \
    esac; \
    if [ "$K3S_VERSION" = "latest" ]; then \
      base="https://github.com/k3s-io/k3s/releases/latest/download"; \
    else \
      base="https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}"; \
    fi; \
    curl -fsSL "${base}/${bin}" -o /usr/local/bin/k3s; \
    curl -fsSL "${base}/sha256sum-${arch}.txt" -o /tmp/k3s-sha256.txt; \
    sum_line="$(awk -v b="$bin" '$2==b {print $1"  /usr/local/bin/k3s"}' /tmp/k3s-sha256.txt)"; \
    [ -n "$sum_line" ] || { echo "no published checksum found for $bin"; exit 1; }; \
    echo "$sum_line" | sha256sum -c -; \
    rm -f /tmp/k3s-sha256.txt; \
    chmod +x /usr/local/bin/k3s; \
    ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl; \
    ln -sf /usr/local/bin/k3s /usr/local/bin/crictl

# ── App files ─────────────────────────────────────────────────────────────────
WORKDIR /app

# Source first, then the pre-built artifacts from the builder on top
# (the repo has no node_modules/dist, so nothing clobbers the copied ones).
COPY backend/  ./backend/
COPY scenarios/ ./scenarios/
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/frontend/dist ./frontend/dist

COPY scripts/entrypoint.sh /entrypoint.sh
COPY scripts/nginx.conf /etc/nginx/nginx.conf

# Strip any Windows-style \r from the entrypoint so heredocs inside it
# don't produce scripts with \r in shebang lines (causes execvp ENOENT).
RUN sed -i 's/\r//' /entrypoint.sh && chmod +x /entrypoint.sh

# ── Directories & k3s static config ─────────────────────────────────────────
RUN mkdir -p /root/.kube /data /var/log /tmp/k8s-state \
    && mkdir -p /var/log/nginx \
    && mkdir -p /etc/rancher/k3s \
    && mkdir -p /var/lib/rancher/k3s

# Tell k3s to use the native snapshotter.
RUN printf 'snapshotter: "native"\nwrite-kubeconfig-mode: "644"\n' \
    > /etc/rancher/k3s/config.yaml

# ── Expose & health ──────────────────────────────────────────────────────────
# Single port - nginx proxies everything
EXPOSE 80

# Reports "healthy" once the API + cluster are up (k3s first boot can take ~1-2 min).
HEALTHCHECK --interval=10s --timeout=3s --start-period=90s --retries=18 \
  CMD curl -fsS http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
