import path from "path";
import TarStream, { pack } from 'tar-stream';
import type { IFs } from "memfs";
import { chunked, decodeUTF8, log, mapValues, memoAsync } from "./utils.js";
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
}

export class MiniNPM {
  public fs: IFs;
  public options: Required<MiniNPM.Options>;
  public index: Record<string, MiniNPM.PkgIndex[]> = {};

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

  async install(packageNames: string[]) {
    const getPackageMeta = this.getPackageMeta.bind(this);
    class PackageWithVersion {
      id: string;
      dependents: string[] = [];
      dependencies: Record<string, string> = {};

      constructor(public name: string, public version: string) {
        this.id = `${name}@${version}`;
      }
    }

    const requiredPackages = {} as { [name: string]: { [version: string]: PackageWithVersion } };

    // ---- scan dependencies ----

    const ROOT = '<root>@0.0.0';
    const queue = packageNames.map(n => [n, 'latest', [ROOT]] as [name: string, version: string, requiredByTrace: string[]]);
    while (queue.length) {
      const [packageName, versionRangeOrTag, trace] = queue.pop()!;
      log('Scanning ', packageName, '@', versionRangeOrTag, ' from', trace.join(' -> '))

      const dependent = trace[trace.length - 1]!;
      const packageMeta = await getPackageMeta(packageName);
      const versionRange = packageMeta.distTags[versionRangeOrTag]?.version || versionRangeOrTag;
      const compatibleVersion = semver.maxSatisfying(packageMeta.versionList, versionRange);

      if (!compatibleVersion) {
        throw new Error(`No compatible version found for ${packageName}@${versionRangeOrTag}`);
      }
      
      // --- write to dependent's info


      // --- check if new dep is already installed

      const versions = requiredPackages[packageName] ||= {};
      const exists = versions[compatibleVersion];
      if (exists) {
        // already scanned
        exists.dependents.push(dependent)
        continue;
      }

      // add sub-dependencies to queue

      const pkg = new PackageWithVersion(packageName, compatibleVersion);
      versions[compatibleVersion] = pkg;
      pkg.dependents.push(dependent);

      const dependencies = packageMeta.versions[compatibleVersion].dependencies;
      const newPath = [...trace, pkg.id];
      pkg.dependencies = dependencies;
      Object.entries(dependencies).forEach(([name, versionRange]) => {
        queue.push([name, versionRange as string, newPath]);
      })
    }

    // ---- build ideal tree ----
    // TODO:

    debugger;
  }

  /**
   * install a npm package
   * 
   * if already installing, return previous promise
   */
  install2 = memoAsync(async (packageName: string) => {
    const directory = `${this.options.nodeModulesDir}/${packageName}`;
    if (this.fs.existsSync(directory)) return;

    const tarballUrl = (await this.getPackageMeta(packageName)).distTags['latest'].tarball

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

  /**
   * fetch package versions info
   */
  getPackageMeta = memoAsync(async (packageName: string) => {
    // https://registry.npmjs.org/react/
    const packageUrl = `${this.options.registryUrl}/${packageName}/`;
    const registryInfo = await fetch(packageUrl).then(x => x.json());

    const versionList = Object.keys(registryInfo.versions);

    const versions = mapValues(registryInfo.versions, (info: any, version) => ({
      version,
      tarball: info.dist.tarball as string,
      dependencies: info.dependencies || {},
    }))
    const distTags = mapValues(registryInfo['dist-tags'] || {}, (version: string) => (versions[version]));

    return {
      versionList,
      versions,
      distTags,
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
