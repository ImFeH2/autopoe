FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS frontend-builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@10.29.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store HUSKY=0 pnpm install --frozen-lockfile

COPY frontend ./frontend
RUN pnpm build:frontend

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim@sha256:531f855bda2c73cd6ef67d56b733b357cea384185b3022bd09f05e002cd144ca AS backend-builder

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

WORKDIR /app

COPY backend ./backend
COPY README.md ./backend/README.md
RUN uv sync --project backend --frozen --no-dev --no-install-package flowent-native

FROM python:3.13-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS runtime

ENV FLOWENT_STATIC_DIR=/app/frontend
ENV FLOWENT_SYSTEM_RUNTIME=1
ENV FLOWENT_HOST=0.0.0.0
ENV PORT=6873
ENV PATH=/app/backend/.venv/bin:$PATH

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 1001 --create-home flowent \
  && mkdir -p /home/flowent/.flowent /workspace \
  && chown -R flowent:flowent /home/flowent/.flowent /workspace

COPY --from=backend-builder --chown=flowent:flowent /app/backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend

USER flowent
WORKDIR /workspace

EXPOSE 6873

CMD ["/app/backend/.venv/bin/flowent"]
