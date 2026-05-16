import fs from "fs/promises";

/**
 * Tiny LRU cache keyed on `${absPath}:${mtimeMs}`. The MCP composes multiple
 * tools that all read the same JSON file (get_figma_data_from_json,
 * get_node_image, get_node_svg). Re-reading + re-parsing a multi-MB file on
 * every tool call adds noticeable latency and wastes CPU. mtime-based
 * invalidation is correct for the local-file workflow: the user re-runs the
 * Figma plugin → file mtime changes → cache misses naturally.
 */
export class JsonFileCache<T> {
  private readonly maxEntries: number;
  // Map preserves insertion order — used for LRU eviction.
  private readonly entries = new Map<string, T>();

  constructor(maxEntries = 8) {
    this.maxEntries = maxEntries;
  }

  /**
   * Returns the cached parsed value if the file's mtime matches; otherwise
   * invokes `loader`, caches the result, and returns it.
   */
  async getOrLoad(absPath: string, loader: () => Promise<T>): Promise<T> {
    const stat = await fs.stat(absPath);
    const key = `${absPath}:${stat.mtimeMs}`;

    const cached = this.entries.get(key);
    if (cached !== undefined) {
      // Refresh LRU position — delete + re-set moves to the end.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const fresh = await loader();
    this.entries.set(key, fresh);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return fresh;
  }

  clear(): void {
    this.entries.clear();
  }
}
