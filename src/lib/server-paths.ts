import { join } from "node:path";

export function getPaperGraphDataDirectory() {
  const configuredDataDirectory = process.env.PAPERGRAPH_DATA_DIR?.trim();

  return configuredDataDirectory || join(process.cwd(), "data");
}

export function getPaperGraphAssetDirectory() {
  return join(getPaperGraphDataDirectory(), "images");
}
