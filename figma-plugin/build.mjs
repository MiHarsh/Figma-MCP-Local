import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const watch = process.argv.includes("--watch");

// Build the plugin code (sandbox)
const codeBuild = {
  entryPoints: ["src/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  target: "es2018",
  format: "iife",
};

// Build the UI — inline the HTML
async function buildUI() {
  const html = fs.readFileSync(path.resolve("src/ui.html"), "utf-8");
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync(path.resolve("dist/ui.html"), html);
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(codeBuild);
    await ctx.watch();
    // Also copy UI initially
    await buildUI();
    console.log("Watching for changes...");

    // Watch UI file
    fs.watchFile(path.resolve("src/ui.html"), () => {
      buildUI();
      console.log("UI rebuilt");
    });
  } else {
    await esbuild.build(codeBuild);
    await buildUI();
    console.log("Build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
