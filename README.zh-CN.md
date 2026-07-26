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
  <a href="README.md">English</a>
</p>

# Flowent

想做什么，只管说。Flowent 会搞定。

Flowent 会理解你的目标，结合已有信息和实际条件选择合适的实现方式。它可以搜索资料、
编写代码、调用工具或搭建 workflow，并持续推进，直到完成任务或需要你作出决定。

## 能力

Flowent 会把对话转化为行动。它会判断下一步应该做什么，使用合适的能力，并把任务
继续做下去。

例如，你可以告诉它：

- “调查一下有哪些方案，选一个适合我的。”
- “检查这个项目的问题，改好并验证。”
- “把这项重复工作自动化，每天运行一次。”
- “看看为什么 workflow 失败了，修复后继续运行。”

Flowent 会围绕同一个目标组合搜索、编码、文件处理、命令执行、模型、MCP server
和 Skills。适合多步执行、重复使用或定时运行的任务，可以由 Flowent 创建并管理为
workflow。

## 工作空间

工作空间让任务的每一步都清楚可见。

在 **Workspace** 中，对话、工具调用、命令输出、执行进度和结果都集中在一起。
Flowent 做过什么、得到了什么结果、接下来准备做什么，都能沿着同一项任务查看。

如果任务被整理成 workflow，打开 **Workflows** 就能看到真实的节点、连接、输入
和输出。你可以让 Flowent 继续维护，也可以进入画布亲自修改属性、调整连接和运行
流程。

Flowent 负责处理复杂操作，你也可以随时查看和修改具体执行过程。

## Workflow

Flowent 可以直接完成简单任务，也能把结构明确、需要复用或定时运行的任务整理成
workflow。Workflow 能够接收输入、运行 Agent 和 Python 代码、调用工具并输出结果，
也能按照计划持续执行。

Workflow 出错后，执行信息会返回 Flowent。它会判断失败发生在哪里、应该修改什么，
完成修复并继续验证，让任务重新向结果推进。

```text
告诉 Flowent 想做什么
      ↓
Flowent 考虑方案并开始执行
      ↓
直接完成，或创建 workflow
      ↓
运行、检查并持续维护
      ↓
遇到问题后诊断、修复并继续
```

## 安全

Flowent 在使用本地文件和命令时，会同时守住清晰的安全边界。

- 文件工具在工作空间和已经允许的路径中操作。
- 额外访问权限会先经过审查。
- 风险审查可以在执行前拦截范围过大、具有破坏性或涉及敏感内容的操作。
- 命令在 Linux 上使用 Bubblewrap、在 macOS 上使用 Seatbelt、在 Windows 上使用
  原生命令保护，并把写入范围限制在已经允许的位置。
- 如果命令保护无法启动，本次操作会停止，不会在无保护状态下继续执行。
- Windows 第一次执行受保护命令，或之后需要刷新保护设置时，会请求系统授权，用于
  创建或修复专用本地组、受限本地账户和网络规则；设置完成后，Flowent 会自动继续
  执行这条命令。

Flowent 可以获得真正有用的工具，同时让工具能够触及的范围保持清楚、可控。

## Providers

你可以选择适合自己的模型和服务。目前支持：

- OpenAI-compatible Chat Completions API。
- OpenAI Responses API。
- Anthropic-compatible API。
- Gemini-compatible API。
- 自定义服务地址和模型名称。

用户可以选择模型、reasoning effort 和 context window。Flowent 会跟踪上下文用量，
长对话接近容量时可以整理旧内容，同时保留任务目标、关键限制和已经完成的工作，
让 Flowent 继续推进。

还可以连接 MCP server 和添加 Skills，让 Flowent 使用更多适合任务的工具。

## Channels

Channels 让你可以从日常使用的入口联系同一个 Flowent。

Web 工作空间提供完整的对话、工具和 workflow 体验。当前也可以连接 Telegram，
离开浏览器后继续发送任务和接收回复；新的聊天会话需要先经过批准。

Flowent 在不同 Channel 中保持一致的身份和任务执行能力。除了 Web 和 Telegram，
这套 Channel 架构也为继续接入更多入口做好了准备。

## 快速开始

npm 和 PyPI 包已经包含 Flowent、Web 界面、文件搜索和命令保护所需文件，支持
glibc 2.17 或更高版本的 GNU/Linux、macOS 11 或更高版本，以及 Windows，每个平台
都提供 x64 和 arm64 版本。Linux 包包含 Bubblewrap，macOS 使用系统提供的 Seatbelt，
Windows 包包含原生命令保护程序。npm 和 pip 会自动选择对应版本，不需要另外安装
uv、Bubblewrap 或 ripgrep。

通过 npm 安装（需要 Node.js 20.9 或更高版本）：

```bash
npm install -g flowent
```

也可以通过 pip 安装（需要 Python 3.11 或更高版本）：

```bash
pip install flowent
```

启动 Flowent：

```bash
flowent
```

打开终端中显示的地址，就可以开始使用。

检查系统是否满足运行条件：

```bash
flowent doctor
```

检查结果会分别显示命令保护、文件搜索和内置运行文件是否可用。在 Windows 上，
如果保护设置尚未完成或需要更新，这里会显示需要设置；下一次执行受保护命令时会请求
系统授权。

### Docker Compose

也可以通过 Docker Compose 运行：

```bash
git clone https://github.com/ImFeH2/flowent.git
cd flowent
docker compose up
```

镜像已经包含 Flowent、文件搜索和命令保护所需文件，宿主机不需要另外安装 uv、
Bubblewrap 或 ripgrep。

## 开发

Flowent 仍在积极开发中。

源码开发使用 pnpm、uv、Rust 工具链和系统提供的 ripgrep，Linux 还需要 Bubblewrap。
在 Debian 或 Ubuntu 上，可以通过下面的命令安装系统工具并启动开发服务：

```bash
sudo apt-get install bubblewrap ripgrep
pnpm install
uv sync --project backend
pnpm dev
```

也可以运行开发容器：

```bash
docker compose -f docker-compose.dev.yml up
```

## 许可证

Flowent 使用 [Apache License 2.0](LICENSE) 发布。
