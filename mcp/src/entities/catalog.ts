import * as fs from "node:fs";
import * as path from "node:path";
import { ENTITY_TYPES, type EntityType } from "./canonicalId.js";

export interface EntityRecord {
  id: string;
  type: EntityType;
  name: string;
  slug: string;
  aliases?: string[];
  effect_text: string | null;
  effect_html: string | null;
  metadata: Record<string, unknown>;
  source_url: string;
  license: string;
  wiki_revision: number;
}

interface IndexEntry {
  id: string;
  type: EntityType;
}

export interface ListResult {
  items: EntityRecord[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

export class EntityCatalog {
  private readonly dataDir: string;
  private index: IndexEntry[] | null = null;
  private typeCache = new Map<string, EntityRecord[]>();
  private aliasCache: Map<string, string> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private loadIndex(): IndexEntry[] {
    if (this.index) return this.index;
    const indexPath = path.join(this.dataDir, "_index.json");
    const raw = fs.readFileSync(indexPath, "utf-8");
    this.index = JSON.parse(raw) as IndexEntry[];
    return this.index;
  }

  private loadType(type: string): EntityRecord[] {
    const cached = this.typeCache.get(type);
    if (cached) return cached;
    const typePath = path.join(this.dataDir, `${type}.json`);
    if (!fs.existsSync(typePath)) return [];
    const raw = fs.readFileSync(typePath, "utf-8");
    const records = JSON.parse(raw) as EntityRecord[];
    this.typeCache.set(type, records);
    return records;
  }

  private normalizeLookupKey(value: string): string {
    return value.trim().normalize("NFKC").replace(/\s+/g, "_").toLowerCase();
  }

  private loadAliases(): Map<string, string> {
    if (this.aliasCache) return this.aliasCache;

    const aliases = new Map<string, string>();
    for (const type of ENTITY_TYPES) {
      for (const record of this.loadType(type)) {
        const keys = [
          record.id,
          record.slug,
          record.name,
          `${record.type}/${record.slug}`,
          ...(record.aliases ?? []),
        ];

        for (const key of keys) {
          aliases.set(this.normalizeLookupKey(key), record.id);
        }
      }
    }

    this.aliasCache = aliases;
    return aliases;
  }

  private getEntityExact(id: string): EntityRecord | null {
    const slashIdx = id.indexOf("/");
    if (slashIdx === -1) return null;
    const type = id.slice(0, slashIdx);
    if (!ENTITY_TYPES.includes(type as EntityType)) return null;
    const records = this.loadType(type);
    return records.find((r) => r.id === id) ?? null;
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split("_")
      .filter((part) => part.length > 0)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
  }

  private jokerFallback(id: string): EntityRecord | null {
    const normalized = this.normalizeLookupKey(id);
    let slug: string | null = null;

    if (normalized.startsWith("j_")) {
      slug = normalized.slice(2);
    } else if (normalized.startsWith("joker/")) {
      slug = normalized.slice("joker/".length);
    }

    if (!slug || !/^[a-z0-9_]+$/.test(slug)) return null;

    const name = this.titleFromSlug(slug);
    return {
      id: `joker/${slug}`,
      type: "joker",
      name,
      slug,
      aliases: [`j_${slug}`],
      effect_text: null,
      effect_html: null,
      metadata: {
        game_key: `j_${slug}`,
        data_status: "missing_curated_effect",
        note: "Static effect data is not seeded yet; use the source_url or live instance fields for additional context.",
      },
      source_url: `https://balatrowiki.org/w/${name.replace(/ /g, "_")}`,
      license: "CC BY-NC-SA 3.0",
      wiki_revision: 0,
    };
  }

  listEntities(opts: {
    type?: string;
    name_contains?: string;
    limit?: number;
    offset?: number;
  } = {}): ListResult {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    let records: EntityRecord[];

    if (opts.type) {
      if (!ENTITY_TYPES.includes(opts.type as EntityType)) {
        records = [];
      } else {
        records = this.loadType(opts.type);
      }
    } else {
      records = [];
      for (const type of ENTITY_TYPES) {
        records.push(...this.loadType(type));
      }
      records.sort((a, b) => a.id.localeCompare(b.id));
    }

    if (opts.name_contains) {
      const needle = opts.name_contains.toLowerCase();
      records = records.filter((r) =>
        r.name.toLowerCase().includes(needle),
      );
    }

    const total = records.length;
    const sliced = records.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      items: sliced,
      total,
      count: sliced.length,
      offset,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    };
  }

  getEntity(id: string): EntityRecord {
    const exact = this.getEntityExact(id);
    if (exact) return exact;

    const aliasTarget = this.loadAliases().get(this.normalizeLookupKey(id));
    if (aliasTarget) {
      const aliasMatch = this.getEntityExact(aliasTarget);
      if (aliasMatch) return aliasMatch;
    }

    const fallback = this.jokerFallback(id);
    if (fallback) return fallback;

    const slashIdx = id.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(`INVALID_TARGET: entity "${id}" not found — pass an internal-key canonical ID like "joker/trio", a raw game key like "j_trio", or a known display name`);
    }
    const type = id.slice(0, slashIdx);
    if (!ENTITY_TYPES.includes(type as EntityType)) {
      throw new Error(`INVALID_TARGET: unknown entity type "${type}"`);
    }
    throw new Error(`INVALID_TARGET: entity "${id}" not found`);
  }
}
