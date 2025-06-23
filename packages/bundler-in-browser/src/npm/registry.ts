import { memoAsync } from "../utils/memoAsync.js";
import type { BuildTreeNPMRegistry } from "./tree.js";

export class NPMRegistry implements BuildTreeNPMRegistry {
  registryUrl: string;

  constructor(registryUrl: string) {
    this.registryUrl = registryUrl || 'https://registry.npmjs.org';
  }

  /**
   * fetch package info from standard npm registry.
   * 
   * it contains versions and tags, and all package.json for each version.
   */
  queryPackage = memoAsync(async (packageName: string) => {
    const url = `${this.registryUrl}/${packageName}/`;
    const res = await fetch(url).then(x => x.json());
    const versions = Object.keys(res.versions || {});
    if (!versions.length) throw new Error(`No versions found for ${packageName}`);

    return res;
  });

  /**
   * get package.json of a specific version
   * 
   * note: this will contains `dist: { tarball, shasum, integrity }` field
   */
  getPackageJson = async (packageName: string, version: string) => {
    // npm registry already ship 
    // const url = `${this.registryUrl}/${packageName}/${version}`;
    // const res = await fetch(url).then(x => x.json());
    const res = await this.queryPackage(packageName);
    const packageJson = res.versions[version];
    if (!packageJson) throw new Error(`No package.json found for ${packageName}@${version}`);
    return packageJson;
  };

  /**
   * get version and tag list of a package
   */
  getVersionList = memoAsync(async (packageName: string) => {
    const registryInfo = await this.queryPackage(packageName);
    const versions = Object.keys(registryInfo.versions);

    return {
      versions,
      tags: (registryInfo['dist-tags'] || {}) as Record<string, string>,
    }
  });
}
