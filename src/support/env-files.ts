import fs from "node:fs";

export function writeEnvFile(
  filePath: string,
  vars: Record<string, string>,
): void {
  const content =
    Object.keys(vars)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${key}=${vars[key]}`)
      .join("\n") + "\n";

  fs.writeFileSync(filePath, content, "utf8");
}

export function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const result: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    result[key] = value;
  }

  return result;
}

export function readEnvFileSafe(filePath: string): Record<string, string> {
  try {
    return readEnvFile(filePath);
  } catch {
    return {};
  }
}
