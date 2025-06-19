import path from "path";
import type { BundlerInBrowser } from "./BundlerInBrowser.js";
import { EventEmitter } from "./EventEmitter.js";
import { NPMRegistry } from "./npm/registry.js";
import { pourTarball } from "./npm/tarball.js";
import { buildTree, isAlreadySatisfied, ROOT, type BuildTreeNPMRegistry, type NpmTreeNode } from "./npm/tree.js";
import { makeParallelTaskMgr } from "./parallelTask.js";
import { listToTestFn, memoAsync, pathToNpmPackage } from "./utils/index.js";
import { groupBy, keyBy } from "./utils/misc.js";

const LOCK_FILENAME = 'lock.json';

const BLOCKED_TAR_PATH = 'blocked:'

export namespace MiniNPM {
  export interface Options {
    /** 
     * npm registry url. 
     * 
     * @default "https://registry.npmjs.org" 
     * @example "https://mirrors.cloud.tencent.com/npm"
     */
    registryUrl?: string;

    /** directory of root node_modules. defaults to `/node_modules` */
    nodeModulesDir?: string;
    shamefullyHoist?: boolean;
    concurrency?: number;

    /** these packages won't be installed */
    blocklist?: (string | RegExp)[];

    /** patch package.json before installing. also affect resolving */
    packageJsonPatches?: Array<(json: PackageJsonLike) => PackageJsonLike | void>;
  }

  export interface PackageJsonLike {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    dist?: { tarball: string };
    [key: string]: any;
  }

  export interface PkgIndex {
    version: string;
    dependencies: Record<string, string>; // including peerDependencies, only for version checking
  }

  export type TreeNode = NpmTreeNode

  export interface LockFile {
    packages: {
      [nameAtVersion: string]: TreeNode;
    }

    /**
     * a hidden hoisted packages, in ./store/node_modules/
     * designed for not-behaved packages, like requiring "@babel/runtime" without peerDependencies
     * 
     * eg { "@babel/runtime": "@babel/runtime@7.18.9" }
     */
    hoisted: { [dstName: string]: string };
  }

  export interface ProgressEvent {
    type: 'progress';
    stage: 'fetch-metadata' | 'install-package';
    packageId: string;
    current: number;
    total: number;
  }
}

/**
 * a minimal npm client, which only supports installing packages.
 * 
 * it manages a customized `lock.json` file, hence you can quickly re-install, adding or removing packages.
 * 
 * it heavily relies on `symlinks`. don't forget to enable `symlinks` in your resolve plugin.
 */
export class MiniNPM {
  public fs: BundlerInBrowser.IFs;
  public options: Required<MiniNPM.Options>;

  public events = new EventEmitter<{
    'progress': (e: MiniNPM.ProgressEvent) => void;
    'metadata-fetched': (e: {
      requiredPackages: Record<string, MiniNPM.TreeNode>;
    }) => void
  }>()

  constructor(fs: BundlerInBrowser.IFs, options: MiniNPM.Options = {}) {
    this.fs = fs;
    this.options = {
      registryUrl: 'https://registry.npmjs.org',
      // registryUrl: 'https://mirrors.cloud.tencent.com/npm',
      nodeModulesDir: '/node_modules',
      shamefullyHoist: false,
      concurrency: 5,
      blocklist: [],
      packageJsonPatches: [],
      ...options,
    };
  }

  getLockFilePath() {
    return path.join(this.options.nodeModulesDir, '.store', LOCK_FILENAME);
  }

  async readLockFile() {
    const lockFilePath = this.getLockFilePath();
    try {
      const data = this.fs.readFileSync(lockFilePath, 'utf8');
      if (!data) return null;
      const lockfile = JSON.parse(data as string) as MiniNPM.LockFile;
      return lockfile;
    } catch {
      return null;
    }
  }

  async writeLockFile(lockFile: MiniNPM.LockFile) {
    const lockFilePath = this.getLockFilePath();
    this.fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
    this.fs.writeFileSync(lockFilePath, JSON.stringify(lockFile, null, 2));
  }

  /**
   * check whether root's dep already satisfied. if so, you can skip install.
   * 
   * @param rootDependencies 
   */
  async isAlreadySatisfied(rootDependencies: { [name: string]: string }) {
    const lockFile = await this.readLockFile();
    const alreadySatisfied = !!lockFile && isAlreadySatisfied(Object.values(lockFile.packages), rootDependencies);
    return alreadySatisfied;
  }

  /** @internal - packages to delete for next `install()` */
  #packageIdsToDelete = new Set<string>();

