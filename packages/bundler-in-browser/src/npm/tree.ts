import { gte, maxSatisfying, satisfies } from "semver";
import { makeParallelTaskMgr } from "../parallelTask.js";
import { memoAsync } from "../utils/memoAsync.js";
import { groupBy, isEmpty, isNotEmpty } from "../utils/misc.js";
import { pathToNpmPackage, separateNpmPackageNameVersion } from "../utils/string.js";
import { resolvePeerDependencies } from "./peerDependencies.js";

export interface BuildTreeNPMRegistry {
  /** query package version list. might be call multiple times, so please cache the result */
  getVersionList(packageName: string): Promise<{
    versions: string[];
    tags: Record<string, string>;
  }>

  /** query a package.json. if not exist, throw an error */
  getPackageJson(packageName: string, version: string): Promise<any>;
}

export type PeerDepWarning
  = { reason: 'missing', depName: string, fromId: string }
  | { reason: 'wrongVersion', depName: string, fromId: string, providerIds: string[], expectedVersionRange: string, actualVersion: string }

export interface LockFilePackageNode {
  id: string;
  name: string;
  version: string;

  /** `{ "dependentName@version/dstName": "versionRange" }` */
  dependents: Record<string, string>;

  dependencies: Record<string, string>; // { "name": "rawVersionRange" }
  peerDependencies?: Record<string, string>; // { "name": "rawVersionRange" }
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;

  peerDependenciesLinked?: boolean;

  // rawVersionRange is like "^1.2.3" or "npm:foo@^1.2.3"
  // but versionRange doesn't contain protocol prefix.

  dist: {   // not available for root
    shasum: string;
    tarball: string;
    integrity: string;
  }
}

export const ROOT = 'root'

/**
 * build a tree of packages, which is used for installing.
 * 
 * @param existingPackages - at least contains "root" node. existing packages might be reused.
 * @param registry 
 */
