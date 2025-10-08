import chalk from "chalk";

const formatArgs = (values: unknown[]): string =>
  values
    .map((value) => {
      if (value instanceof Error) {
        return value.stack ?? value.message ?? String(value);
      }
      return typeof value === "string" ? value : String(value);
    })
    .join(" ");

const createLogger =
  (writer: typeof console.log, colorize: (message: string) => string) =>
  (...values: unknown[]) => {
    if (values.length === 0) {
      writer("");
      return;
    }

    writer(colorize(formatArgs(values)));
  };

export const log = {
  info: createLogger(console.log, chalk.cyan),
  ok: createLogger(console.log, chalk.green),
  warn: createLogger(console.log, chalk.yellow),
  error: createLogger(console.error, chalk.red),
  text: createLogger(console.log, (message) => message),
  line: () => console.log(""),
};