  /**
   * build npm tree, and update lock file content, but not install packages
   */
  async regenerateLockFile(rootDependencies: { [name: string]: string }): Promise<{
    lockFile: MiniNPM.LockFile
    buildTreeResult: Awaited<ReturnType<typeof buildTree>>
  }> {
    const prevLockFile = await this.readLockFile();
    const registry = this.getRegistry();

    const rootPkg: NpmTreeNode = {
      id: ROOT,
      name: ROOT,
      version: '',
      dependents: {},
      dependencies: rootDependencies,
      dist: {} as any,
    }
    const packages = { [ROOT]: rootPkg, ...prevLockFile?.packages };
    packages[ROOT] = rootPkg;

    const hoisted: MiniNPM.LockFile['hoisted'] = {};
    const tree = await buildTree(packages, registry, {
      concurrency: this.options.concurrency,
      onProgress: e => this.events.emit('progress', {
        type: 'progress',
        stage: 'fetch-metadata',
        current: e.current,
        total: e.total,
        packageId: e.packageId,
      }),
    });

    for (const [name, pkgs] of Object.entries(groupBy(tree.packages, x => x.name))) {
      let pkg = pkgs[0];
      let pkgDependentCount = 0
      for (const i of pkgs.slice(1)) {
        const cnt = Object.keys(i.dependents).length;
        if (cnt > pkgDependentCount) {
          pkg = i;
          pkgDependentCount = cnt;
        }
      }

      if (pkg.id === ROOT) continue;
      hoisted[name] = pkg.id;
    }

    const packagesMap = keyBy(tree.packages, x => x.id);
    this.events.emit('metadata-fetched', { requiredPackages: packagesMap })

    const lockFile: MiniNPM.LockFile = {
      packages: packagesMap,
      hoisted,
    };
    await this.writeLockFile(lockFile);
    tree.existingPackagesToRemove.forEach(id => this.#packageIdsToDelete.add(id));

    return {
      buildTreeResult: tree,
      lockFile: lockFile,
    }
  }

  /* c8 ignore start */

  getRegistry = (() => {
    let result: BuildTreeNPMRegistry | undefined;

    let lastCacheKey = ''
    const getCacheKey = () => `${this.options.registryUrl}:${this.options.blocklist}`

    return (): BuildTreeNPMRegistry => {
      const cacheKey = getCacheKey();
      if (!result || lastCacheKey !== cacheKey) {
        const actualRegistry = new NPMRegistry(this.options.registryUrl);
        const isBlocked = listToTestFn(this.options.blocklist);

        lastCacheKey = cacheKey;
        result = {
          getPackageJson: memoAsync(async (packageName, version): Promise<MiniNPM.PackageJsonLike> => {
            // blocklist
            if (isBlocked(packageName)) return {
              name: packageName,
              version,
              dependencies: {},
              dist: { tarball: BLOCKED_TAR_PATH }
            };

            // patch package.json
            let json = await actualRegistry.getPackageJson(packageName, version);
            this.options.packageJsonPatches.forEach(fn => json = fn(json) || json);
            return json;
          }),
          getVersionList: (packageName) => actualRegistry.getVersionList(packageName),
        }
      }

      return result;
    }
  })();

  pourTarball = async (pkg: MiniNPM.PackageJsonLike, destDir: string) => {
    const tarballUrl = pkg.dist?.tarball;
    if (tarballUrl && tarballUrl !== BLOCKED_TAR_PATH) {
      await pourTarball({
        fs: this.fs,
        tarballUrl,
        destDir,
      })
    }

    // TODO: support custom tarball content here.

    // write the patched package.json from the registry
    const json = await this.getRegistry().getPackageJson(pkg.name, pkg.version);
    this.fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(json, null, 2));
  }

  /* c8 ignore stop */

