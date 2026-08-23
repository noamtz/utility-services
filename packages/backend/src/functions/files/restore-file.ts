import { getFileLifecycleHandlers } from "../../modules/file-management/runtime.js";

export const handler = getFileLifecycleHandlers().restoreFile;
