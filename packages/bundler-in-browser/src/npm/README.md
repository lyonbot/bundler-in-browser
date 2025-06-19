# MiniNPM

A minimal npm client, which only supports installing packages.

It heavily relies on `symlinks`. Complex situations may not work.

## How it works

It's separated into two stages:

1. Build the structure of node_modules, and list of `package@version`.
   1. Build tree based on "dependencies" in `package.json`
   2. Check and link packages based on "peerDependencies"
2. Install packages.

The two stage can be separated, so bundler can only install imported packages. This optimize some situations like `vue` depends on `@vue/compiler-sfc`, but `@vue/compiler-sfc` is not used in most cases, unless you are doing `import "vue/compiler"`

You can run only stage 1 by calling `buildTree()` method.

## Build Tree

### Collect Versions

To leverage symlink, we need to construct the structure of `node_modules` like this:

```
node_modules
+ .store
  + foo@1.0.3
    + node_modules
      + bar -> ../../bar@1.2.0/node_modules/bar    // from  { dependencies: { "bar": "@1" } }
      + bar2 -> ../../bar@2.7.0/node_modules/bar   // from  { dependencies: { "bar2": "npm:bar@^2.0.0" } }
      + foo
  + bar@1.2.0
    + node_modules
      + bar
  + bar@2.7.0
    + node_modules
      + bar
+ foo -> ./.store/foo@1.0.3/node_modules/foo
+ bar -> ./.store/bar@2.7.0/node_modules/bar
```

Before installing packages, we need to query registry, collect all versions of all packages,
and build a tree (aka. `LockFile`) so we can easily build `node_modules` like above.

The `buildTree()` method will build the tree like this:

```js
{
  packages: {
    root: {
      id: "root",
      name: "root",
      version: "", // not used
      dependents: {}, // empty for "root"
      dependencies: {
        "foo": "^1.0.0",
        "bar": "2",
      }
    },
    "foo@1.0.3": {
      id: "foo@1.0.3",
      name: "foo",
      version: "1.0.3",
      dependents: {
        "root/foo": "^1.0.0",  // from root's { dependencies: { "foo": "^1.0.0" } }
      },
      dependencies: {
        "bar": "^1.0.0",
        "bar2": "npm:bar@^2.0.0",
      },
      dist: { shasum: 'xxx', tarball: 'xxx', integrity: 'xxx', }
    },
    "bar@2.7.0": {
      id: "bar@2.7.0",
      name: "bar",
      version: "2.7.0",
      dependents: {
        "root/bar": "2",  // from root's { dependencies: { "bar": "2" } }
        "foo@1.0.3/bar2": "^2.0.0" // from foo@1.0.3's  { dependencies: { "bar2": "npm:bar@^2.0.0" } }
      },
      dependencies: {},
      dist: { shasum: 'xxx', tarball: 'xxx', integrity: 'xxx', }
    },
    ...
  }
}
```

### Link PeerDependencies

> Yet not fully implemented.
>
> - [x] link for single peer dependency
> - [ ] link for multiple peer dependency versions (duplicate pkg)
> - [ ] permutation of combinations

A package inherit "peer" dependencies from its ancestor.
The version of "peer" dependencies are determined by the nearest ancestor who installed the dependencies.

```
root ─┬──>  my-input@1.0.0 ──> (peerDep) react@17.0.0
      │                                    ┆  (version determined by nearest ancestor's dependencies)
      └──>  react@17.0.0 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

After patching, the tree will looks like this:

```js
{
  "packages": {
    root: {
      id: "root",
      name: "root",
      version: "",
      dependents: {},
      dependencies: {
        "my-input": "^1.0.0",
        "react": "^17.0.0",
      }
    },
    'my-input@1.0.0': {
      id: 'my-input@1.0.0',
      name: 'my-input',
      version: '1.0.0',
      dependents: {
        'root/my-input': '^1.0.0',
      },
      dependencies: {},
      peerDependencies: {     // <- new
        'react': '^17.0.0',
      },
    },
    'react@17.0.0': {
      id: 'react@17.0.0',
      name: 'react',
      version: '17.0.0',
      dependents: {
        'root/react': '^17.0.0',
        'my-input@1.0.0/react': '^17.0.0',  // <- new
      },
      dependencies: {},
    },
  }
}
```

#### Expansion for Peer Dependencies

> yet not implemented

Peer Dependencies could make the dependency chains more complex. Dependent and ancestor dependents may get expanded.

Lets say we have packages (H0) and (H1) for root.

- H0 depends on A & `P@1.0.0`
- H1 depends on A & `P@2.0.0`
- A has peer dependency `P@*`

```
root ─┬──> H0 ┬──> A  ────> (peerDep)P
      │       └──> P@1.0.0 ┄┄┄┄┄┄┄┄┄┄┘
      └──> H1 ┬──> A  ────> (peerDep)P
              └──> P@2.0.0 ┄┄┄┄┄┄┄┄┄┄┘
```

The (A) from (H0), will receive `P@1.0.0`, and the (A) from (H1), will receive `P@2.0.0`. Even though they are both (A), but their behaviors are different, depends on which (P) can be seen.

To make the mechanism work with symlink, we have to duplicate package (A) into (A+P1) and (A+P2) for A's dependents (H0, H1) -- actually, there are two (A)s because their actual dependencies are different.

```
root ─┬──> H0 ┬──> A0  ────> (peerDep)P@1.0.0             A0 = A + P@1.0.0
      │       └──> P@1.0.0 ┄┄┄┄┄┄┄┄┄┄┄┘
      └──> H1 ┬──> A1  ────> (peerDep)P@2.0.0             A1 = A + P@2.0.0
              └──> P@2.0.0 ┄┄┄┄┄┄┄┄┄┄┄┘
```

In this case, the `A@1.0.0` in `"packages"` of lock file, will be expanded two:

- `A@1.0.0~P@1.0.0` for H0
- `A@1.0.0~P@2.0.0` for H1

The expansion may spread through the dependency chains.

Let's see a complex situation:

```
root ─┬──> B  ────> A  ────> (peerDep)P
      ├──> P@1.0.0
      ├──> A  ────> (peerDep)P
      └──> C  ─┬──> A  ────> (peerDep)P
               ├──> B  ────> A  ────> (peerDep)P
               └──> P@2.0.0
```

after linking the `P`s:

```
root ─┬──> B  ────> A  ────> (peerDep)P
      ├──> P@1.0.0 <┄┄┄┄┄┄┄┄┄┬┄┄┄┄┄┄┄┄┤
      ├──> A  ────> (peerDep)P        ┆
      └──> C  ─┬──> A  ────> (peerDep)P
               ├──> B  ────> A  ────> (peerDep)P
               └──> P@2.0.0 <┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

There are two version of `P`, making `A` expanded to `A0, A1`, which also affects their dependents like `B, C`.
Especially in this case, `B` will be expanded to two version `B0, B1`.

```
actual result:

A0 = A + P@1.0.0
A1 = A + P@2.0.0
B0 = B using A0 = B + A + P@1.0.0
B1 = B using A1 = B + A + P@2.0.0

root ─┬──> B0  ────> A0 ────> P@1.0.0
      ├──> P@1.0.0 <┬┄┄┄┄┄┄┄┄┄┤
      ├──> A0 ────> P@1.0.0   ┆
      └──> C  ─┬──> A0  ────> P@1.0.0
               ├──> B1 ────> A1 ────> P@2.0.0
               └──> P@2.0.0 <┄┄┄┄┄┄┄┄┄┘
```
