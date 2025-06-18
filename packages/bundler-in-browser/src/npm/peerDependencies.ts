import { pathToNpmPackage } from "../utils/string.js";
import { type LockFilePackageNode, ROOT } from "./tree.js";

class PeerDepChain {
  /** ["B", "A"] for root -> A -> B -> pkg, if peerDependencies are satisfied since A */
  ancestors: string[] = [];
  unresolved!: Set<string>;
  peerDependencies: {
    [name: string]: {
      sinceAncestorId: string;
      versionRange: string; // from ancestor
    };
  } = {};

  constructor(peerDepNames: Iterable<string>) {
    this.unresolved = new Set(peerDepNames);
  }

  clone() {
    const c = new PeerDepChain(this.unresolved);
    c.ancestors = this.ancestors.slice();
    c.unresolved = new Set(this.unresolved);
    c.peerDependencies = { ...this.peerDependencies }; // no need for deep clone - resolved items will not change
    return c;
  }

  handleAncestor(ancestor: LockFilePackageNode) {
    this.ancestors.push(ancestor.id);
    for (const pkg of this.unresolved) {
      const versionRange = ancestor.dependencies[pkg];
      if (versionRange) {
        this.unresolved.delete(pkg);
        this.peerDependencies[pkg] = {
          sinceAncestorId: ancestor.id,
          versionRange,
        };
      }
    }
  }
}

export interface ResolvePeerDepResult {
  depName: string; // "react"
  missing: boolean;

  paths: string[][]; // [ ["component1@1.0.0", "root"], ["component2@1.0.0", "root"] ]
  providerId: string; // "root"
  versionRange: string; // "^18.0.0" -- from provider
}

/**
 * find all peer dependency chains from a package, by visiting all its ancestor dependents.
 * 
 * note: 
 * - will NOT check resolved peerDependencies' version.
 */
export function resolvePeerDependencies(packages: LockFilePackageNode[], fromId: string): ResolvePeerDepResult[] {
  // from the backward relationship "pkg.dependent", build a forward relationship
  const chains: Array<PeerDepChain> = [];
  const map = new Map<string, LockFilePackageNode>(packages.map(x => [x.id, x]));

  const pkg = map.get(fromId)!;
  const peerDepNames = Object.keys(pkg.peerDependencies || {});
  if (!peerDepNames.length) return [];

  const scanQueue = [new PeerDepChain(peerDepNames)];
  while (scanQueue.length) {
    const chain = scanQueue.shift()!;
    const headPkg = chain.ancestors.length ? map.get(chain.ancestors[chain.ancestors.length - 1]) : pkg;
    
    /* c8 ignore next */
    if (!headPkg) throw new Error(`Cannot find ancestor package for ${chain.ancestors}`);

    const ancestorIds = Object.keys(headPkg.dependents).map(x => pathToNpmPackage(x)[0]);
    for (const ancestorId of ancestorIds) {
      const ancestor = map.get(ancestorId)!;
      const newChain = chain.clone();
      newChain.handleAncestor(ancestor);

      if (newChain.unresolved.size === 0 || ancestorId === ROOT) {
        // all peer dependencies are satisfied
        // or, still missing peer dependencies, but already checked root
        chains.push(newChain);
      } else {
        // still missing peer dependencies, add to queue
        scanQueue.push(newChain);
      }
    }
  }

  // ----------------------------------------------
  // id is "depName~providerId" or "depName~" for missing
  const answerMap: { [id: string]: ResolvePeerDepResult } = {};

  for (const chain of chains) {
    for (const depName of chain.unresolved) {
      answerMap[`${depName}~`] ||= {
        depName,
        missing: true,
        paths: [],
        providerId: '',
        versionRange: '',
      }
    }

    for (const [depName, dep] of Object.entries(chain.peerDependencies)) {
      const providerId = dep.sinceAncestorId

      const key = `${depName}~${providerId}`;
      const out = answerMap[key] ||= {
        depName,
        missing: false,
        paths: [],
        providerId,
        versionRange: dep.versionRange,
      }

      const providerIndex = chain.ancestors.indexOf(providerId);
      out.paths.push(chain.ancestors.slice(0, providerIndex + 1))
    }
  }

  return Object.values(answerMap);
}

