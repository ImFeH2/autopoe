FROM node:24-bookworm-slim AS frontend-builder

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

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS runner

ENV FLOWENT_STATIC_DIR=/app/frontend
ENV FLOWENT_HOST=0.0.0.0
ENV PORT=6873
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY backend ./backend
COPY README.md ./backend/README.md
RUN uv sync --project backend --frozen --no-dev

COPY --from=frontend-builder /app/frontend/dist ./frontend

RUN useradd --system --uid 1001 --create-home flowent \
  && mkdir -p /home/flowent/.flowent /workspace \
  && chown -R flowent:flowent /home/flowent/.flowent /workspace

USER flowent
WORKDIR /workspace

EXPOSE 6873

CMD ["uv", "run", "--project", "/app/backend", "--frozen", "--no-dev", "flowent"]
