import path from "path";
import TarStream from 'tar-stream';
import type { IFs } from "memfs";
import { decodeUTF8, log, makeParallelTaskMgr, memoAsync, toPairs } from "./utils.js";
import semver from "semver";

export namespace MiniNPM {
  export interface Options {
    registryUrl?: string;
    nodeModulesDir?: string;
    cacheDir?: string;
  }

  export interface PkgIndex {
    version: string;
    dependencies: Record<string, string>; // including peerDependencies, only for version checking
  }

  export interface GatheredPackageDep {
    id: string; // name@version
    name: string;
    version: string;
    dependents: Set<string>; // name@version
    dependencies: Record<string, string>; // { name -> resolved version }
    packageJson: any;
  }
}

export class MiniNPM {
  public fs: IFs;
  public options: Required<MiniNPM.Options>;
  public index: Record<string, MiniNPM.PkgIndex[]> = {};

  ROOT = 'ROOT';

  constructor(fs: IFs, options: MiniNPM.Options = {}) {
    this.fs = fs;
    this.options = {
      registryUrl: 'https://registry.npmjs.org',
      // registryUrl: 'https://mirrors.cloud.tencent.com/npm',
      nodeModulesDir: '/node_modules',
      cacheDir: '/tmp/npm-store',
      ...options,
    };
  }

  /**
   * find all dependencies to be installed, in a flat format
   * 
   * in the returned object, there is a `[this.ROOT]` key, which is the root package
   */
  async gatherPackageDepList(rootDependencies: { [name: string]: string }) {
    const ROOT = this.ROOT;
    const requiredPackages: {
      [nameAtVersion: string]: MiniNPM.GatheredPackageDep
    } = {
      [ROOT]: {
        id: ROOT,
        name: ROOT,
        version: '0.0.0',
        dependents: new Set(),
        dependencies: {},
        packageJson: {},
      },
    }

    const parallelTasks = makeParallelTaskMgr()

    const handleDep = async (name: string, versionRange: string, dependentId: string) => {
      const allVersions = await this.getPackageVersions(name);
      const version = allVersions.tags[versionRange] || semver.maxSatisfying(allVersions.versions, versionRange)?.toString()
      if (!version) throw new Error(`No compatible version found for ${name}@${versionRange}`);

      requiredPackages[dependentId]!.dependencies[name] = version;

      const dep = await getDep(name, version);
      dep.dependents.add(dependentId);
    }

    const getDep = memoAsync(async (name: string, version: string) => {
      const packageJson = await this.getPackageJson(name, version);
      const dep: MiniNPM.GatheredPackageDep = {
        id: `${name}@${version}`,
        name,
        version,
        dependents: new Set(),
        dependencies: {},
        packageJson,
      }

      requiredPackages[dep.id] = dep;
      toPairs(packageJson.dependencies).forEach(([name, versionRange]) => {
        parallelTasks.push(() => handleDep(name, versionRange as string, dep.id));
      })
      return dep;
    })

    toPairs(rootDependencies).forEach(([name, versionRange]) => {
      parallelTasks.push(() => handleDep(name, versionRange, ROOT));
    })

    // now run all parallel tasks -- it will generate during work
    await parallelTasks.wait();

    return requiredPackages;
  }

  /**
   * install lots of npm package
   * 
   * using symlink to save disk space. be careful with bundlers resolving
   */
  async install(rootDependencies: { [name: string]: string }) {
    const depFullList = await this.gatherPackageDepList(rootDependencies)

    log('depFullList', depFullList);

    const tasks = makeParallelTaskMgr();

    // build a tree and find out who shall be hoisted (score)
    const ps: {[name: string]: {[id: string]: number}} = {}
    Object.values(depFullList).forEach(dep => {
      if (dep.id === this.ROOT) return;

      const p = ps[dep.name] || (ps[dep.name] = {})
      if (dep.dependents.has(this.ROOT)) p[dep.id] = Infinity;
      else p[dep.id] = (p[dep.id]||0)+ dep.dependents.size;
    })

    const hoisted = new Set<string>();
    Object.values(ps).forEach((p) => {
      // find id with highest score
      let ans='', maxScore=0;
      for (let [id, score] of Object.entries(p)) {
        if (score > maxScore) {
          ans = id;
          maxScore = score;
        }
      }
      hoisted.add(ans);
    })

    // install all packages
    Object.values(depFullList).forEach(dep => {
      if (dep.id === this.ROOT) return;

      tasks.push(async () => {
        const directory = `${this.options.nodeModulesDir}/.store/${dep.id}`;
        await this.pourTarball(dep.packageJson.dist.tarball, directory);

        // then make links to its dependents
        for (const dependent of dep.dependents) {
          const dir2 =
            dependent === this.ROOT
              ? this.options.nodeModulesDir
              : `${this.options.nodeModulesDir}/.store/${dependent}/node_modules`;

          const dest = `${dir2}/${dep.name}`;
          this.fs.mkdirSync(path.dirname(dest), { recursive: true });
          this.fs.symlinkSync(directory, dest);
        }

        // special case: hoisted
        if (hoisted.has(dep.id) && !dep.dependents.has(this.ROOT)) {
          const dir2 = `${this.options.nodeModulesDir}/${dep.name}`;
          this.fs.mkdirSync(path.dirname(dir2), { recursive: true });
          this.fs.symlinkSync(directory, dir2);
        }
      });
    });

    await tasks.wait();

    log('dep installed');
  }

  /**
   * install a npm package
   * 
   * if already installing, return previous promise
   */
  install2 = memoAsync(async (packageName: string) => {
    const directory = `${this.options.nodeModulesDir}/${packageName}`;
    if (this.fs.existsSync(directory)) return;

    const version = (await this.getPackageVersions(packageName)).tags['latest']
    const tarballUrl = await this.getPackageTarballUrl(packageName, version!);

    log('Installing ', packageName)

    const { packageJson } = await this.pourTarball(tarballUrl, directory);
    const index = this.index[packageName] ||= [];
    index.push({
      version: packageJson.version,
      dependencies: {
        ...packageJson.dependencies,
        ...packageJson.peerDependencies,
      },
    })

    log('Installed ', packageName, '@', packageJson.version)

    // auto download dependencies, in parallel
    const deps = Object.keys(packageJson.dependencies || {})
    Array.from({ length: 5 }, async () => {
      while (deps.length) {
        const dep = deps.pop()!
        this.install2(dep);
      }
    })
  });

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

  getPackageVersions = memoAsync(async (packageName: string) => {
    const url = `https://data.jsdelivr.com/v1/package/npm/${packageName}`
    const res = await fetch(url).then(x => x.json());

    return {
      versions: (res.versions || []) as string[],
      tags: (res.tags || {}) as Record<string, string>,
    }
  })

  getPackageVersions2 = memoAsync(async (packageName: string) => {
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

      stream.on('end', () => {
        next();
      });
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
