export function parseOptions(argv, required) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error("Options must use --name value pairs");
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new Error(`Duplicate option: --${name}`);
    }
    options[name] = value;
  }
  for (const name of required) {
    if (!options[name]) {
      throw new Error(`Missing required option: --${name}`);
    }
  }
  return options;
}

export async function runCli(operation) {
  try {
    await operation();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
