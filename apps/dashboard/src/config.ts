import { z } from "zod";

const DashboardConfigSchema = z
  .object({
    userPoolId: z
      .string()
      .regex(/^[a-z]{2}(?:-[a-z0-9]+)+-\d_[A-Za-z0-9]+$/, "Invalid user pool ID"),
    userPoolClientId: z.string().regex(/^[a-z0-9]{20,128}$/, "Invalid user pool client ID"),
    apiBaseUrl: z
      .url()
      .startsWith("https://")
      .transform((value) => value.replace(/\/$/u, "")),
  })
  .strict();

export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

export function loadDashboardConfig(environment: Record<string, unknown> = import.meta.env) {
  const result = DashboardConfigSchema.safeParse({
    userPoolId: environment["VITE_COGNITO_USER_POOL_ID"],
    userPoolClientId: environment["VITE_COGNITO_USER_POOL_CLIENT_ID"],
    apiBaseUrl: environment["VITE_API_URL"],
  });
  if (!result.success) {
    throw new Error("Dashboard authentication configuration is unavailable");
  }
  return Object.freeze(result.data);
}
