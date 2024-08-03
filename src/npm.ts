import path from "path";
import TarStream from 'tar-stream';
import type { IFs } from "memfs";
import { decodeUTF8, log, makeParallelTaskMgr, memoAsync, toPairs } from "./utils.js";
import semver from "semver";
import mitt from "mitt";

export namespace MiniNPM {
  export interface Options {
    registryUrl?: string;
    nodeModulesDir?: string;
    useJSDelivrToQueryVersions?: boolean;
    concurrency?: number;
  }

  export interface PkgIndex {
    version: string;
    dependencies: Record<string, string>; // including peerDependencies, only for version checking
  }

  export interface GatheredPackageDep {
    id: string; // name@version
    name: string;
    version: string;
    dependents: Record<string, string>; // { "name@version": "versionRange" }
    dependencies: Record<string, string>; // { "name": "versionRange" }
    peerDependencies?: Record<string, string>; // { "name": "versionRange" } 

    dist: {
      shasum: string;
      tarball: string;
      integrity: string;
    }
  }

  export interface LockFile {
    packages: {
      [nameAtVersion: string]: MiniNPM.GatheredPackageDep;
    }
    hoisted: string[];
  }

  export interface ProgressEvent {
    type: 'progress';
    stage: 'fetch-metadata' | 'install-package';
    packageId: string;
    dependentId?: string;
    current: number;
    total: number;
  }
}

export class MiniNPM {
  public fs: IFs;
  public options: Required<MiniNPM.Options>;
  public index: Record<string, MiniNPM.PkgIndex[]> = {};

  public events = mitt<{
    'progress': MiniNPM.ProgressEvent;
  }>()

  ROOT = 'ROOT';

  constructor(fs: IFs, options: MiniNPM.Options = {}) {
    this.fs = fs;
    this.options = {
      registryUrl: 'https://registry.npmjs.org',
      // registryUrl: 'https://mirrors.cloud.tencent.com/npm',
      nodeModulesDir: '/node_modules',
      useJSDelivrToQueryVersions: true,
      concurrency: 5,
      ...options,
    };
  }

  /**
   * find all dependencies to be installed, in a flat format
   * 
   * in the returned object, there is a `[this.ROOT]` key, which is the root package
   */
  async gatherPackagesToInstall(
    rootDependencies: { [name: string]: string },
    prevResult?: MiniNPM.LockFile['packages']
  ) {
    const ROOT = this.ROOT;
    const requiredPackages: MiniNPM.LockFile['packages'] = {
      [ROOT]: {
        id: ROOT,
        name: ROOT,
        version: '0.0.0',
        dependents: {},
        dependencies: { ...rootDependencies },
        dist: {} as any,
      },
    }

    const installedLUT: { [name: string]: { [version: string]: MiniNPM.GatheredPackageDep } } = {};
    prevResult && Object.values(prevResult).forEach(dep => {
      if (dep.id === ROOT) return;
      (installedLUT[dep.name] ||= {})[dep.version] = dep;
    })

    const parallelTasks = makeParallelTaskMgr()
    let total = 0, current = 0;

    const cachedSemverResult = {} as Record<string, string | null>; // { "foobar@^1.2.3": "1.3.0" }

    const handleDep = async (name: string, versionRange: string, dependentId: string) => {
      const event: MiniNPM.ProgressEvent = {
        type: 'progress',
        stage: 'fetch-metadata',
        packageId: `${name}@${versionRange}`,
        dependentId,
        current: current,
        total: ++total,
      }
      this.events.emit('progress', event);

      const version = cachedSemverResult[`${name}@${versionRange}`] ||= await (async () => {
        const installedVersions = installedLUT[name]
        const exist = (installedVersions && semver.maxSatisfying(Object.keys(installedVersions), versionRange))
        if (exist) return exist;

        const allVersions = await this.getPackageVersions(name);
        const ret = allVersions.tags[versionRange] || semver.maxSatisfying(allVersions.versions, versionRange)
        if (!ret) return null; // not found

        // double check: if prev installed "foo@2.6.0" (required via "foo@^2.0.0"),
        // but now we met "foo@^2.7.0", then check whether "foo@2.6.0" shall be removed by validating its dependents shall move to "foo@2.7.0"
        // ( by validating all dependents )
        // note: `ret >= exist`
        if (installedVersions) {
          Object.values(installedVersions).forEach(dep => {
            if (!requiredPackages[dep.id]) return; // this pre-installed package is not required in current session

            // this package reused, check whether it can be taken away

            let killed = 0;
            const dependents = toPairs(dep.dependents);
            dependents.forEach(([dependentId, versionRange]) => {
              if (!semver.satisfies(ret, versionRange)) return;

              // heck! need move to `ret`
              delete dep.dependents[dependentId];
              killed++;
            })

            if (killed === dependents.length) {
              // none needs it anymore, remove it
              getDep.remove(name, dep.version);
              delete requiredPackages[dep.id]; // side effect of `getDep` 
            }
          })
        }

        return ret;
      })();

      if (!version) throw new Error(`No compatible version found for ${name}@${versionRange}`);

      const dep = await getDep(name, version);
      dep.dependents[dependentId] = versionRange;

      this.events.emit('progress', {
        ...event,
        current: ++current,
        total,
      })
    }

    const getDep = memoAsync(async (name: string, version: string) => {
      let dep: MiniNPM.GatheredPackageDep;

      const prev = prevResult?.[`${name}@${version}`];
      if (prev) {
        dep = {
          ...prev,
          dependents: {}, // will br rebuilt
        }
      } else {
        const packageJson = await this.getPackageJson(name, version);
        dep = {
          id: `${name}@${version}`,
          name,
          version,
          dependents: {},
          dependencies: packageJson.dependencies || {},
          peerDependencies: packageJson.peerDependencies,
          dist: packageJson.dist,
        }
      }

      requiredPackages[dep.id] = dep;
      toPairs(dep.dependencies).forEach(([name, versionRange]) => {
        parallelTasks.push(() => handleDep(name, versionRange as string, dep.id));
      })
      return dep;
    })

    toPairs(rootDependencies).forEach(([name, versionRange]) => {
      parallelTasks.push(() => handleDep(name, versionRange, ROOT));
    })

    // now run all parallel tasks -- it will generate during work
    await parallelTasks.wait(this.options.concurrency);

    return {
      requiredPackages,
      reusedInstalledIds: new Set(prevResult ? Object.keys(prevResult).filter(id => requiredPackages[id]) : []),
    };
  }

