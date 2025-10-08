import { Command } from "commander";
import chalk from "chalk";
import { config } from "../config/index.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";

export function registerOrganizationCurrentCommand(program: Command) {
  program
    .command("org:current")
    .aliases(["orgs:current", "organizations:current", "organization:current", "current"])
    .description("Show your current organization context.")
    .action(async (opts) => {
      // 1. Load session / access token
      const sessionSvc = new SessionService();
      const sess = await sessionSvc.load();
      if (!sess?.accessToken) {
        console.error(chalk.red("❌ Not authenticated. Run `ghostable login`."));
        process.exit(1);
      }

      const currentOrgId = sess.organizationId;
      if (!currentOrgId) {
        console.error(chalk.red("❌ No organization selected. Run `ghostable org:switch` to select one."));
        process.exit(1);
      }

      // 2. Fetch organizations
      const client = GhostableClient.unauthenticated(config.apiBase).withToken(sess.accessToken);
      const orgs = await client.organizations();
      const org = orgs.find((o) => o.id === currentOrgId);

      // 3. Display result
      if (!org) {
        console.error(chalk.red("❌ Unable to determine current organization (not found in API list)."));
        process.exit(1);
      }

      console.log(chalk.green(`✅ Current organization: ${org.name ?? currentOrgId}`));
    });
}