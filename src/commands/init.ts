import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import ora from "ora";

import { Manifest } from "../support/Manifest.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";
import { config } from "../config/index.js";
import { log } from "../support/logger.js";

type Project = { id: string; name: string; environments?: any };

export function registerOrganizationListCommand(program: Command) {
  program
    .command("init")
    .description(
      "Initialize a new project in the current directory within the current organization context.",
    )
    .option("--api <URL>", "API base", config.apiBase)
    .action(async (opts) => {
      const apiBase = (opts.api as string) ?? config.apiBase;

      // Ensure we have a session & org
      const sessions = new SessionService();
      const sess = await sessions.load();
      if (!sess?.accessToken) {
        log.error("❌ Not authenticated. Run `ghostable login` first.");
        process.exit(1);
      }
      if (!sess.organizationId) {
        log.error(
          "❌ No organization selected. Run `ghostable login` and pick an organization (or add an org switch command).",
        );
        process.exit(1);
      }

      const client = GhostableClient.unauthenticated(apiBase).withToken(
        sess.accessToken,
      );

      // Fetch projects
      const spinner = ora("Loading projects…").start();
      let projects: Project[] = [];
      try {
        projects = await client.projects(sess.organizationId);
        spinner.succeed(
          `Loaded ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
        );
      } catch (e: any) {
        spinner.fail("Failed loading projects.");
        log.error(e?.message ?? e);
        process.exit(1);
      }

      // Build project choices
      const choices = [
        { name: "[Create a new project]", value: "__new__" },
        ...projects.map((p) => ({ name: p.name ?? p.id, value: p.id })),
      ];

      const selection = await select({
        message: "Which project should this directory be linked to?",
        choices,
        pageSize: Math.min(10, choices.length || 1),
        default: "__new__",
      });

      let project: Project;

      if (selection !== "__new__") {
        project = projects.find((p) => p.id === selection)!;
      } else {
        const name = await input({
          message: "What is the name of this project?",
          validate: (v) =>
            (v && v.trim().length > 0) || "Project name is required",
        });

        const createSpin = ora("Creating project…").start();
        try {
          project = await client.createProject({
            organizationId: sess.organizationId,
            name: name.trim(),
          });
          createSpin.succeed(`Project created: ${project.name}`);
        } catch (e: any) {
          createSpin.fail("Failed creating project.");
          log.error(e?.message ?? e);
          process.exit(1);
        }
      }

      // Write manifest
      try {
        Manifest.fresh({
          id: project.id,
          name: project.name,
          environments: project.environments ?? {},
        });
        log.ok(
          `✅ ${project.name} initialized. ${Manifest.resolve()} created.`,
        );
      } catch (e: any) {
        log.error(`❌ Failed writing manifest: ${e?.message ?? e}`);
        process.exit(1);
      }
    });
}
