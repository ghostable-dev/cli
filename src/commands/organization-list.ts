import { Command } from "commander";
import chalk from "chalk";
import { config } from "../config/index.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";

export function registerOrganizationListCommand(program: Command) {
  program
    .command("org:list")
    .aliases(["orgs:list", "organizations:list", "organization:list"])
    .description("List the organizations that you belong to.")
    .action(async (opts) => {
      // Load session / token
      const sessionSvc = new SessionService();
      const sess = await sessionSvc.load();
      if (!sess?.accessToken) {
        console.error(chalk.red("❌ Not authenticated. Run `ghostable login`."));
        process.exit(1);
      }
      const currentOrgId = sess.organizationId;

      // Fetch orgs
      const client = GhostableClient.unauthenticated(config.apiBase).withToken(sess.accessToken);
      const orgs = (await client.organizations()).sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "")
      );

      if (orgs.length === 0) {
        console.log(chalk.yellow("No organizations found for this account."));
        return;
      }

      // Render table
      const rows = orgs.map((o) => ({
        ID: o.id,
        Name: o.name ?? "",
        Current: o.id === currentOrgId ? "✅" : "",
      }));

      // Use native console.table for a lightweight table
      console.table(rows);
    });
}