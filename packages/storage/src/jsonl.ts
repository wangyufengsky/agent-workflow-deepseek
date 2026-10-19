import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface JsonlEntry {
  readonly type: string;
  readonly at: string;
  readonly [key: string]: unknown;
}

export interface JsonlReadOptions {
  readonly stream: string;
  readonly fromSeq?: number;
  readonly limit?: number;
}

export interface JsonlRecord extends JsonlEntry {
  readonly seq: number;
  readonly stream: string;
}

/**
 * Append-only local journal. SQLite is the query source; JSONL is the durable
 * audit/stream that survives DB rebuilds and is readable without the app.
 * Each stream writes daily files under <dataDir>/journal/<stream>/.
 */
export class JsonlJournal {
  readonly root: string;
  readonly #seqByStream = new Map<string, number>();

  constructor(dataDir: string) {
    this.root = join(dataDir, 'journal');
    mkdirSync(this.root, { recursive: true });
  }

  #streamDir(stream: string): string {
    const dir = join(this.root, stream);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  #fileFor(stream: string): string {
    return join(this.#streamDir(stream), `${new Date().toISOString().slice(0, 10)}.jsonl`);
  }

  nextSeq(stream: string): number {
    const cached = this.#seqByStream.get(stream);
    if (cached !== undefined) return cached + 1;
    let max = 0;
    const dir = this.#streamDir(stream);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { seq?: number };
          if (typeof parsed.seq === 'number') max = Math.max(max, parsed.seq);
        } catch {
          // Ignore a partially written last line.
        }
      }
    }
    this.#seqByStream.set(stream, max);
    return max + 1;
  }

  append(stream: string, entry: JsonlEntry): JsonlRecord {
    const seq = this.nextSeq(stream);
    const record: JsonlRecord = { ...entry, seq, stream };
    appendFileSync(this.#fileFor(stream), `${JSON.stringify(record)}\n`, 'utf8');
    this.#seqByStream.set(stream, seq);
    return record;
  }

  read(options: JsonlReadOptions): readonly JsonlRecord[] {
    const dir = this.#streamDir(options.stream);
    if (!existsSync(dir)) return [];
    const fromSeq = options.fromSeq ?? 1;
    const limit = options.limit ?? 500;
    const files = readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort();
    const out: JsonlRecord[] = [];
    for (const file of files) {
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as JsonlRecord;
          if (typeof record.seq !== 'number' || record.seq < fromSeq) continue;
          out.push(record);
          if (out.length >= limit) return out;
        } catch {
          // Skip corrupt trailing line; the journal is append-only.
        }
      }
    }
    return out;
  }
}
