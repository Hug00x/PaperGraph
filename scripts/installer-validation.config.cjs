// NSIS acceptance test identity: never replace the user's PaperGraph installation.
// Run with --prepackaged desktop-dist/win-unpacked after the production build.
const { build } = require("../package.json");
module.exports = {
  ...build,
  appId: "com.papergraph.installer-validation",
  productName: "PaperGraph Installer Validation",
  artifactName: "PaperGraph-Installer-Validation.${ext}",
  directories: { output: ".utmp/installer-validation" },
  win: { ...build.win, executableName: "PaperGraph" },
  protocols: [],
  nsis: { ...build.nsis, createDesktopShortcut: false, createStartMenuShortcut: false },
  publish: null,
};
