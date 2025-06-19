import { describe, it, expect } from 'vitest';
import { resolvePeerDependencies } from '@/npm/peerDependencies.js';
import { type NpmTreeNode, ROOT } from '@/npm/tree.js';

describe('npm/peerDependencies', () => {
  function createMockPackage(
    id: string,
    name: string,
    version: string,
    options: {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      dependents?: Record<string, string>;
    } = {}
  ): NpmTreeNode {
    return {
      id,
      name,
      version,
      dependencies: options.dependencies || {},
      peerDependencies: options.peerDependencies,
      dependents: options.dependents || {},
      dist: {
        shasum: 'mock-shasum',
        tarball: `mock-tarball-${name}-${version}`,
        integrity: 'mock-integrity'
      }
    };
  }

  it('should find peer dependency chains when all peer deps are satisfied', () => {
    //  root
    //   ├─ react
    //   └─ app-component
    //       ├─ react
    //       └─ ui-lib  (peerDeps: react)

    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'app-component': '^1.0.0'
        }
      }),
      createMockPackage('react@18.2.0', 'react', '18.2.0', {
        dependents: {
          'root/react': '^18.0.0',
          'app-component@1.0.0/react': '^18.0.0'
        }
      }),
      createMockPackage('app-component@1.0.0', 'app-component', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'ui-lib': '^1.0.0'
        },
        dependents: {
          'root/app-component': '^1.0.0'
        }
      }),
      createMockPackage('ui-lib@1.0.0', 'ui-lib', '1.0.0', {
        peerDependencies: {
          'react': '^18.0.0'
        },
        dependents: {
          'app-component@1.0.0/ui-lib': '^1.0.0'
        }
      })
    ];

    const result = resolvePeerDependencies(packages, 'ui-lib@1.0.0');
    expect(result.length).toBe(1);
    expect(result[0]).toMatchInlineSnapshot(`
      {
        "depName": "react",
        "missing": false,
        "paths": [
          [
            "app-component@1.0.0",
          ],
        ],
        "providerId": "app-component@1.0.0",
        "versionRange": "^18.0.0",
      }
    `)
  });

  it('should find multiple peer dependency chains', () => {

    //  root
    //   ├─ react
    //   ├─ vue
    //   ├─ component-a
    //   │   ├─ react
    //   │   └─ shared-lib (peerDeps: react, vue)
    //   └─ component-b
    //       ├─ vue
    //       └─ shared-lib (peerDeps: vue, react)

    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'vue': '^3.0.0',
          'component-a': '^1.0.0',
          'component-b': '^1.0.0'
        }
      }),
      createMockPackage('react@18.2.0', 'react', '18.2.0', {
        dependents: {
          'root/react': '^18.0.0',
          'component-a@1.0.0/react': '^18.0.0'
        }
      }),
      createMockPackage('vue@3.3.0', 'vue', '3.3.0', {
        dependents: {
          'root/vue': '^3.0.0',
          'component-b@1.0.0/vue': '^3.0.0'
        }
      }),
      createMockPackage('component-a@1.0.0', 'component-a', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'shared-lib': '^1.0.0'
        },
        dependents: {
          'root/component-a': '^1.0.0'
        }
      }),
      createMockPackage('component-b@1.0.0', 'component-b', '1.0.0', {
        dependencies: {
          'vue': '^3.0.0',
          'shared-lib': '^1.0.0'
        },
        dependents: {
          'root/component-b': '^1.0.0'
        }
      }),
      createMockPackage('shared-lib@1.0.0', 'shared-lib', '1.0.0', {
        peerDependencies: {
          'react': '^18.0.0',
          'vue': '^3.0.0'
        },
        dependents: {
          'component-a@1.0.0/shared-lib': '^1.0.0',
          'component-b@1.0.0/shared-lib': '^1.0.0'
        }
      })
    ];

    const result = resolvePeerDependencies(packages, 'shared-lib@1.0.0');
    expect(result.length).toBe(4);
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "depName": "react",
          "missing": false,
          "paths": [
            [
              "component-a@1.0.0",
            ],
          ],
          "providerId": "component-a@1.0.0",
          "versionRange": "^18.0.0",
        },
        {
          "depName": "vue",
          "missing": false,
          "paths": [
            [
              "component-a@1.0.0",
              "root",
            ],
          ],
          "providerId": "root",
          "versionRange": "^3.0.0",
        },
        {
          "depName": "vue",
          "missing": false,
          "paths": [
            [
              "component-b@1.0.0",
            ],
          ],
          "providerId": "component-b@1.0.0",
          "versionRange": "^3.0.0",
        },
        {
          "depName": "react",
          "missing": false,
          "paths": [
            [
              "component-b@1.0.0",
              "root",
            ],
          ],
          "providerId": "root",
          "versionRange": "^18.0.0",
        },
      ]
    `);
  });

  it('should detect missing peer dependencies', () => {

    //  root
    //   └─ app-component
    //       └─ ui-lib  (peerDeps: react)

    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'app-component': '^1.0.0'
          // Missing react dependency
        }
      }),
      createMockPackage('app-component@1.0.0', 'app-component', '1.0.0', {
        dependencies: {
          'ui-lib': '^1.0.0'
          // Also doesn't provide react
        },
        dependents: {
          'root/app-component': '^1.0.0'
        }
      }),
      createMockPackage('ui-lib@1.0.0', 'ui-lib', '1.0.0', {
        peerDependencies: {
          'react': '^18.0.0'
        },
        dependents: {
          'app-component@1.0.0/ui-lib': '^1.0.0'
        }
      })
    ];

    const results = resolvePeerDependencies(packages, 'ui-lib@1.0.0');
    expect(results).toEqual(
      [
        {
          "depName": "react",
          "missing": true,
          "paths": [],
          "providerId": "",
          "versionRange": "",
        },
      ]
    )
  });

  it('should handle multiple peer dependencies with some missing', () => {

    //  root
    //   ├─ react
    //   └─ app-component
    //       └─ multi-framework-lib (peerDeps: react, vue)

    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'app-component': '^1.0.0'
          // Missing vue dependency
        }
      }),
      createMockPackage('react@18.2.0', 'react', '18.2.0', {
        dependents: {
          'root/react': '^18.0.0'
        }
      }),
      createMockPackage('app-component@1.0.0', 'app-component', '1.0.0', {
        dependencies: {
          'multi-framework-lib': '^1.0.0'
        },
        dependents: {
          'root/app-component': '^1.0.0'
        }
      }),
      createMockPackage('multi-framework-lib@1.0.0', 'multi-framework-lib', '1.0.0', {
        peerDependencies: {
          'react': '^18.0.0',
          'vue': '^3.0.0'
        },
        dependents: {
          'app-component@1.0.0/multi-framework-lib': '^1.0.0'
        }
      })
    ];

    const result = resolvePeerDependencies(packages, 'multi-framework-lib@1.0.0');
    expect(result.length).toBe(2);
    expect(result.find(x => x.depName === 'vue')).toMatchInlineSnapshot(`
      {
        "depName": "vue",
        "missing": true,
        "paths": [],
        "providerId": "",
        "versionRange": "",
      }
    `)
    expect(result.find(x => x.depName === 'react')).toMatchInlineSnapshot(`
      {
        "depName": "react",
        "missing": false,
        "paths": [
          [
            "app-component@1.0.0",
            "root",
          ],
        ],
        "providerId": "root",
        "versionRange": "^18.0.0",
      }
    `)
  });

  it('should handle deep dependency chains', () => {

    //  root
    //   ├─ react
    //   └─ level-1
    //       └─ level-2
    //           └─ level-3 (peerDeps: react)
    
    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'react': '^18.0.0',
          'level-1': '^1.0.0'
        }
      }),
      createMockPackage('react@18.2.0', 'react', '18.2.0', {
        dependents: {
          'root/react': '^18.0.0'
        }
      }),
      createMockPackage('level-1@1.0.0', 'level-1', '1.0.0', {
        dependencies: {
          'level-2': '^1.0.0'
        },
        dependents: {
          'root/level-1': '^1.0.0'
        }
      }),
      createMockPackage('level-2@1.0.0', 'level-2', '1.0.0', {
        dependencies: {
          'level-3': '^1.0.0'
        },
        dependents: {
          'level-1@1.0.0/level-2': '^1.0.0'
        }
      }),
      createMockPackage('level-3@1.0.0', 'level-3', '1.0.0', {
        peerDependencies: {
          'react': '^18.0.0'
        },
        dependents: {
          'level-2@1.0.0/level-3': '^1.0.0'
        }
      })
    ];

    const result = resolvePeerDependencies(packages, 'level-3@1.0.0');
    expect(result.length).toBe(1);
    expect(result[0]).toMatchInlineSnapshot(`
      {
        "depName": "react",
        "missing": false,
        "paths": [
          [
            "level-2@1.0.0",
            "level-1@1.0.0",
            "root",
          ],
        ],
        "providerId": "root",
        "versionRange": "^18.0.0",
      }
    `)
  });

  it('should handle packages with no peer dependencies', () => {
    const packages: NpmTreeNode[] = [
      createMockPackage(ROOT, 'root', '1.0.0', {
        dependencies: {
          'simple-lib': '^1.0.0'
        }
      }),
      createMockPackage('simple-lib@1.0.0', 'simple-lib', '1.0.0', {
        // No peer dependencies
        dependents: {
          'root/simple-lib': '^1.0.0'
        }
      })
    ];

    const result = resolvePeerDependencies(packages, 'simple-lib@1.0.0');
    expect(result.length).toBe(0);
  });
});