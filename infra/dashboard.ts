export const DASHBOARD_COMPONENT_NAME = "Dashboard";
export const DASHBOARD_CONFIG = {
  path: "apps/dashboard",
  build: {
    command: "npm run build",
    output: "dist",
  },
} as const;

export function createDashboard() {
  return new sst.aws.StaticSite(DASHBOARD_COMPONENT_NAME, DASHBOARD_CONFIG);
}
