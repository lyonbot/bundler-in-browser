import { fs, InMemory } from "@zenfs/core";
import { dirname } from "path";
import dayjs from "dayjs";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import {
  BundlerInBrowser,
  installSassPlugin,
  installVuePlugin,
  wrapCommonJS,
} from "bundler-in-browser";
import installTailwindPlugin from "@bundler-in-browser/tailwindcss";
import type { PartialMessage } from "esbuild-wasm";
import { fsData } from "../../fsData";
import {
  isBuildRequest,
  newWorkerReadyMessage,
  workerSourceMarker,
  type BuildSuccessResponse,
  type NPMProgressMessage,
  type WorkerLogMessage,
} from "./common";

main().catch((err) => {
  log("worker main error", err);
  self.postMessage(newWorkerReadyMessage(err));
});
async function main() {
  Object.entries(fsData).forEach(([path, content]) => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content)
  });
  const bundler = new BundlerInBrowser(fs);

  // setup event listeners

  bundler.events.on("initialized", () => log("initialized"));
  bundler.events.on("npm:progress", (e) => log(`[npm] [${e.stage}] [${e.current} / ${e.total}] ${e.packageId}`));
  bundler.events.on("npm:install:done", () => log(`[npm] install:done`));
  bundler.events.on("npm:install:error", (e) => log(`[npm] install:error`, e.errors));
  bundler.events.on("build:start", () => log("build:start"));
  bundler.events.on("build:usercode", (result) => log("build:usercode", result));
  bundler.events.on("build:vendor", (result) => log("build:vendor", result));

  bundler.events.on("npm:install:error", () => self.postMessage({ type: 'npm-progress', source: workerSourceMarker, event: 'error', progress: null } satisfies NPMProgressMessage));
  bundler.events.on("npm:install:done", () => self.postMessage({ type: 'npm-progress', source: workerSourceMarker, event: 'done', progress: null } satisfies NPMProgressMessage));
  bundler.events.on("npm:progress", (e) => self.postMessage({ type: 'npm-progress', source: workerSourceMarker, event: 'progress', progress: e } satisfies NPMProgressMessage));

  // initialize

  bundler.npm.options.blocklist = [
    '@vue/compiler-core',
    '@vue/compiler-dom',
    '@vue/compiler-sfc',
    '@vue/server-renderer',
  ]

  await bundler.initialize({
    esbuildWasmURL: esbuildWasmURL,
  });
  await installSassPlugin(bundler);
  await installVuePlugin(bundler, { enableProdDevTools: true });
  await installTailwindPlugin(bundler, {
    tailwindConfig: "/tailwind.config.js",
    // tailwindConfig: {
    //   corePlugins: {
    //     preflight: false,  // remove Tailwind's reset
    //   }
    // }
  });

  // ready to compile
  self.addEventListener("message", async ({ data }) => {
    if (!isBuildRequest(data)) return;

    // reset fs
    fs.umount('/')
    fs.mount('/', InMemory.create({}));
    Object.entries(data.files).forEach(([path, content]) => {
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, content);
    });

    await bundler
      .build({
        entrypoint: '/src/index.js',
      })
      .then((result) => {
        const message: BuildSuccessResponse = {
          result,
          wrappedJs: wrapCommonJS(result.js),
        };
        data.port.postMessage(message);
        log("build:done", result);
      })
      .catch((err: Error & { errors?: (PartialMessage | Error)[] }) => {
        data.port.postMessage({ errors: err.errors || [err] });

        log(`build:error ${err}`);
        // if (err.errors?.length) {
        //   err.errors.forEach((error, index, errors) => {
        //     let msg = 'text' in error ? error.text : String(error);
        //     let pos = 'location' in error && error.location ? ` (${error.location.file}:${error.location.line}:${error.location.column})` : '';
        //     log(`build:error ${index + 1}/${errors.length}`, msg, pos);
        //   })
        // } else {
        //   log(err);
        // }
      });

    data.port.close();
  });
  self.postMessage(newWorkerReadyMessage());
}

function log(...args: any[]) {
  console.log(`[worker] ${dayjs().format("HH:mm:ss")} |`, ...args);

  const message: WorkerLogMessage = {
    type: "log",
    source: workerSourceMarker,
    timestamp: Date.now(),
    level: "info",
    message: args.join(" "),
  };
  self.postMessage(message);
}
