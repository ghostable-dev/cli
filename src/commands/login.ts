import { Command } from "commander";
import { input, password, select } from "@inquirer/prompts";
import ora from "ora";
import { config } from "../config/index.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";
import { log } from "../support/logger.js";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Authenticate with Ghostable")
    .option("--api <URL>", "API base", config.apiBase)
    .action(async (opts) => {
      const apiBase = opts.api as string;
      const session = new SessionService();
      const client = GhostableClient.unauthenticated(apiBase);

      const email = await input({
        message: "Email:",
        validate: (v) => v.includes("@") || "Enter a valid email",
      });
      const pwd = await password({ message: "Password:" });

      const spinner = ora("Authenticating…").start();
      try {
        let token = await client.login(email, pwd);
        // 2FA
        const twofaClient = GhostableClient.unauthenticated(apiBase);
        if (!token) {
          spinner.stop();
          const code = await password({ message: "2FA code:" });
          spinner.start("Verifying 2FA…");
          token = await twofaClient.login(email, pwd, code);
        }
        spinner.succeed("Authenticated.");

        const authed = client.withToken(token);
        const orgs = await authed.organizations();

        let organizationId: string | undefined;
        if (orgs.length === 1) {
          organizationId = orgs[0].id;
          log.ok(`✅ Using organization: ${orgs[0].label()}`);
        } else if (orgs.length > 1) {
          organizationId = await select({
            message: "Choose your organization",
            choices: orgs.map((o) => ({ name: o.label(), value: o.id })),
          });
          log.ok(
            `✅ Using organization: ${orgs.find((o) => o.id === organizationId)?.label()}`,
          );
        } else {
          log.warn("No organizations found. Create one in the dashboard.");
        }

        await session.save({ accessToken: token, organizationId });
        log.ok("✅ Session stored in OS keychain.");
      } catch (e: any) {
        spinner.fail(e.message ?? "Login failed");
        process.exit(1);
      }
    });
}
