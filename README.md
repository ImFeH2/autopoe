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

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

# Flowent

Just say what you need. Flowent gets it done.

Flowent takes your request, works through the context and constraints, and
chooses a practical way forward. It can research the problem, write code, call
tools, or build a workflow, then keep going until the task is complete or your
input is needed.

## Capabilities

Flowent turns a conversation into action. It decides what should happen next,
uses the capabilities available to it, and follows the work through.

You might ask it to:

- Investigate the available options and recommend one that fits your needs.
- Find a problem in a project, fix it, and verify the result.
- Automate a repetitive task and run it every day.
- Diagnose a failed workflow, repair it, and continue the run.

Flowent combines research, code, files, commands, models, MCP servers, and
skills around the same goal. Work that benefits from structure, repetition, or
scheduling can become a workflow that Flowent creates and manages for you.

## Workspace

The Workspace keeps every step of the task visible.

In the **Workspace**, you can follow the conversation, tool calls, command
output, progress, and results as one continuous task.

If Flowent turns the task into a workflow, open **Workflows** to inspect the
actual nodes, connections, inputs, and outputs. Ask Flowent to maintain it, or
open the canvas and change the properties, connections, and inputs yourself.

Flowent handles the complex work, while you can inspect and edit the execution
whenever you want.

## Workflows

Flowent completes simple requests directly and turns structured, repeatable, or
scheduled work into workflows. A workflow can accept input, run agents and
Python code, call tools, produce output, and run on a timer.

When a workflow fails, Flowent receives the execution details. It can locate
the failed step, decide what needs to change, repair the workflow, and verify it
again.

The usual loop looks like this:

```text
Tell Flowent what you want to accomplish
        ↓
Flowent considers the options and starts the work
        ↓
Finish directly or create a workflow
        ↓
Run, inspect, and maintain it
        ↓
If something fails, Flowent diagnoses, repairs, and continues
```

## Security

Flowent combines capable local tools with clear security boundaries.

- File tools work within the workspace and explicitly allowed paths.
- Additional access goes through permission review.
- Risk review can stop broad, destructive, or sensitive actions before execution.
- Commands run inside a Bubblewrap sandbox with controlled filesystem access.
- Sandbox failures return to review before any broader retry is considered.

You can give Flowent useful tools while keeping their reach visible and
controlled.

## Providers

Choose the models and services that fit your work. Flowent supports:

- OpenAI-compatible Chat Completions APIs.
- OpenAI Responses APIs.
- Anthropic-compatible APIs.
- Gemini-compatible APIs.
- Custom service addresses and model names.

Provider settings include the selected model, reasoning effort, and context
window. Flowent tracks context usage and can compact a long conversation so
Flowent can continue with the goal, constraints, and completed work intact.

MCP servers and skills extend Flowent with more tools while your way of working
stays the same.

## Channels

Channels bring Flowent to the places where work already happens.

The Web workspace provides the full conversation, tool, and workflow
experience. Telegram is available for sending requests and receiving replies
away from the browser, with an approval step for new chat sessions.

Flowent keeps the same identity and task runtime across Channels. Its channel
architecture is ready for more integrations alongside Web and Telegram.

## Quick start

Flowent requires Bubblewrap for tool isolation and ripgrep for file search.

Install the system requirements:

```bash
sudo apt-get install bubblewrap ripgrep
```

Install Flowent with npm:

```bash
npm install -g flowent
```

Or install it with pip:

```bash
pip install flowent
```

Start Flowent:

```bash
flowent
```

Open the address shown in your terminal and tell Flowent what you want to do.

To check whether your system is ready:

```bash
flowent doctor
```

### Docker Compose

You can also run Flowent with Docker Compose:

```bash
docker compose up
```

## Development

Flowent is under active development.

Install the repository dependencies and start the development server:

```bash
sudo apt-get install bubblewrap ripgrep
pnpm install
uv sync --project backend
pnpm dev
```

Or run the development container:

```bash
docker compose -f docker-compose.dev.yml up
```

## License

Flowent is released under the [Apache License 2.0](LICENSE).