export async function buildTree(
  existingPackages: Record<string, LockFilePackageNode>,
  registry: BuildTreeNPMRegistry,
  options: {
    onProgress?(e: { packageId: string, current: number, total: number }): void;
  } = {}
) {
  const originalRoot = existingPackages[ROOT];
  /* c8 ignore next */
  if (!originalRoot) throw new Error(`Cannot find root node`);

  // tree node controller
  const nodesWithDependents = new Map<string, LockFilePackageNode>();
  const preferVersions = {} as Record<string, string[]>; // previously-installed or now-with-dependents. prefer to use them. eg. { "foo": ["1.0.0", "2.0.0"] }
  const getPackageNodeCtrl = memoAsync(async (name: string, version: string) => {
    const json = name === ROOT
      ? originalRoot
      : (existingPackages[`${name}@${version}`] || await registry.getPackageJson(name, version));

    const node: LockFilePackageNode = {
      id: name === ROOT ? ROOT : `${name}@${version}`,
      name,
      version,
      dependents: {}, // should be filled later in `visit`
      dependencies: json.dependencies || {},
      peerDependencies: json.peerDependencies,
      peerDependenciesMeta: json.peerDependenciesMeta,
      dist: json.dist,
    }
    const stdDepList = toStdDepList(json.dependencies);
    const stdPeerDepList = toStdDepList(json.peerDependencies);

    return {
      node,
      stdDepList,
      stdPeerDepList,
      visited: false,
      addDependent(dependentId: string, versionRange: string, dstName: string) {
        node.dependents[`${dependentId}/${dstName}`] = versionRange;
        if (!nodesWithDependents.has(node.id)) {
          nodesWithDependents.set(node.id, node);
          const versionsArr = (preferVersions[node.name] ||= []);
          versionsArr.push(node.version);

          // double check: if prev installed "foo@2.6.0" (required via "foo@^2.0.0"),
          // but now we met "foo@^2.7.0", then check whether "foo@2.6.0" shall be removed by validating its dependents shall move to "foo@2.7.0"

          const ver = node.version
          for (const anotherVer of versionsArr) {
            const n2 = nodesWithDependents.get(`${node.name}@${anotherVer}`);
            if (!n2) continue; // maybe just a previously installed version, not relied in new tree

            if (anotherVer === ver || gte(anotherVer, ver)) continue;
            for (const [path, versionRange] of Object.entries(n2.dependents)) {
              if (satisfies(ver, versionRange)) {
                // this dependent can update to use current version!
                node.dependents[path] = versionRange;
                delete n2.dependents[path];
              }
            }
            if (isEmpty(n2.dependents)) nodesWithDependents.delete(n2.id);
          }
        }
      },
    }
  });

  // if package already exists, it might be reused later
  // add it to `preferVersions`
  for (const pkg of Object.values(existingPackages)) {
    if (pkg.id === ROOT) continue;
    const array = preferVersions[pkg.name] = preferVersions[pkg.name] || [];
    array.push(pkg.version);
  }

  // build tree
  let taskCount = 1, doneTaskCount = 0;
  const taskRunner = makeParallelTaskMgr();
  taskRunner.push(() => visit(ROOT, ''));
  await taskRunner.run(5);

  async function visit(name: string, version: string) {
    options.onProgress?.({ packageId: name, current: doneTaskCount++, total: taskCount });

    const pkg = await getPackageNodeCtrl(name, version);
    if (pkg.node.id !== ROOT && isEmpty(pkg.node.dependents)) return;
    if (pkg.visited) return;
    pkg.visited = true;

    await Promise.all(pkg.stdDepList.map(async dep => {
      const { name, dstName, versionRange } = dep;
      let ver: string | null | undefined;

      // 1. maybe a installed or referenced version can be used too?
      const fromPrefer = preferVersions[name] && maxSatisfying(preferVersions[name], versionRange);
      if (fromPrefer) {
        ver = fromPrefer;
      } else {
        // 2. query from registry
        const allVersions = await registry.getVersionList(name);
        ver = allVersions.tags[versionRange] || maxSatisfying(allVersions.versions, versionRange);
      }
      if (!ver) throw new Error(`No compatible version found for ${name}@${versionRange}. required by ${pkg.node.id}`);

      const n = await getPackageNodeCtrl(name, ver);
      n.addDependent(pkg.node.id, versionRange, dstName);
      taskRunner.push(() => visit(name, ver));
      taskCount++;
    }))
  }

  // ----------------------------------------------
  // now answer is `nodesWithDependents`

  const packagesMap = new Map([originalRoot, ...nodesWithDependents.values()].map(x => [x.id, x]));
  const existingPackagesToRemove = Array.from(Object.keys(existingPackages)).filter(id => {
    if (id === ROOT) return false;
    if (!nodesWithDependents.has(id)) return true;
    return false;
  });

  const peerDepWarnings: Array<PeerDepWarning> = [];
  for (let retry = packagesMap.size * 5; retry--;) {
    const packages = Array.from(packagesMap.values());
    const pkg = packages.find(it => (!it.peerDependenciesLinked && isNotEmpty(it.peerDependencies)))
    if (!pkg) break;

    const peerDepsRaw = resolvePeerDependencies(packages, pkg.id);

    // although have different providerId, the actual peerDep may point to the same version + same id 
    // group by actual package id of peerDep, like `react/react@18.2.0` or `?react` for missing
    const peerDepsMap = groupBy(peerDepsRaw, x => {
      const { depName, providerId } = x;
      if (x.missing) return `?${depName}`;

      const resolvedPkg = packages.find(p => p.dependents[`${providerId}/${depName}`]);
      if (!resolvedPkg) throw new Error(`Cannot find package ${depName} for ${providerId}`);

      return `${x.depName}/${resolvedPkg.id}`;
    });

    if (Object.keys(peerDepsMap).length > 1) {
      // FIXME: maybe someday implement mechanism like pnpm's `webpack-cli@4.10.0~webpack@5.73.0`
      // but changing id and duplicating pkgs is kind difficult, so maybe do it someday

      console.warn(`Yet not implemented: multiple peer dependencies version!`);
      // throw new Error(`Yet not implemented: multiple peer dependencies version!`);
    }

    const k = Object.keys(peerDepsMap)[0];
    const chains = peerDepsMap[k]!;
    if (!k) throw new Error(`Cannot find peer dependencies for ${pkg.id}`);

    if (k.startsWith('?')) {
      // k = `?react`
      // missing peer dependency, might need a warning
      const depName = k.slice(1);
      const isOptional = pkg.peerDependenciesMeta?.[depName]?.optional;
      if (!isOptional) peerDepWarnings.push({ reason: 'missing', depName, fromId: pkg.id });
      // mark handled
      pkg.peerDependenciesLinked = true;
    } else {
      // k = `react/react@18.2.0`
      const [depName, depId] = pathToNpmPackage(k);
      const dep = packagesMap.get(depId)!;

      // need to revalidate version, warn if not satisfies
      const expectedVersionRange = pkg.peerDependencies![depName];
      if (!satisfies(dep.version, expectedVersionRange)) {
        peerDepWarnings.push({
          reason: 'wrongVersion',
          depName,
          fromId: pkg.id,
          providerIds: chains.map(x => x.providerId),
          expectedVersionRange,
          actualVersion: dep.version,
        });
      }

      // then link
      dep.dependents[`${pkg.id}/${depName}`] = expectedVersionRange;
      pkg.peerDependenciesLinked = true;
    }
  }

  return {
    /** 
     * root package and third-party packages needs to install, and where they shall be linked by
     */
    packages: [...packagesMap.values()],

    /**
     * these packages are no longer needed
     */
    existingPackagesToRemove,

    peerDepWarnings,
  }
}

/**
 * handle weird situation like `vue2: "npm:vue@^2.6.0"` and some unsupported version range protocol.
 */
function versionRangeStandardize(name: string, versionRange: string): [name: string, versionRange: string] {
  if (versionRange.startsWith('npm:')) {
    [name, versionRange] = separateNpmPackageNameVersion(versionRange.slice(4));
  } else if (/^[\w-]+:/.test(versionRange)) {
    throw new Error(`unsupported version range: ${versionRange}`);
  }
  return [name, versionRange]
}

function toStdDepList(dependencies: Record<string, string> | null | undefined) {
  if (!dependencies) return [];

  const results: { name: string, dstName: string, versionRange: string }[] = [];
  for (let [name, versionRange] of Object.entries(dependencies)) {
    const dstName = name;
    [name, versionRange] = versionRangeStandardize(name, versionRange);
    results.push({ name, dstName, versionRange });
  }
  return results;
}
