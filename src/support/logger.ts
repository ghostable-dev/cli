import chalk from "chalk";

export const log = {
  info: (...a: any[]) => console.log(chalk.cyan(...a)),
  ok:   (...a: any[]) => console.log(chalk.green(...a)),
  warn: (...a: any[]) => console.log(chalk.yellow(...a)),
  error:(...a: any[]) => console.error(chalk.red(...a)),
};