import { describe, it, expect, vi } from 'vitest';
import { buildTree, type BuildTreeNPMRegistry, type NpmTreeNode } from '@/npm/tree.js';

// Mock registry implementation
class MockRegistry implements BuildTreeNPMRegistry {
  public packages: Record<string, {
    tags: { latest: string, [tag: string]: string };
    versions: { [version: string]: any };
  }> =
    {
      'foo': {
        tags: {
          latest: '2.0.0'
        },
        versions: {
          '1.0.0': {
            dependencies: {
              'bar': '^1.0.0'
            }
          },
          '1.1.0': {
            dependencies: {
              'bar': '^1.0.0'
            }
          },
          '2.0.0': {
            dependencies: {
              'bar': '^2.0.0'
            }
          }
        }
      },
      'bar': {
        tags: {
          latest: '2.0.0'
        },
        versions: {
          '1.0.0': {
            dependencies: {}
          },
          '2.0.0': {
            dependencies: {}
          }
        }
      },
      'bar-input': {
        tags: {
          latest: '1.0.0'
        },
        versions: {
          '1.0.0': {
            peerDependencies: {
              'bar': '^2.0.0'
            }
          }
        }
      }
    };

  constructor() {
    this.getVersionList = vi.fn(this.getVersionList.bind(this));
    this.getPackageJson = vi.fn(this.getPackageJson.bind(this));
  }

  async getVersionList(packageName: string) {
    const pkg = this.packages[packageName];
    if (!pkg) throw new Error(`Package ${packageName} not found`);
    return {
      versions: Object.keys(pkg.versions),
      tags: pkg.tags
    };
  }

  async getPackageJson(packageName: string, version: string) {
    const pkg = this.packages[packageName]?.versions[version];
    if (!pkg) throw new Error(`Package ${packageName}@${version} not found`);
    return {
      name: packageName,
      version,
      ...pkg,
      dist: {
        shasum: 'mock-shasum',
        tarball: `mock-tarball-${packageName}-${version}`,
        integrity: 'mock-integrity'
      }
    };
  }
}

