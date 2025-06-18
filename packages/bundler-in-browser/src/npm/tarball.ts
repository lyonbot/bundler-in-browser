import TarStream from 'tar-stream';
import path from "path";

const decompressGzipFromResponse: (res: Response) => Promise<Uint8Array>
  = typeof DecompressionStream !== 'undefined'
    ? async (res) => {
      const ds = new DecompressionStream("gzip");
      const inflated = new Uint8Array(await new Response(res.body?.pipeThrough(ds)).arrayBuffer())
      return inflated;
    }
    : async (res) => {
      const pako = await import('pako');
      const tarball = await res.arrayBuffer();
      return pako.ungzip(new Uint8Array(tarball))
    };

export async function pourTarball(
  { fs, tarballUrl, destDir, patchPackageJson }: {
    fs: {
      mkdirSync(dir: string, options?: { recursive?: boolean; }): void;
      writeFileSync(file: string, data: Uint8Array | string): void;
    };
    tarballUrl: string;
    destDir: string;
    patchPackageJson?: (json: any) => any;
  }
) {
  if (!destDir.endsWith('/')) destDir += '/';
  const res = await fetch(tarballUrl)
  if (!res.ok) throw new Error(`Cannot fetch tarball from ${tarballUrl}: ${res.status} ${res.statusText}`);

  const inflated = await decompressGzipFromResponse(res);

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
      try {
        fs.mkdirSync(fileName, { recursive: true });
        next();
      } catch (err) {
        next(err);
      }
      return;
    }

    // make dir recrusive
    const dirName = path.dirname(fileName);
    if (dirName) fs.mkdirSync(dirName, { recursive: true });

    let data = inflated.slice(dataOffset, dataOffset + header.size!);
    if (fileName === 'package.json' && typeof patchPackageJson === 'function') {
      const str = new TextDecoder().decode(data);
      let json = JSON.parse(str)
      json = patchPackageJson(json);
      fs.writeFileSync(fileName, JSON.stringify(json, null, 2));
    }
    fs.writeFileSync(fileName, data);
    // if (header.name === 'package/package.json') packageJson = JSON.parse(decodeUTF8(data));

    stream.on('end', () => Promise.resolve().then(next))
    stream.resume();
  });

  await new Promise((resolve, reject) => {
    tar.on('finish', resolve);
    tar.on('error', reject);
    tar.end(inflated);
  });
}
