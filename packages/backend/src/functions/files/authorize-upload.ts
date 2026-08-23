import { getFileHandlers } from "../../modules/file-management/runtime.js";

export const handler = getFileHandlers().authorizeUpload;
