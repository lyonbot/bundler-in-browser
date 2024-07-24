import path from "path";
import TarStream from 'tar-stream';
import type { IFs } from "memfs";
import { chunked, decodeUTF8, memoAsync } from "./utils.js";

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

  /**
   * install a npm package
   * 
   * if already installing, return previous promise
   */
  install = memoAsync(async (packageName: string) => {
    const directory = `${this.options.nodeModulesDir}/${packageName}`;
    if (this.fs.existsSync(directory)) return;

    const tarballUrl = (await this.getPackageVersions(packageName)).distTags['latest'];

    const { packageJson } = await this.pourTarball(tarballUrl, directory);
    const index = this.index[packageName] ||= [];
    index.push({
      version: packageJson.version,
      dependencies: {
        ...packageJson.dependencies,
        ...packageJson.peerDependencies,
      },
    })

    // auto download dependencies, in parallel
    const deps = Object.keys(packageJson.dependencies || {})
    Array.from({ length: 5 }, async () => {
      while (deps.length) {
        const dep = deps.pop()!
        this.install(dep);
      }
    })
  });

  /**
   * fetch package versions info
   */
  getPackageVersions = memoAsync(async (packageName: string) => {
    // https://registry.npmjs.org/react/
    const packageUrl = `${this.options.registryUrl}/${packageName}/`;
    const registryInfo = await fetch(packageUrl).then(x => x.json());

    // { [version]: url }
    const versionLinks = Object.fromEntries(Object.entries(registryInfo.versions).map(([version, info]) => [version, (info as any).dist.tarball]));
    const distTags = Object.fromEntries(Object.entries(registryInfo['dist-tags'] || {}).map(([tag, version]) => [tag, versionLinks[version as string]]));

    return {
      versionLinks,
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