  /**
   * install missing npm packages.
   * 
   * using symlink to save disk space. be careful with bundlers resolving
   * 
   * 1. must call `regenerateLockFile()` before installing
   * 2. use `isAlreadySatisfied()` to avoid unnecessary install
   */
  async install() {
    const { fs } = this
    const baseDir = this.options.nodeModulesDir;
    const storeDir = path.join(baseDir, '.store');
    const hiddenHoistedDir = this.options.shamefullyHoist ? baseDir : path.join(storeDir, 'node_modules');

    const lockFile = await this.readLockFile();
    if (!lockFile) throw new Error('Cannot find lock file. Please call "regenerateLockFile" first.');
    const packagesArray = Object.values(lockFile.packages);

    // empty node_modules/* exclude .store
    // empty hidden hoisted dir
    {
      const list = tryRun(() => fs.readdirSync(baseDir), []);
      for (const name of list) {
        if (name === '.store') continue;
        fs.rmSync(path.join(baseDir, name), { recursive: true, force: true });
      }

      fs.rmSync(hiddenHoistedDir, { recursive: true, force: true });
      fs.mkdirSync(hiddenHoistedDir, { recursive: true });
    }

    // delete unused packages
    {
      const toDeletes = Array.from(this.#packageIdsToDelete);
      this.#packageIdsToDelete.clear();
      for (const id of toDeletes) {
        if (id === ROOT || lockFile.packages[id]) continue; // in use, do not delete
        fs.rmSync(path.join(storeDir, id), { recursive: true, force: true });
      }
    }

    // cleanup `.store/*/node_modules`, pour tarballs
    // existing pkgs will be reused, but its deps will be cleaned up for later linking
    {
      const toDeleteIds = new Set(tryRun(() => fs.readdirSync(storeDir), []).filter(x => x !== LOCK_FILENAME));
      const pourTasks = makeParallelTaskMgr();

      let event: MiniNPM.ProgressEvent = {
        type: 'progress',
        stage: 'install-package',
        packageId: ROOT,
        current: 0,
        total: packagesArray.length - 1, // -1 for root
      }

      for (const pkg of packagesArray) pourTasks.push(() => doPourTask(pkg));
      const doPourTask = async (pkg: MiniNPM.TreeNode) => {
        if (pkg.id === ROOT) return;

        const dir = path.join(storeDir, pkg.id, 'node_modules');  // $ROOT/.store/@lyon/foo@1.0.0/node_modules
        const packageUnzipTo = path.join(dir, pkg.name);      // $ROOT/.store/@lyon/foo@1.0.0/node_modules/@lyon/foo

        toDeleteIds.delete(pkg.id);

        if (fs.existsSync(`${packageUnzipTo}/package.json`)) {
          // already installed
          // remove all dependencies' link for later.

          const [s1, s2] = pkg.name.split('/');
          const links = tryRun(() => fs.readdirSync(dir), []);
          for (const link1 of links) {
            const linkPath = path.join(dir, link1)
            if (link1 === s1) {
              if (s2) {
                // is package name like @lyon/foo
                // dive into and remove other @lyon/*
                const links2 = tryRun(() => fs.readdirSync(linkPath), []);
                for (const link2 of links2) {
                  if (link2 !== s2) fs.unlinkSync(path.join(linkPath, link2));
                }
              }
              // else, package name is merely "foo", no namespace, just skip unlinking
              continue;
            }

            // remove link
            if (link1.startsWith('@')) fs.rmSync(linkPath, { recursive: true, force: true });
            else fs.unlinkSync(linkPath);
          }

          this.events.emit('progress', { ...event });   // reused, but still update progress
          return;
        }
        fs.mkdirSync(packageUnzipTo, { recursive: true });

        try {
          event.packageId = pkg.id;
          this.events.emit('progress', { ...event });
          await this.pourTarball(pkg, packageUnzipTo);
        } finally {
          event.packageId = pkg.id;
          event.current++;
          this.events.emit('progress', { ...event });
        }
      }
      await pourTasks.run(this.options.concurrency);
    }

    // links for hidden hoisted packages
    for (const [pkgName, dependentId] of Object.entries(lockFile.hoisted)) {
      const linkTo = path.join(storeDir, dependentId, 'node_modules', pkgName);
      const linkFrom = path.join(hiddenHoistedDir, pkgName);

      if (pkgName[0] === '@') fs.mkdirSync(path.dirname(linkFrom), { recursive: true });
      fs.symlinkSync(linkTo, linkFrom);
    }

    // all pkgs are ready and dirs are made, create links
    {
      for (const pkg of packagesArray) {
        // assuming current pkg is "vue"
        for (const expr of Object.keys(pkg.dependents)) {
          // depInfo = "@yon/app/vue" or "@yon/app/vue2"
          const [dependentId, dstName] = pathToNpmPackage(expr);

          const linkTo = path.join(storeDir, pkg.id, 'node_modules', pkg.name);
          const linkFrom = dependentId === ROOT ? path.join(baseDir, dstName) : path.join(storeDir, dependentId, 'node_modules', dstName);

          if (dstName[0] === '@') fs.mkdirSync(path.dirname(linkFrom), { recursive: true });
          if (fs.existsSync(linkFrom)) fs.unlinkSync(linkFrom); // about the shamefully-hoisted package
          fs.symlinkSync(linkTo, linkFrom);
        }
      }
    }
  }
}

/* c8 ignore start */
function tryRun<T>(fn: () => T, defaults: T) {
  try {
    return fn();
  } catch {
    return defaults;
  }
}
/* c8 ignore stop */
