import { resolveInstallationTarget } from "../infra/config/installation-target.ts";

/** Consume wrapper selectors once, before passing any remaining arguments downstream.
 * @param {string[]} argv
 */
export function parseInstallationArguments(argv) {
  /** @type {string[]} */
  const targets = [];
  /** @type {string[]} */
  const stages = [];
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) throw new Error("Empty wrapper argument.");
    const option = argument.split("=", 1)[0];
    if (option === "--installation-target" || option === "--stage") {
      const value = argument.includes("=")
        ? argument.slice(argument.indexOf("=") + 1)
        : argv[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${option}.`);
      (option === "--stage" ? stages : targets).push(value);
    } else {
      // SST global switches could redirect configuration, credentials or stage selection.
      if (
        argument === "--" ||
        ["--region", "--profile", "--config", "--app", "--cwd", "-s", "-c"].includes(option ?? "")
      ) {
        throw new Error("Installation overrides and argument separators are forbidden.");
      }
      args.push(argument);
    }
  }
  if (stages.length !== 1) throw new Error("Exactly one explicit --stage must be provided.");
  if (targets.length !== 1)
    throw new Error("Exactly one explicit --installation-target must be provided.");
  const installation = resolveInstallationTarget(targets[0], stages[0]);
  return { installation, stage: installation.stage, args };
}
