#!/usr/bin/env bun

// Build script for ghdash TUI - compiles to standalone binaries for Linux and Darwin
// @ts-ignore - solid-plugin is a TypeScript file without full type declarations
//
// lifted from [opencode's build script](https://github.com/anomalyco/opencode/blob/60e616ec8150d100a17df758963eb023b8f50d95/packages/opencode/script/build.ts)
import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin";
import path from "path";
import fs from "fs";
import { $ } from "bun";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dir = path.resolve(__dirname, "..");

process.chdir(dir);

const pkg = await Bun.file(path.join(dir, "package.json")).json();

// Allow CI (e.g. beta prereleases) to override the embedded/published version
// without committing a package.json bump.
const version: string = process.env.GHDASH_TUI_BUILD_VERSION || pkg.version;

const singleFlag = process.argv.includes("--single");

const allTargets: {
  os: string;
  arch: "arm64" | "x64";
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
];

const targets = singleFlag
  ? allTargets.filter(
      (item) => item.os === process.platform && item.arch === process.arch,
    )
  : allTargets;

await $`rm -rf dist`;

const binaries: Record<string, string> = {};

// Install native dependencies for all target platforms
await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`;

for (const item of targets) {
  const name = ["ghdash-tui", item.os, item.arch].join("-");
  console.log(`Building ${name}...`);
  await $`mkdir -p dist/${name}/bin`;

  // Get the parser worker path from @opentui/core
  const parserWorker = fs.realpathSync(
    path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"),
  );

  const result = await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      //@ts-ignore (bun types aren't up to date)
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: `bun-${item.os}-${item.arch}` as any,
      outfile: `dist/${name}/bin/ghdash-tui`,
      execArgv: ["--"],
      windows: {},
    },
    entrypoints: ["./src/index.tsx", parserWorker],
    define: {
      GHDASH_TUI_VERSION: `'${version}'`,
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${name}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Create package.json for the binary package
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name: `@andycmaj/${name}`,
        version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  );

  binaries[name] = version;
  console.log(`Built ${name} successfully`);
}

console.log("\nBuild complete!");
console.log("Binaries:", binaries);

export { binaries };
