import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import ora from "ora";
import chalk from "chalk";

import { Manifest } from "../support/Manifest.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";
import { config } from "../config/index.js";

export function registerEnvInitCommand(program: Command) {
  program
    .command("env:init")
    .description("Initialize a new environment in the current organization and project context.")
    .option("--api <URL>", "Ghostable API base", config.apiBase)
    .option("--name <NAME>", "Environment name (slug)")
    .action(async (opts: { api?: string; name?: string }) => {
      // 1) Ensure session and project context
      const sessionSvc = new SessionService();
      const sess = await sessionSvc.load();
      if (!sess?.accessToken) {
        console.error(chalk.red("❌ Not authenticated. Run `ghostable login`."));
        process.exit(1);
      }

      let projectId: string;
      try {
        projectId = Manifest.id();
      } catch {
        console.error(chalk.red("❌ No project selected. Run `ghostable init` first."));
        process.exit(1);
        return;
      }

      const client = GhostableClient
        .unauthenticated(opts.api ?? config.apiBase)
        .withToken(sess.accessToken);

      // 2) Fetch environment types
      const typesSpinner = ora("Loading environment types…").start();
      let typeOptions: Array<{ value: string; label: string }>;
      try {
        typeOptions = await client.getEnvironmentTypes();
        typesSpinner.succeed(`Loaded ${typeOptions.length} environment types.`);
      } catch (err: any) {
        typesSpinner.fail("Failed to load environment types.");
        console.error(chalk.red(err?.message ?? err));
        process.exit(1);
      }

      const selectedType = await select<string>({
        message: "What type of environment are you creating?",
        choices: typeOptions.map((t) => ({ name: t.label, value: t.value })),
        pageSize: Math.min(12, typeOptions.length || 1),
      });

      // 3) Fetch project environments and choose base
      const envSpinner = ora("Loading existing environments…").start();
      let existingEnvs: Array<{ id: string; name: string }>;
      try {
        existingEnvs = await client.getEnvironments(projectId);
        envSpinner.succeed(`Loaded ${existingEnvs.length} environments.`);
      } catch (err: any) {
        envSpinner.fail("Failed to load environments.");
        console.error(chalk.red(err?.message ?? err));
        process.exit(1);
      }

      const baseChoices: Array<{ name: string; value: string | null }> = [
        { name: "Standalone", value: null },
        ...existingEnvs.map((e) => ({ name: e.name, value: e.id })),
      ];

      const selectedBase = await select<string | null>({
        message: "Which environment is this based on?",
        choices: baseChoices,
        pageSize: Math.min(12, baseChoices.length || 1),
      });

      // 4) Name (option > suggestions > custom)
      let name: string | undefined = opts.name;
      if (!name) {
        const suggestSpinner = ora("Fetching suggested environment names…").start();
        let suggestions: Array<{ name: string }>;
        try {
          suggestions = await client.suggestEnvironmentNames(projectId, selectedType);
          suggestSpinner.succeed();
        } catch {
          suggestions = [];
          suggestSpinner.stop();
        }

        if (suggestions.length) {
          const suggestionChoices = [
            ...suggestions.map((s) => ({ name: s.name, value: s.name })),
            { name: "Custom name", value: "__CUSTOM__" },
          ];

          const choice = await select<string>({
            message:
              "Choose an environment name or enter a custom one (must be unique and slug formatted)",
            choices: suggestionChoices,
            pageSize: Math.min(12, suggestionChoices.length || 1),
          });

          name =
            choice === "__CUSTOM__"
              ? await input({
                  message: "Enter a unique slug-formatted environment name:",
                  validate: (v) =>
                    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
                    "Use slug format (lowercase, digits, -, _).",
                })
              : choice;
        } else {
          name = await input({
            message: "Enter a unique slug-formatted environment name:",
            validate: (v) =>
              /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
              "Use slug format (lowercase, digits, -, _).",
          });
        }
      }

      // 5) Create the environment
      const createSpinner = ora(`Creating environment "${name}"…`).start();
      try {
        const env = await client.createEnvironment({
          projectId,
          name: name!,
          type: selectedType,
          baseId: selectedBase, // may be null
        });
        createSpinner.succeed(`Environment "${env.name ?? name}" created.`);

        // 6) Update manifest locally
        Manifest.addEnvironment({
          name: env.name ?? name!,
          type: env.type ?? selectedType,
        });

        console.log(chalk.green(`✅ Environment ${chalk.bold(name)} added to ghostable.yml`));
      } catch (err: any) {
        createSpinner.fail("Failed creating environment.");
        console.error(chalk.red(err?.message ?? err));
        process.exit(1);
      }
    });
}