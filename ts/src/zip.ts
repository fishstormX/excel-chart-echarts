/** Minimal ZIP reader (central directory + stored/deflate) — no dependencies.
 *  Node: node:zlib inflateRawSync. Browser: DecompressionStream("deflate-raw"). */
export interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number; }

const MAX_PART = 200 * 1024 * 1024;

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

export function listEntries(buf: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
  let n = u16(buf, eocd + 10), off = u32(buf, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder("utf-8");
  for (let k = 0; k < n; k++) {
    if (u32(buf, off) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = u16(buf, off + 10), csize = u32(buf, off + 20), usize = u32(buf, off + 24);
    const nl = u16(buf, off + 28), el = u16(buf, off + 30), cl = u16(buf, off + 32), lho = u32(buf, off + 42);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nl));
    out.push({ name, method, csize, usize, offset: lho });
    off += 46 + nl + el + cl;
  }
  return out;
}

type Inflate = (d: Uint8Array) => Promise<Uint8Array>;
let inflater: Inflate | null = null;

async function getInflater(): Promise<Inflate> {
  if (inflater) return inflater;
  const isNode = typeof process !== "undefined" && !!(process as any).versions?.node;
  if (isNode) {
    const zlib: any = await import(/* webpackIgnore: true */ "node:zlib" as any);
    inflater = async (d) => new Uint8Array(zlib.inflateRawSync(d));
  } else if (typeof (globalThis as any).DecompressionStream !== "undefined") {
    inflater = async (d) => {
      const ds = new (globalThis as any).DecompressionStream("deflate-raw");
      const stream = new Blob([d as any]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
  } else throw new Error("no inflate implementation available (need Node or DecompressionStream)");
  return inflater;
}

export async function readEntry(buf: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (e.usize > MAX_PART) throw new Error(`part ${e.name} too large`);
  const o = e.offset;
  if (u32(buf, o) !== 0x04034b50) throw new Error("corrupt zip local header");
  const start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return (await getInflater())(data);
  throw new Error(`unsupported zip compression method ${e.method}`);
}

/** Read every XML / rels part into memory (text). Other parts (images…) are only listed. */
export async function openZip(buf: Uint8Array): Promise<{ names: string[]; files: Map<string, string>; sizes: Map<string, number> }> {
  const entries = listEntries(buf);
  const files = new Map<string, string>(), sizes = new Map<string, number>();
  const dec = new TextDecoder("utf-8");
  for (const e of entries) {
    sizes.set(e.name, e.usize);
    if (/\.(xml|rels)$/i.test(e.name)) files.set(e.name, dec.decode(await readEntry(buf, e)));
  }
  return { names: entries.map((e) => e.name), files, sizes };
}
