## Changeset 

To generate a new changeset, run `pnpm changeset` in the root of the repository. The generated markdown files in the .changeset directory should be committed to the repository.

### Releasing changes

```sh
npx changeset version

pnpm install  # update lockfile
pnpm build

git commit -am "publish new version"
pnpm publish -r
npx changeset tag
```
