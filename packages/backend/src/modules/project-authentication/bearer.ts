import {
  parseProjectApiKey,
  type ParsedProjectApiKey,
} from "../identity-control/credentials/credential.js";

export class InvalidProjectBearerError extends Error {
  public constructor() {
    super("Project bearer credential is invalid");
    this.name = "InvalidProjectBearerError";
  }
}

export function parseProjectBearer(
  headers: Readonly<Record<string, string>> | undefined,
): ParsedProjectApiKey {
  const values = Object.entries(headers ?? {})
    .filter(([name]) => name.toLowerCase() === "authorization")
    .map(([, value]) => value);
  if (values.length !== 1) throw new InvalidProjectBearerError();
  const match = /^Bearer (rus_v1\.key_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})$/.exec(values[0]!);
  if (!match) throw new InvalidProjectBearerError();
  try {
    return parseProjectApiKey(match[1]!);
  } catch {
    throw new InvalidProjectBearerError();
  }
}
