<p align="center">
  <img src="https://raw.githubusercontent.com/ImFeH2/flowent/main/assets/flowent-banner.png" alt="Flowent" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/flowent"><img src="https://img.shields.io/npm/v/flowent.svg?style=flat-square&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/flowent"><img src="https://img.shields.io/npm/dm/flowent.svg?style=flat-square&label=npm" alt="npm monthly downloads" /></a>
  <a href="https://pypi.org/project/flowent/"><img src="https://img.shields.io/pypi/v/flowent.svg?style=flat-square&label=PyPI" alt="PyPI version" /></a>
  <a href="https://pypi.org/project/flowent/"><img src="https://img.shields.io/pypi/dm/flowent.svg?style=flat-square&label=PyPI" alt="PyPI monthly downloads" /></a>
  <br />
  <a href="https://github.com/ImFeH2/flowent/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/flowent.svg?style=flat-square&label=License" alt="License" /></a>
  <a href="https://github.com/ImFeH2/flowent/actions/workflows/ci.yml"><img src="https://github.com/ImFeH2/flowent/workflows/CI/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ImFeH2/flowent/actions/workflows/release.yml"><img src="https://github.com/ImFeH2/flowent/workflows/Release/badge.svg" alt="Release" /></a>
  <a href="https://github.com/ImFeH2/flowent/pkgs/container/flowent"><img src="https://github.com/ImFeH2/flowent/workflows/Docker/badge.svg" alt="Docker" /></a>
</p>

# Flowent

Run tasks and build workflows by talking to Flowent.

Flowent is an AI workspace built around Steward, an AI operator that helps you
run tasks, use tools, and build workflows through conversation. Simple requests
can be handled directly by the agent runtime; complex or repeatable work can
become workflows that Flowent creates, runs, and refines from execution
feedback.

## Install

Flowent requires Bubblewrap for local tool isolation and ripgrep for file
search. Install the system packages first:

```bash
sudo apt-get install bubblewrap ripgrep
```

Install the CLI globally:

```bash
npm install -g flowent
```

Or install it with pip:

```bash
pip install flowent
```

Start the server:

```bash
flowent
```

Check system requirements:

```bash
flowent doctor
```

## Docker Compose

Run the server with Docker Compose:

```bash
docker compose up
```

## Tech Stack

- Vite: frontend development server and build tool.
- React: UI rendering model.
- FastAPI: local application server and settings API.
- uv: Python dependency and environment management.
- Tailwind CSS: utility-first styling.
- Shadcn UI: standard component patterns.
- Lucide Icons: shared icon set.
- Framer Motion: advanced interaction and transition animation.

## Development

Install dependencies and start the local development server:

```bash
sudo apt-get install bubblewrap ripgrep
pnpm install
uv sync --project backend
pnpm dev
```

You can also run the development container:

```bash
docker compose -f docker-compose.dev.yml up
```