  async getHoistedPackages(depFullList: Record<string, MiniNPM.GatheredPackageDep>) {
    const ps: { [name: string]: { [id: string]: number } } = {}
    Object.values(depFullList).forEach(dep => {
      if (dep.id === this.ROOT) return;

      const p = ps[dep.name] || (ps[dep.name] = {})
      if (this.ROOT in dep.dependents) p[dep.id] = Infinity;
      else p[dep.id] = (p[dep.id] || 0) + Object.keys(dep.dependents).length;
    })

    const hoisted = new Set<string>();
    Object.values(ps).forEach((p) => {
      // find id with highest score
      let ans = '', maxScore = 0;
      for (let [id, score] of Object.entries(p)) {
        if (score > maxScore) {
          ans = id;
          maxScore = score;
        }
      }
      hoisted.add(ans);
    })

    return { hoisted };
  }

  getLockFilePath() {
    return path.join(this.options.nodeModulesDir, '.store', 'lock.json');
  }

  async readLockFile() {
    const lockFilePath = this.getLockFilePath();
    return new Promise<MiniNPM.LockFile | null>((resolve) => {
      this.fs.readFile(lockFilePath, 'utf8', (err, data) => {
        if (err) return resolve(null);

        try {
          const out = JSON.parse(data as string) as MiniNPM.LockFile;
          resolve(out);
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  async writeLockFile(lockFile: MiniNPM.LockFile) {
    const lockFilePath = this.getLockFilePath();
    return new Promise<void>((resolve) => {
      this.fs.writeFile(lockFilePath, JSON.stringify(lockFile, null, 2), () => {
        // if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * install lots of npm package
   * 
   * using symlink to save disk space. be careful with bundlers resolving
   */
  async install(rootDependencies: { [name: string]: string }) {
    const prevLockFile = await this.readLockFile();
    const tasks = makeParallelTaskMgr();

    const { requiredPackages, reusedInstalledIds } = await this.gatherPackagesToInstall(rootDependencies, prevLockFile?.packages);

    log('requiredPackages', requiredPackages);

    // remove previous installed packages, if not reused
    if (prevLockFile) {
      const prevHoisted = new Set(prevLockFile.hoisted);
      for (const [id, dep] of Object.entries(prevLockFile.packages)) {
        if (dep.id === this.ROOT) continue;

        // 1. always reset "hoisted"
        if (prevHoisted.has(id)) this.fs.rmSync(`${this.options.nodeModulesDir}/${dep.name}`, { force: true }) // remove symlink

        // 2. clean up node_modules
        const storePath = `${this.options.nodeModulesDir}/.store/${id}`;
        if (reusedInstalledIds.has(id)) {
          this.fs.rmSync(`${storePath}/node_modules`, { recursive: true, force: true }); // will be rebuilt later
        } else {
          this.fs.rmSync(storePath, { recursive: true, force: true }) // package not reused, remove whole directory
        }
      }
    }

    // build a tree and find out who shall be hoisted (score)
    const { hoisted } = await this.getHoistedPackages(requiredPackages);

    // install all packages into `${nodeModulesDir}/.store`
    // meanwhile,
    //   1. create symlinks to its dependents;
    //   2. create symlinks to `${nodeModulesDir}` if is Root's dependent, or can be hoisted

    let current = 0;
    let event: MiniNPM.ProgressEvent = {
      type: 'progress',
      stage: 'install-package',
      packageId: this.ROOT,
      current: 0,
      total: Object.keys(requiredPackages).length - 1, // -1 for root
    }

    Object.values(requiredPackages).forEach(dep => {
      if (dep.id === this.ROOT) return;

      tasks.push(async () => {
        const directory = `${this.options.nodeModulesDir}/.store/${dep.id}`;

        if (!reusedInstalledIds.has(dep.id)) {
          // new package, need to download
          // (note: in previous progress, existing packages' node_modules was cleaned up)
          await this.pourTarball(dep.dist.tarball, directory);
        }

        // then make links to its dependents
        for (const dependent of Object.keys(dep.dependents)) {
          if (dependent === this.ROOT) continue; // root's dependents is always hoisted later.

          const dest = `${this.options.nodeModulesDir}/.store/${dependent}/node_modules/${dep.name}`;
          this.fs.mkdirSync(path.dirname(dest), { recursive: true });
          this.fs.symlinkSync(directory, dest);
        }

        // hoist to `${nodeModulesDir}` if is root's dependent, or can be hoisted
        if (hoisted.has(dep.id)) {
          const dest = `${this.options.nodeModulesDir}/${dep.name}`;
          this.fs.mkdirSync(path.dirname(dest), { recursive: true });
          this.fs.symlinkSync(directory, dest);
        }

        this.events.emit('progress', {
          ...event,
          packageId: dep.id,
          current: ++current,
          // total is not changed
        })
      });
    });

    await tasks.wait(this.options.concurrency);

    log('dep installed');

    await this.writeLockFile({
      hoisted: Array.from(hoisted),
      packages: requiredPackages,
    })
  }

  getPackageTarballUrl = async (packageName: string, version: string) => {
    const packageJson = await this.getPackageJson(packageName, version);
    return packageJson.dist.tarball;
    // return `${this.options.registryUrl}/${packageName}/-/${packageName}-${version}.tgz`;
  }

  getPackageJson = memoAsync(async (packageName: string, version: string) => {
    const url = `${this.options.registryUrl}/${packageName}/${version}`;
    const res = await fetch(url).then(x => x.json());

    return {
      dependencies: {},
      ...res,
    };
  })

  getPackageVersions(packageName: string): Promise<{
    versions: string[];
    tags: Record<string, string>;
  }> {
    const handler =
      this.options.useJSDelivrToQueryVersions
        ? this.getPackageVersionsWithJSDelivr
        : this.getPackageVersionsWithRegistry

    return handler(packageName);
  }

  getPackageVersionsWithJSDelivr = memoAsync(async (packageName: string) => {
    const url = `https://data.jsdelivr.com/v1/package/npm/${packageName}`
    const res = await fetch(url).then(x => x.json());

    return {
      versions: (res.versions || []) as string[],
      tags: (res.tags || {}) as Record<string, string>,
    }
  })

  getPackageVersionsWithRegistry = memoAsync(async (packageName: string) => {
    // https://registry.npmjs.org/react/
    const packageUrl = `${this.options.registryUrl}/${packageName}/`;
    const registryInfo = await fetch(packageUrl).then(x => x.json());
    const versions = Object.keys(registryInfo.versions);

    return {
      versions,
      tags: (registryInfo['dist-tags'] || {}) as Record<string, string>,
    }
  })

  /**
   * internal method: download a tarball and extract it to a directory
   */
  async pourTarball(tarballUrl: string, destDir: string) {
    const { fs } = this;

    if (!destDir.endsWith('/')) destDir += '/';
    let inflated: Uint8Array;
    let packageJson: any;

    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream("gzip");
      inflated = new Uint8Array(await new Response((await fetch(tarballUrl)).body?.pipeThrough(ds)).arrayBuffer())
    } else {
      const pako = await import('pako');
      const tarball = await fetch(tarballUrl).then(x => x.arrayBuffer());
      inflated = pako.ungzip(new Uint8Array(tarball))
    }

    const tar = TarStream.extract();
    let accOffset = 0;
    tar.on('entry', (header, stream, next) => {
      const dataOffset = accOffset + 512; // tar header size

      {
        // Calculate the next file's offset
        const blockSize = 512;
        const fileBlocks = Math.ceil((header.size || 0) / blockSize);
        accOffset += (fileBlocks + 1) * blockSize; // +1 for the header block
      }

      const fileName = header.name.replace(/^package\//, destDir);

      if (fileName.endsWith('/')) {
        fs.mkdir(fileName, { recursive: true }, next);
        return;
      }

      // make dir recrusive
      fs.mkdirSync(path.dirname(fileName), { recursive: true });

      const data = inflated.slice(dataOffset, dataOffset + header.size!);
      fs.writeFileSync(fileName, data);
      if (header.name === 'package/package.json') packageJson = JSON.parse(decodeUTF8(data));

      stream.on('end', () => Promise.resolve().then(next))
      stream.resume();
    });

    await new Promise((resolve, reject) => {
      tar.on('finish', resolve);
      tar.on('error', reject);
      tar.end(inflated);
    });

    return {
      packageJson,
    }
  }
}
