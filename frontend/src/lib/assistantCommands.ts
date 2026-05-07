export interface AssistantCommandSpec {
  name: string;
  description: string;
  usage: string;
}

export interface AssistantCommandSelectionState {
  index: number;
  token: string;
}

export const ASSISTANT_COMMANDS: AssistantCommandSpec[] = [
  {
    name: "/clear",
    description: "Clear the current chat.",
    usage: "/clear",
  },
  {
    name: "/compact",
    description: "Compress this chat for future replies.",
    usage: "/compact [focus]",
  },
  {
    name: "/help",
    description: "Show available commands and usage.",
    usage: "/help",
  },
];

const COMMAND_TOKEN_PATTERN = /^\/\S*/;

export interface ParsedAssistantCommandInput {
  filtered: AssistantCommandSpec[];
  isCommandInput: boolean;
  token: string;
}

interface NormalizedAssistantCommandInput {
  leadingWhitespace: string;
  trimmedStart: string;
  token: string;
  suffix: string;
}

function normalizeAssistantCommandInput(
  input: string,
): NormalizedAssistantCommandInput {
  const trimmedStart = input.trimStart();
  const leadingWhitespace = input.slice(0, input.length - trimmedStart.length);
  const tokenMatch = trimmedStart.match(COMMAND_TOKEN_PATTERN);
  const token = tokenMatch?.[0] ?? "/";
  const suffix = trimmedStart.slice(token.length);

  return {
    leadingWhitespace,
    trimmedStart,
    token,
    suffix,
  };
}

function clampAssistantCommandIndex(
  index: number,
  optionCount: number,
): number {
  if (optionCount <= 0) {
    return 0;
  }
  return Math.min(index, optionCount - 1);
}

export function parseAssistantCommandInput(
  input: string,
): ParsedAssistantCommandInput {
  const { trimmedStart, token } = normalizeAssistantCommandInput(input);

  if (!trimmedStart.startsWith("/")) {
    return {
      filtered: [],
      isCommandInput: false,
      token: "",
    };
  }

  const filtered =
    token === "/"
      ? ASSISTANT_COMMANDS
      : ASSISTANT_COMMANDS.filter((command) => command.name.startsWith(token));

  return {
    filtered,
    isCommandInput: true,
    token,
  };
}

export function resolveAssistantCommandSelection(
  commandOptions: AssistantCommandSpec[],
  selectionState: AssistantCommandSelectionState,
  commandToken: string,
): {
  selectedCommand: AssistantCommandSpec | null;
  selectedCommandIndex: number;
} {
  const selectedCommandIndex =
    selectionState.token === commandToken
      ? clampAssistantCommandIndex(selectionState.index, commandOptions.length)
      : 0;

  return {
    selectedCommand:
      commandOptions[
        Math.min(selectedCommandIndex, Math.max(commandOptions.length - 1, 0))
      ] ?? null,
    selectedCommandIndex,
  };
}

export function stepAssistantCommandSelection(
  commandOptions: AssistantCommandSpec[],
  selectionState: AssistantCommandSelectionState,
  commandToken: string,
  direction: 1 | -1,
): AssistantCommandSelectionState {
  if (commandOptions.length === 0) {
    return {
      index: 0,
      token: commandToken,
    };
  }

  const { selectedCommandIndex } = resolveAssistantCommandSelection(
    commandOptions,
    selectionState,
    commandToken,
  );

  return {
    index:
      (selectedCommandIndex + direction + commandOptions.length) %
      commandOptions.length,
    token: commandToken,
  };
}

export function isAssistantCommandReadyToSend(
  input: string,
  commandName: string,
): boolean {
  const { trimmedStart, token } = normalizeAssistantCommandInput(input);

  return (
    token === commandName &&
    (trimmedStart === commandName || trimmedStart.startsWith(`${commandName} `))
  );
}

export function insertAssistantCommand(
  input: string,
  command: AssistantCommandSpec,
): string {
  const { leadingWhitespace, suffix } = normalizeAssistantCommandInput(input);

  if (!suffix) {
    return `${leadingWhitespace}${command.name} `;
  }

  return `${leadingWhitespace}${command.name}${suffix.startsWith(" ") ? suffix : ` ${suffix}`}`;
}