describe('npm/buildTree', () => {
  it('should build dependency tree from root package', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^2.0.0'
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    const result = await buildTree({ 'root': rootPackage }, registry);

    expect(result.packages).toHaveLength(3); // root + foo + bar
    expect(result.packages[0]).toBe(rootPackage);
    expect(result.packages.find(p => p.name === 'foo')?.version).toBe('2.0.0');
    expect(result.packages.find(p => p.name === 'bar')?.version).toBe('2.0.0');
  });

  it('should handle multiple versions of the same package, and support npm: protocol', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^2.0.0',
        'foo-old': 'npm:foo@^1.0.0'
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    const result = await buildTree({ 'root': rootPackage }, registry);

    // Should have both versions of foo
    const foo2 = result.packages.find(p => p.id === 'foo@2.0.0')!;
    expect(foo2.name).toBe('foo');
    expect(foo2.version).toBe('2.0.0');
    expect(foo2.dependents).toEqual({ 'root/foo': '^2.0.0' });
    expect(foo2.dependencies).toEqual({ 'bar': '^2.0.0' });

    const foo1 = result.packages.find(p => p.id === 'foo@1.1.0')!;
    expect(foo1.name).toBe('foo');
    expect(foo1.version).toBe('1.1.0');
    expect(foo1.dependents).toEqual({ 'root/foo-old': '^1.0.0' });
    expect(foo1.dependencies).toEqual({ 'bar': '^1.0.0' });

    // Should have both versions of bar as well
    const bar2 = result.packages.find(p => p.id === 'bar@2.0.0')!;
    expect(bar2.name).toBe('bar');
    expect(bar2.version).toBe('2.0.0');
    expect(bar2.dependents).toEqual({ 'foo@2.0.0/bar': '^2.0.0' });

    const bar1 = result.packages.find(p => p.id === 'bar@1.0.0')!;
    expect(bar1.name).toBe('bar');
    expect(bar1.version).toBe('1.0.0');
    expect(bar1.dependents).toEqual({ 'foo@1.1.0/bar': '^1.0.0' });

    // Should have 5 total packages (root + 2 versions of foo + 2 versions of bar)
    expect(result.packages).toHaveLength(5);
  });

  it('should reuse existing packages when possible', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^2.0.0'
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    const existingPackages: Record<string, NpmTreeNode> = {
      'root': rootPackage,
      'foo@2.0.0': {
        id: 'foo@2.0.0',
        name: 'foo',
        version: '2.0.0',
        dependencies: { 'bar': '^2.0.0' },
        dependents: {},
        dist: {
          shasum: 'existing-shasum',
          tarball: 'existing-tarball',
          integrity: 'existing-integrity'
        }
      },
      "bar@2.0.0": {
        id: "bar@2.0.0",
        name: "bar",
        version: "2.0.0",
        dependents: {},
        dependencies: {},
        dist: {
          shasum: "existing-shasum",
          tarball: "existing-tarball",
          integrity: "existing-integrity"
        }
      }
    };

    const result = await buildTree(existingPackages, registry);

    expect(registry.getVersionList).toHaveBeenCalledTimes(0);
    expect(registry.getPackageJson).toHaveBeenCalledTimes(0);

    expect(result.packages.find(p => p.name === 'foo')?.dist.shasum).toBe('existing-shasum');
    expect(result.existingPackagesToRemove).toHaveLength(0);
  });

  it('should handle package upgrades and remove old versions', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^2.0.0'  // Upgraded from ^1.0.0 to ^2.0.0
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    const existingPackages: Record<string, NpmTreeNode> = {
      'root': rootPackage,
      'foo@1.0.0': {
        id: 'foo@1.0.0',
        name: 'foo',
        version: '1.0.0',
        dependencies: { 'bar': '^1.0.0' },
        dependents: {},
        dist: {
          shasum: 'old-shasum',
          tarball: 'old-tarball',
          integrity: 'old-integrity'
        }
      },
      'bar@1.0.0': {
        id: 'bar@1.0.0',
        name: 'bar',
        version: '1.0.0',
        dependencies: {},
        dependents: {},
        dist: {
          shasum: 'old-shasum',
          tarball: 'old-tarball',
          integrity: 'old-integrity'
        }
      }
    };

    const result = await buildTree(existingPackages, registry);

    // Should have installed new versions
    const foo2 = result.packages.find(p => p.id === 'foo@2.0.0')!;
    expect(foo2).toBeDefined();
    expect(foo2.version).toBe('2.0.0');
    expect(foo2.dependencies).toEqual({ 'bar': '^2.0.0' });

    const bar2 = result.packages.find(p => p.id === 'bar@2.0.0')!;
    expect(bar2).toBeDefined();
    expect(bar2.version).toBe('2.0.0');

    // Should mark old versions for removal
    expect(result.existingPackagesToRemove).toContain('foo@1.0.0');
    expect(result.existingPackagesToRemove).toContain('bar@1.0.0');
    expect(result.existingPackagesToRemove).toHaveLength(2);

    // Should have 3 packages in final result (root + foo@2 + bar@2)
    expect(result.packages).toHaveLength(3);

    // Should have queried registry for new versions
    expect(registry.getVersionList).toHaveBeenCalledWith('foo');
    expect(registry.getPackageJson).toHaveBeenCalledWith('foo', '2.0.0');
    expect(registry.getVersionList).toHaveBeenCalledWith('bar');
    expect(registry.getPackageJson).toHaveBeenCalledWith('bar', '2.0.0');
  });

  it('should handle package upgrades including shared dependencies', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^2.0.0',  // Upgraded from ^1.0.0
        'bar': '*'        // Direct dependency on bar, was using bar@1.0.0
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    // Initial state: root depends on foo@^1.0.0 and bar@*, using foo@1.1.0 and bar@1.0.0
    const existingPackages: Record<string, NpmTreeNode> = {
      'root': rootPackage,
      'foo@1.1.0': {
        id: 'foo@1.1.0',
        name: 'foo',
        version: '1.1.0',
        dependencies: { 'bar': '^1.0.0' },
        dependents: {},
        dist: {
          shasum: 'old-foo-shasum',
          tarball: 'old-foo-tarball',
          integrity: 'old-foo-integrity'
        }
      },
      'bar@1.0.0': {
        id: 'bar@1.0.0',
        name: 'bar',
        version: '1.0.0',
        dependencies: {},
        dependents: {
          'root/bar': '*',
          'foo@1.1.0/bar': '^1.0.0'
        },
        dist: {
          shasum: 'old-bar-shasum',
          tarball: 'old-bar-tarball',
          integrity: 'old-bar-integrity'
        }
      }
    };

    const result = await buildTree(existingPackages, registry);

    // Should have installed new versions
    const foo2 = result.packages.find(p => p.id === 'foo@2.0.0')!;
    expect(foo2).toBeDefined();
    expect(foo2.version).toBe('2.0.0');
    expect(foo2.dependencies).toEqual({ 'bar': '^2.0.0' });
    expect(foo2.dependents).toEqual({ 'root/foo': '^2.0.0' });

    const bar2 = result.packages.find(p => p.id === 'bar@2.0.0')!;
    expect(bar2).toBeDefined();
    expect(bar2.version).toBe('2.0.0');
    expect(bar2.dependents).toEqual({
      'root/bar': '*',          // Direct dependency from root
      'foo@2.0.0/bar': '^2.0.0' // Dependency from new foo version
    });

    // Should mark old versions for removal
    expect(result.existingPackagesToRemove).toContain('foo@1.1.0');
    expect(result.existingPackagesToRemove).toContain('bar@1.0.0');
    expect(result.existingPackagesToRemove).toHaveLength(2);

    // Should have 3 packages in final result (root + foo@2 + bar@2)
    expect(result.packages).toHaveLength(3);

    // Should have queried registry for new versions
    expect(registry.getVersionList).toHaveBeenCalledWith('foo');
    expect(registry.getVersionList).toHaveBeenCalledWith('bar');
    expect(registry.getPackageJson).toHaveBeenCalledWith('foo', '2.0.0');
    expect(registry.getPackageJson).toHaveBeenCalledWith('bar', '2.0.0');
  });

  it('should throw error when no compatible version is found', async () => {
    const registry = new MockRegistry();
    const rootPackage: NpmTreeNode = {
      id: 'root',
      name: 'root',
      version: '1.0.0',
      dependencies: {
        'foo': '^3.0.0' // No such version exists in mock registry
      },
      dependents: {},
      dist: { shasum: '', tarball: '', integrity: '' }
    };

    await expect(buildTree({ 'root': rootPackage }, registry))
      .rejects
      .toThrow('No compatible version found');
  });

  describe('peerDependencies', () => {
    it('link peer dependencies', async () => {
      const registry = new MockRegistry();
      const rootPackage: NpmTreeNode = {
        id: 'root',
        name: 'root',
        version: '1.0.0',
        dependencies: {
          'bar': '^2.0.0',
          'bar-input': '^1.0.0'
        },
        dependents: {},
        dist: { shasum: '', tarball: '', integrity: '' }
      };

      const tree = await buildTree({ 'root': rootPackage }, registry);
      expect(tree.peerDepWarnings).toHaveLength(0);
      expect(tree.packages).toHaveLength(3);

      const bar = tree.packages.find(p => p.name === 'bar')!;
      expect(bar.dependents).toEqual({
        'root/bar': '^2.0.0',
        'bar-input@1.0.0/bar': '^2.0.0'
      });
    })

    it('link peer dependencies, warn for bad version', async () => {
      const registry = new MockRegistry();
      const rootPackage: NpmTreeNode = {
        id: 'root',
        name: 'root',
        version: '1.0.0',
        dependencies: {
          'bar': '^1.0.0',
          'bar-input': '^1.0.0'
        },
        dependents: {},
        dist: { shasum: '', tarball: '', integrity: '' }
      };

      const tree = await buildTree({ 'root': rootPackage }, registry);
      expect(tree.peerDepWarnings).toHaveLength(1);
      expect(tree.peerDepWarnings[0]).toEqual({
        reason: 'wrongVersion',
        depName: 'bar',
        fromId: 'bar-input@1.0.0',
        providerIds: ['root'],
        expectedVersionRange: '^2.0.0',
        actualVersion: '1.0.0'
      });

      expect(tree.packages).toHaveLength(3);
      const bar = tree.packages.find(p => p.name === 'bar')!;
      expect(bar.version).toBe('1.0.0');
      expect(bar.dependents).toEqual({
        'root/bar': '^1.0.0',
        'bar-input@1.0.0/bar': '^2.0.0'
      });
    })

    it.each([true, false])('missing peer dependencies (optional: %s)', async (isOptional) => {
      const registry = new MockRegistry();
      if (isOptional) {
        registry.packages['bar-input'].versions['1.0.0'].peerDependenciesMeta = { 'bar': { optional: true } };
      }

      const rootPackage: NpmTreeNode = {
        id: 'root',
        name: 'root',
        version: '1.0.0',
        dependencies: {
          'bar-input': '^1.0.0'
        },
        dependents: {},
        dist: { shasum: '', tarball: '', integrity: '' }
      };

      const tree = await buildTree({ 'root': rootPackage }, registry);
      if (isOptional) {
        expect(tree.peerDepWarnings).toHaveLength(0);
      } else {
        expect(tree.peerDepWarnings).toHaveLength(1);
        expect(tree.peerDepWarnings[0]).toEqual({ reason: 'missing', depName: 'bar', fromId: 'bar-input@1.0.0' });
      }
      expect(tree.packages).toHaveLength(2);
    })

    it('reuse same actual peer dependency', async () => {

      // root
      //   ├─ bar@2.0.0
      //   ├─ bar-input@1.0.0  (peerDeps: bar)
      //   └─ my-app@1.0.0
      //       ├─ bar-input@*  (peerDeps: bar)
      //       └─ bar@2.0.0    (shall be decoupled)

      const registry = new MockRegistry();
      registry.packages['my-app'] = {
        tags: { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            dependencies: {
              'bar-input': '*',
              'bar': '^2.0.0'
            }
          }
        },
      }
      const rootPackage: NpmTreeNode = {
        id: 'root',
        name: 'root',
        version: '1.0.0',
        dependencies: {
          'bar': '^2.0.0',
          'bar-input': '^1.0.0',
          'my-app': '^1.0.0'
        },
        dependents: {},
        dist: { shasum: '', tarball: '', integrity: '' }
      };

      const tree = await buildTree({ 'root': rootPackage }, registry);
      expect(tree.peerDepWarnings).toHaveLength(0);

      expect(tree.packages).toHaveLength(4);
      const bar = tree.packages.find(p => p.name === 'bar')!;
      expect(bar.dependents).toEqual({
        'root/bar': '^2.0.0',
        'bar-input@1.0.0/bar': '^2.0.0',
        'my-app@1.0.0/bar': '^2.0.0'
      });
    });
  });
});