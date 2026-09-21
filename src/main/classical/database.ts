import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname } from 'node:path'
import type { AlbumCredits, CreditPerson } from '../../shared/plex.js'
import { modelAssertsRepertoire } from '../../shared/classical-model.js'
import type {
  ClassicalComposerDetail,
  ClassicalAgentDetail,
  ClassicalCorrection,
  ClassicalCorrectionCommand,
  ClassicalEntityKind,
  ClassicalEntitySummary,
  ClassicalHome,
  ClassicalOwnedReleaseSummary,
  ClassicalRecordingDetail,
  ClassicalReleaseDetail,
  ClassicalOwnedAlbumInput,
  ClassicalReviewCandidate,
  ClassicalSearchArgs,
  ClassicalSearchPage,
  ClassicalSyncStatus,
  ClassicalWorkDetail,
  ClassicalWorkSummary
} from '../../shared/classical-api.js'

interface OpenOpusDump {
  status?: { version?: string }
  composers: Array<{
    name: string
    complete_name: string
    epoch: string
    birth: string | null
    death: string | null
    popular: string | number | null
    recommended: string | number | null
    works: Array<{
      title: string
      subtitle: string
      searchterms?: string
      popular: string | number | null
      recommended: string | number | null
      genre: string
    }>
  }>
}

export interface CachedClassicalRelease {
  ratingKey: string
  credits: AlbumCredits
}

export interface ClassicalSyncJob {
  id: string
  releaseId: string
  serverId: string
  ratingKey: string
  title: string
  artist: string
  year: number | null
  attempts: number
}

const SCHEMA_VERSION = 1

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stableId(namespace: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)
  return `${namespace}:${digest}`
}

function boolInt(value: string | number | null | undefined): number {
  return value === 1 || value === '1' ? 1 : 0
}

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

export class ClassicalDatabase {
  readonly db: Database.Database

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const current = Number(this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").pluck().get() ?? 0)
    if (current >= SCHEMA_VERSION) return
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('composer','performer','ensemble')),
          name TEXT NOT NULL,
          sort_name TEXT,
          normalized_name TEXT NOT NULL,
          birth TEXT,
          death TEXT,
          period TEXT,
          popular INTEGER NOT NULL DEFAULT 0,
          recommended INTEGER NOT NULL DEFAULT 0,
          image_url TEXT,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX agents_normalized_name_idx ON agents(normalized_name);
        CREATE TABLE aliases (
          entity_id TEXT NOT NULL,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          locale TEXT,
          source TEXT NOT NULL,
          PRIMARY KEY(entity_id, normalized_name)
        );
        CREATE TABLE external_ids (
          entity_id TEXT NOT NULL,
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          PRIMARY KEY(source, external_id),
          UNIQUE(entity_id, source, external_id)
        );
        CREATE INDEX external_ids_entity_idx ON external_ids(entity_id);
        CREATE TABLE works (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          normalized_title TEXT NOT NULL,
          subtitle TEXT,
          genre TEXT,
          catalogue_number TEXT,
          popular INTEGER NOT NULL DEFAULT 0,
          recommended INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX works_normalized_title_idx ON works(normalized_title);
        CREATE TABLE work_agents (
          work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          PRIMARY KEY(work_id, agent_id, role)
        );
        CREATE INDEX work_agents_agent_idx ON work_agents(agent_id, role);
        CREATE TABLE work_relations (
          parent_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
          child_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          ordering INTEGER,
          source TEXT NOT NULL,
          PRIMARY KEY(parent_work_id, child_work_id, relation)
        );
        CREATE TABLE recordings (
          id TEXT PRIMARY KEY,
          mbid TEXT UNIQUE,
          title TEXT,
          duration_ms INTEGER,
          work_id TEXT REFERENCES works(id),
          match_method TEXT,
          confidence TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE releases (
          id TEXT PRIMARY KEY,
          mbid TEXT,
          plex_server_id TEXT,
          plex_rating_key TEXT NOT NULL,
          title TEXT,
          artist TEXT,
          year INTEGER,
          thumb TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(plex_server_id, plex_rating_key)
        );
        CREATE INDEX releases_rating_key_idx ON releases(plex_rating_key);
        CREATE TABLE release_tracks (
          release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
          plex_track_key TEXT NOT NULL,
          recording_id TEXT REFERENCES recordings(id),
          work_id TEXT REFERENCES works(id),
          title TEXT,
          disc_number INTEGER,
          track_number INTEGER,
          duration_ms INTEGER,
          PRIMARY KEY(release_id, plex_track_key)
        );
        CREATE INDEX release_tracks_work_idx ON release_tracks(work_id);
        CREATE TABLE credits (
          subject_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          instrument TEXT NOT NULL DEFAULT '',
          character_name TEXT NOT NULL DEFAULT '',
          credited_as TEXT,
          source TEXT NOT NULL,
          PRIMARY KEY(subject_type, subject_id, agent_id, role, instrument, character_name)
        );
        CREATE INDEX credits_agent_idx ON credits(agent_id, role);
        CREATE TABLE provenance (
          entity_id TEXT NOT NULL,
          field TEXT NOT NULL,
          source TEXT NOT NULL,
          source_id TEXT,
          fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(entity_id, field, source)
        );
        CREATE TABLE sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE sync_jobs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(kind, subject_id)
        );
        CREATE INDEX sync_jobs_queue_idx ON sync_jobs(status, priority DESC, available_at);
        CREATE TABLE review_candidates (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          candidate_id TEXT,
          confidence REAL NOT NULL,
          evidence_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE corrections (
          id TEXT PRIMARY KEY,
          command_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          undone_at TEXT
        );
        CREATE VIRTUAL TABLE classical_search USING fts5(
          entity_id UNINDEXED,
          kind UNINDEXED,
          title,
          aliases,
          secondary,
          tokenize='unicode61 remove_diacritics 2'
        );
      `)
      this.db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION))
    })()
  }

  getSourceVersion(): string | null {
    return (this.db.prepare("SELECT value FROM sync_state WHERE key='openopus_version'").pluck().get() as string | undefined) ?? null
  }

  getSyncValue(key: string): string | null {
    return (this.db.prepare('SELECT value FROM sync_state WHERE key=?').pluck().get(key) as string | undefined) ?? null
  }

  importOpenOpusFile(filePath: string): { composers: number; works: number; version: string | null } {
    if (!existsSync(filePath)) return { composers: 0, works: 0, version: null }
    const raw = filePath.endsWith('.gz') ? gunzipSync(readFileSync(filePath)) : readFileSync(filePath)
    return this.importOpenOpus(JSON.parse(raw.toString('utf8')) as OpenOpusDump)
  }

  importOpenOpus(dump: OpenOpusDump): { composers: number; works: number; version: string | null } {
    const upsertAgent = this.db.prepare(`
      INSERT INTO agents(id,kind,name,sort_name,normalized_name,birth,death,period,popular,recommended,source)
      VALUES(@id,'composer',@name,@sortName,@normalizedName,@birth,@death,@period,@popular,@recommended,'openopus')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_name=excluded.sort_name,
        normalized_name=excluded.normalized_name, birth=excluded.birth, death=excluded.death,
        period=excluded.period, popular=excluded.popular, recommended=excluded.recommended,
        updated_at=CURRENT_TIMESTAMP
    `)
    const upsertWork = this.db.prepare(`
      INSERT INTO works(id,title,normalized_title,subtitle,genre,popular,recommended,source)
      VALUES(@id,@title,@normalizedTitle,@subtitle,@genre,@popular,@recommended,'openopus')
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, normalized_title=excluded.normalized_title,
        subtitle=excluded.subtitle, genre=excluded.genre, popular=excluded.popular,
        recommended=excluded.recommended, updated_at=CURRENT_TIMESTAMP
    `)
    const link = this.db.prepare("INSERT OR IGNORE INTO work_agents(work_id,agent_id,role) VALUES(?,?,'composer')")
    const alias = this.db.prepare("INSERT OR IGNORE INTO aliases(entity_id,name,normalized_name,source) VALUES(?,?,?,'openopus')")
    const provenance = this.db.prepare("INSERT OR REPLACE INTO provenance(entity_id,field,source,source_id) VALUES(?,?,'openopus',?)")
    let workCount = 0
    this.db.transaction(() => {
      for (const composer of dump.composers) {
        const agentId = stableId('oo:composer', composer.complete_name, composer.birth ?? '', composer.death ?? '')
        upsertAgent.run({
          id: agentId,
          name: composer.complete_name,
          sortName: composer.name,
          normalizedName: normalize(composer.complete_name),
          birth: composer.birth,
          death: composer.death,
          period: composer.epoch || null,
          popular: boolInt(composer.popular),
          recommended: boolInt(composer.recommended)
        })
        if (composer.name && composer.name !== composer.complete_name) {
          alias.run(agentId, composer.name, normalize(composer.name))
        }
        provenance.run(agentId, 'identity', composer.complete_name)
        for (const work of composer.works) {
          const workId = stableId('oo:work', agentId, work.title)
          upsertWork.run({
            id: workId,
            title: work.title,
            normalizedTitle: normalize(work.title),
            subtitle: work.subtitle || null,
            genre: work.genre || null,
            popular: boolInt(work.popular),
            recommended: boolInt(work.recommended)
          })
          link.run(workId, agentId)
          if (work.searchterms?.trim()) alias.run(workId, work.searchterms.trim(), normalize(work.searchterms))
          provenance.run(workId, 'identity', `${composer.complete_name}\u0000${work.title}`)
          workCount++
        }
      }
      const version = dump.status?.version ?? null
      if (version) this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('openopus_version',?)").run(version)
      this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_openopus_refresh',?)").run(new Date().toISOString())
      this.rebuildSearchIndex()
    })()
    return { composers: dump.composers.length, works: workCount, version: dump.status?.version ?? null }
  }

  private resolveAgent(person: CreditPerson, role: string): string {
    const byMbid = this.db.prepare("SELECT entity_id FROM external_ids WHERE source='musicbrainz' AND external_id=?").pluck().get(person.mbid) as string | undefined
    if (byMbid) return byMbid
    const normalizedName = normalize(person.name)
    const exactRows = this.db.prepare("SELECT id FROM agents WHERE normalized_name=? ORDER BY kind='composer' DESC LIMIT 3").pluck().all(normalizedName) as string[]
    const exact = exactRows.length === 1 ? exactRows[0] : undefined
    const kind = role === 'composer' ? 'composer' : role === 'orchestra' || role === 'choir' || role === 'ensemble' ? 'ensemble' : 'performer'
    const id = exact ?? `mb:artist:${person.mbid}`
    if (!exact) {
      this.db.prepare("INSERT OR IGNORE INTO agents(id,kind,name,normalized_name,source) VALUES(?,?,?,?, 'musicbrainz')").run(id, kind, person.name, normalizedName)
    }
    this.db.prepare("INSERT OR IGNORE INTO external_ids(entity_id,source,external_id) VALUES(?,'musicbrainz',?)").run(id, person.mbid)
    if (!exact && exactRows.length > 1) {
      for (const candidateId of exactRows) this.addReviewCandidate('entity-match', id, candidateId, 0.82, ['same normalized name', 'multiple possible identities'])
    }
    return id
  }

  private addReviewCandidate(kind: 'entity-match' | 'work-match' | 'recording-match' | 'role-conflict', subjectId: string, candidateId: string | null, confidence: number, evidence: string[]): void {
    const id = stableId('review', kind, subjectId, candidateId ?? '')
    this.db.prepare(`INSERT OR IGNORE INTO review_candidates(id,kind,subject_id,candidate_id,confidence,evidence_json)
      VALUES(?,?,?,?,?,?)`).run(id, kind, subjectId, candidateId, confidence, JSON.stringify(evidence))
  }

  private resolveWork(mbid: string, title: string, composers: CreditPerson[]): string {
    const external = this.db.prepare("SELECT entity_id FROM external_ids WHERE source='musicbrainz' AND external_id=?").pluck().get(mbid) as string | undefined
    if (external) return external
    let exact: string | undefined
    for (const composer of composers) {
      const agentId = this.resolveAgent(composer, 'composer')
      const matches = this.db.prepare(`
        SELECT w.id FROM works w JOIN work_agents wa ON wa.work_id=w.id
        WHERE w.normalized_title=? AND wa.agent_id=? AND wa.role='composer' LIMIT 3
      `).pluck().all(normalize(title), agentId) as string[]
      exact = matches.length === 1 ? matches[0] : undefined
      if (!exact && matches.length > 1) {
        const subjectId = `mb:work:${mbid}`
        this.db.prepare("INSERT OR IGNORE INTO works(id,title,normalized_title,source) VALUES(?,?,?,'musicbrainz')").run(subjectId, title, normalize(title))
        for (const candidateId of matches) this.addReviewCandidate('work-match', subjectId, candidateId, 0.86, ['same composer and normalized title', 'multiple possible works'])
      }
      if (exact) break
    }
    const id = exact ?? `mb:work:${mbid}`
    if (!exact) this.db.prepare("INSERT OR IGNORE INTO works(id,title,normalized_title,source) VALUES(?,?,?,'musicbrainz')").run(id, title, normalize(title))
    this.db.prepare("INSERT OR IGNORE INTO external_ids(entity_id,source,external_id) VALUES(?,'musicbrainz',?)").run(id, mbid)
    for (const composer of composers) {
      const agentId = this.resolveAgent(composer, 'composer')
      this.db.prepare("INSERT OR IGNORE INTO work_agents(work_id,agent_id,role) VALUES(?,?,'composer')").run(id, agentId)
    }
    return id
  }

  importOwnedCredits(releases: CachedClassicalRelease[], serverId: string | null = null): { releases: number; recordings: number } {
    let recordingCount = 0
    this.db.transaction(() => {
      for (const { ratingKey, credits } of releases) {
        if (!credits.classical || credits.classical.matchedTracks === 0) continue
        // MB models pop songs with the same work skeleton as movements, so a
        // populated model isn't proof of repertoire — without this gate a
        // band's songbook (and its writers) lands in the classical catalog.
        if (!modelAssertsRepertoire(credits.classical)) continue
        const releaseId = stableId('plex:release', serverId ?? '', ratingKey)
        this.db.prepare(`
          INSERT INTO releases(id,mbid,plex_server_id,plex_rating_key,year,source)
          VALUES(?,?,?,?,?,'plex')
          ON CONFLICT(plex_server_id,plex_rating_key) DO UPDATE SET mbid=excluded.mbid,
            year=excluded.year, updated_at=CURRENT_TIMESTAMP
        `).run(releaseId, credits.releaseMbid, serverId ?? '', ratingKey, credits.originalDate ? Number.parseInt(credits.originalDate.slice(0, 4), 10) || null : null)
        for (const [trackKey, track] of Object.entries(credits.classical.byTrack)) {
          const topMbid = track.parentWorkMbid ?? track.workMbid
          const topTitle = track.parentWorkTitle ?? track.workTitle
          let workId: string | null = null
          if (topMbid && topTitle) workId = this.resolveWork(topMbid, topTitle, track.composers)
          if (track.workMbid && track.workTitle && track.workMbid !== topMbid) {
            const childId = this.resolveWork(track.workMbid, track.workTitle, track.composers)
            if (workId) this.db.prepare("INSERT OR IGNORE INTO work_relations(parent_work_id,child_work_id,relation,source) VALUES(?,?,'part-of','musicbrainz')").run(workId, childId)
          }
          let recordingId: string | null = null
          if (track.recordingMbid) {
            recordingId = `mb:recording:${track.recordingMbid}`
            this.db.prepare(`
              INSERT INTO recordings(id,mbid,work_id,match_method,confidence,source)
              VALUES(?,?,?,?,?,'musicbrainz')
              ON CONFLICT(id) DO UPDATE SET work_id=excluded.work_id, match_method=excluded.match_method,
                confidence=excluded.confidence, updated_at=CURRENT_TIMESTAMP
            `).run(recordingId, track.recordingMbid, workId, track.matchMethod, credits.classical.alignmentConfidence)
            recordingCount++
          }
          this.db.prepare(`
            INSERT INTO release_tracks(release_id,plex_track_key,recording_id,work_id)
            VALUES(?,?,?,?)
            ON CONFLICT(release_id,plex_track_key) DO UPDATE SET recording_id=excluded.recording_id, work_id=excluded.work_id
          `).run(releaseId, trackKey, recordingId, workId)
          for (const composer of track.composers) {
            const agentId = this.resolveAgent(composer, 'composer')
            if (workId) this.db.prepare("INSERT OR IGNORE INTO work_agents(work_id,agent_id,role) VALUES(?,?,'composer')").run(workId, agentId)
          }
          for (const credit of credits.byTrack[trackKey] ?? []) {
            const agentId = this.resolveAgent(credit.person, credit.role)
            this.db.prepare(`INSERT OR IGNORE INTO credits(subject_type,subject_id,agent_id,role,instrument,source)
              VALUES('track',?,?,?,?, 'musicbrainz')`).run(`${releaseId}:${trackKey}`, agentId, credit.role, credit.instrument ?? '')
          }
        }
        for (const credit of credits.releaseLevel) {
          const agentId = this.resolveAgent(credit.person, credit.role)
          this.db.prepare(`INSERT OR IGNORE INTO credits(subject_type,subject_id,agent_id,role,source)
            VALUES('release',?,?,?,'musicbrainz')`).run(releaseId, agentId, credit.role)
        }
      }
      this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_library_sync',?)").run(new Date().toISOString())
      this.rebuildSearchIndex()
    })()
    return { releases: releases.length, recordings: recordingCount }
  }

  syncOwnedAlbums(albums: ClassicalOwnedAlbumInput[]): { queued: number; removed: number } {
    let queued = 0
    let removed = 0
    this.db.transaction(() => {
      const seen = new Set(albums.map((album) => `${album.plexServerId ?? ''}:${album.ratingKey}`))
      for (const album of albums) {
        if (!album.candidate) continue
        const releaseId = stableId('plex:release', album.plexServerId ?? '', album.ratingKey)
        this.db.prepare(`INSERT INTO releases(id,plex_server_id,plex_rating_key,title,artist,year,thumb,source)
          VALUES(?,?,?,?,?,?,?,'plex') ON CONFLICT(plex_server_id,plex_rating_key) DO UPDATE SET
          title=excluded.title,artist=excluded.artist,year=excluded.year,thumb=excluded.thumb,updated_at=CURRENT_TIMESTAMP`)
          .run(releaseId, album.plexServerId ?? '', album.ratingKey, album.title, album.artist, album.year, album.thumb)
        const enriched = Number(this.db.prepare('SELECT COUNT(*) FROM release_tracks WHERE release_id=?').pluck().get(releaseId) ?? 0) > 0
        if (!enriched) {
          const result = this.db.prepare(`INSERT OR IGNORE INTO sync_jobs(id,kind,subject_id,status,priority)
            VALUES(?, 'enrich-release', ?, 'pending', 0)`).run(stableId('job', 'enrich-release', releaseId), releaseId)
          queued += result.changes
        }
      }
      const existing = this.db.prepare("SELECT id,plex_server_id,plex_rating_key FROM releases WHERE source='plex'").all() as Array<{ id: string; plex_server_id: string | null; plex_rating_key: string }>
      for (const release of existing) {
        if (!seen.has(`${release.plex_server_id ?? ''}:${release.plex_rating_key}`)) {
          this.db.prepare('DELETE FROM releases WHERE id=?').run(release.id)
          this.db.prepare("DELETE FROM sync_jobs WHERE kind='enrich-release' AND subject_id=?").run(release.id)
          removed++
        }
      }
      this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_library_sync',?)").run(new Date().toISOString())
      this.rebuildSearchIndex()
    })()
    return { queued, removed }
  }

  rebuildSearchIndex(): void {
    this.db.exec('DELETE FROM classical_search')
    this.db.exec(`
      INSERT INTO classical_search(entity_id,kind,title,aliases,secondary)
      SELECT a.id, a.kind, a.name,
        COALESCE((SELECT group_concat(name, ' ') FROM aliases x WHERE x.entity_id=a.id), ''),
        COALESCE(a.period, '')
      FROM agents a;
      INSERT INTO classical_search(entity_id,kind,title,aliases,secondary)
      SELECT w.id, 'work', w.title,
        COALESCE((SELECT group_concat(name, ' ') FROM aliases x WHERE x.entity_id=w.id), ''),
        COALESCE(w.subtitle, '') || ' ' || COALESCE(w.catalogue_number, '') || ' ' ||
        COALESCE((SELECT group_concat(a.name, ' ') FROM work_agents wa JOIN agents a ON a.id=wa.agent_id WHERE wa.work_id=w.id), '')
      FROM works w;
      INSERT INTO classical_search(entity_id,kind,title,aliases,secondary)
      SELECT r.id, 'release', COALESCE(r.title, r.plex_rating_key), '', COALESCE(r.artist, '')
      FROM releases r;
    `)
  }

  private externalIds(entityId: string): Record<string, string> {
    const rows = this.db.prepare('SELECT source,external_id FROM external_ids WHERE entity_id=?').all(entityId) as Array<{ source: string; external_id: string }>
    return Object.fromEntries(rows.map((row) => [row.source, row.external_id]))
  }

  private agentSummary(row: Record<string, unknown>): ClassicalEntitySummary {
    const id = String(row.id)
    return {
      id,
      kind: String(row.kind) as ClassicalEntityKind,
      title: String(row.name),
      subtitle: row.birth || row.death ? [row.birth, row.death].map((v) => v ? String(v).slice(0, 4) : '').join('–') : null,
      period: row.period ? String(row.period) : null,
      genre: null,
      ownedCount: Number(row.owned_count ?? 0),
      imageUrl: row.image_url ? String(row.image_url) : null,
      externalIds: this.externalIds(id)
    }
  }

  private workSummary(row: Record<string, unknown>): ClassicalWorkSummary {
    const id = String(row.id)
    return {
      id,
      kind: 'work',
      title: String(row.title),
      subtitle: row.subtitle ? String(row.subtitle) : null,
      period: row.period ? String(row.period) : null,
      genre: row.genre ? String(row.genre) : null,
      ownedCount: Number(row.owned_count ?? 0),
      imageUrl: null,
      externalIds: this.externalIds(id),
      catalogueNumber: row.catalogue_number ? String(row.catalogue_number) : null,
      parentWorkId: row.parent_work_id ? String(row.parent_work_id) : null,
      movementCount: Number(row.movement_count ?? 0),
      recordingCount: Number(row.recording_count ?? 0),
      releaseRatingKeys: typeof row.release_keys === 'string' && row.release_keys ? String(row.release_keys).split(',') : []
    }
  }

  getHome(): ClassicalHome {
    const scalar = (sql: string): number => Number(this.db.prepare(sql).pluck().get() ?? 0)
    const agentRows = this.db.prepare(`
      SELECT a.*, COUNT(DISTINCT r.id) owned_count
      FROM agents a
      LEFT JOIN work_agents wa ON wa.agent_id=a.id AND wa.role='composer'
      LEFT JOIN release_tracks rt ON rt.work_id=wa.work_id
      LEFT JOIN releases r ON r.id=rt.release_id
      WHERE a.kind='composer' AND a.recommended=1
      GROUP BY a.id ORDER BY a.popular DESC, owned_count DESC, a.name LIMIT 24
    `).all() as Array<Record<string, unknown>>
    const ownedRows = this.db.prepare(`
      SELECT a.*, COUNT(DISTINCT r.id) owned_count
      FROM agents a JOIN work_agents wa ON wa.agent_id=a.id AND wa.role='composer'
      JOIN release_tracks rt ON rt.work_id=wa.work_id JOIN releases r ON r.id=rt.release_id
      GROUP BY a.id ORDER BY owned_count DESC, a.name LIMIT 24
    `).all() as Array<Record<string, unknown>>
    return {
      generatedAt: new Date().toISOString(),
      sourceVersion: this.getSourceVersion(),
      stats: {
        composers: scalar("SELECT COUNT(*) FROM agents WHERE kind='composer'"),
        works: scalar('SELECT COUNT(*) FROM works'),
        recordings: scalar('SELECT COUNT(*) FROM recordings'),
        releases: scalar('SELECT COUNT(*) FROM releases'),
        ownedReleases: scalar('SELECT COUNT(*) FROM releases'),
        pendingReview: scalar("SELECT COUNT(*) FROM review_candidates WHERE status='pending'")
      },
      featuredComposers: agentRows.map((row) => this.agentSummary(row)),
      ownedComposers: ownedRows.map((row) => this.agentSummary(row)),
      periods: (this.db.prepare("SELECT period name,COUNT(*) count FROM agents WHERE kind='composer' AND period IS NOT NULL GROUP BY period ORDER BY count DESC").all() as Array<{ name: string; count: number }>),
      genres: (this.db.prepare("SELECT genre name,COUNT(*) count FROM works WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC").all() as Array<{ name: string; count: number }>)
    }
  }

  search(args: ClassicalSearchArgs): ClassicalSearchPage {
    const limit = Math.min(100, Math.max(1, args.limit ?? 40))
    const offset = parseCursor(args.cursor)
    const terms = normalize(args.query).split(' ').filter(Boolean)
    const match = terms.length ? terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ') : null
    const clauses: string[] = []
    const params: unknown[] = []
    if (match) { clauses.push('classical_search MATCH ?'); params.push(match) }
    if (args.kinds?.length) { clauses.push(`kind IN (${args.kinds.map(() => '?').join(',')})`); params.push(...args.kinds) }
    if (args.period) {
      clauses.push('entity_id IN (SELECT id FROM agents WHERE period=?)')
      params.push(args.period)
    }
    if (args.genre) {
      clauses.push('entity_id IN (SELECT id FROM works WHERE genre=?)')
      params.push(args.genre)
    }
    if (args.owned) {
      clauses.push(`entity_id IN (
        SELECT rt.work_id FROM release_tracks rt WHERE rt.work_id IS NOT NULL
        UNION SELECT wa.agent_id FROM work_agents wa JOIN release_tracks rt ON rt.work_id=wa.work_id
        UNION SELECT c.agent_id FROM credits c
        UNION SELECT r.id FROM releases r
      )`)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const all = this.db.prepare(`SELECT entity_id,kind,title FROM classical_search ${where} ORDER BY rank, title LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as Array<{ entity_id: string; kind: ClassicalEntityKind; title: string }>
    const items = all.slice(0, limit).map((hit) => this.summaryById(hit.entity_id, hit.kind)).filter((item): item is ClassicalEntitySummary => !!item)
    const total = Number(this.db.prepare(`SELECT COUNT(*) FROM classical_search ${where}`).pluck().get(...params) ?? 0)
    return { items, nextCursor: all.length > limit ? encodeCursor(offset + limit) : null, total }
  }

  summaryById(id: string, kind?: ClassicalEntityKind): ClassicalEntitySummary | null {
    const resolvedKind = kind ?? (this.db.prepare('SELECT kind FROM classical_search WHERE entity_id=? LIMIT 1').pluck().get(id) as ClassicalEntityKind | undefined)
    if (resolvedKind === 'work') {
      const row = this.db.prepare(`SELECT w.*, COUNT(DISTINCT rt.release_id) owned_count,
        COUNT(DISTINCT rec.id) recording_count, COUNT(DISTINCT wr.child_work_id) movement_count,
        group_concat(DISTINCT r.plex_rating_key) release_keys
        FROM works w LEFT JOIN release_tracks rt ON rt.work_id=w.id
        LEFT JOIN recordings rec ON rec.work_id=w.id LEFT JOIN work_relations wr ON wr.parent_work_id=w.id
        LEFT JOIN releases r ON r.id=rt.release_id WHERE w.id=? GROUP BY w.id`).get(id) as Record<string, unknown> | undefined
      return row ? this.workSummary(row) : null
    }
    if (resolvedKind === 'release') {
      const row = this.db.prepare('SELECT * FROM releases WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!row) return null
      return { id, kind: 'release', title: String(row.title ?? row.plex_rating_key), subtitle: row.artist ? String(row.artist) : null, period: null, genre: null, ownedCount: 1, imageUrl: row.thumb ? String(row.thumb) : null, externalIds: { ...(row.mbid ? { musicbrainz: String(row.mbid) } : {}), plex: String(row.plex_rating_key) } }
    }
    const row = this.db.prepare(`SELECT a.*, COUNT(DISTINCT r.id) owned_count FROM agents a
      LEFT JOIN work_agents wa ON wa.agent_id=a.id LEFT JOIN release_tracks rt ON rt.work_id=wa.work_id
      LEFT JOIN releases r ON r.id=rt.release_id WHERE a.id=? GROUP BY a.id`).get(id) as Record<string, unknown> | undefined
    return row ? this.agentSummary(row) : null
  }

  getComposer(id: string): ClassicalComposerDetail | null {
    const base = this.summaryById(id)
    if (!base || base.kind !== 'composer') return null
    const row = this.db.prepare('SELECT birth,death FROM agents WHERE id=?').get(id) as { birth: string | null; death: string | null }
    const aliases = (this.db.prepare('SELECT name FROM aliases WHERE entity_id=? ORDER BY name').pluck().all(id) as string[])
    const works = this.db.prepare(`SELECT w.*, COUNT(DISTINCT rt.release_id) owned_count,
      COUNT(DISTINCT rec.id) recording_count, COUNT(DISTINCT wr.child_work_id) movement_count,
      group_concat(DISTINCT r.plex_rating_key) release_keys
      FROM works w JOIN work_agents wa ON wa.work_id=w.id AND wa.role='composer'
      LEFT JOIN release_tracks rt ON rt.work_id=w.id LEFT JOIN recordings rec ON rec.work_id=w.id
      LEFT JOIN work_relations wr ON wr.parent_work_id=w.id LEFT JOIN releases r ON r.id=rt.release_id
      WHERE wa.agent_id=? GROUP BY w.id ORDER BY w.genre,w.title`).all(id) as Array<Record<string, unknown>>
    return { ...base, birth: row.birth, death: row.death, aliases, works: works.map((work) => this.workSummary(work)) }
  }

  private releaseSummary(row: Record<string, unknown>): ClassicalOwnedReleaseSummary {
    const id = String(row.id)
    const creditRows = this.db.prepare(`SELECT DISTINCT a.*,c.role,c.instrument,c.character_name
      FROM credits c JOIN agents a ON a.id=c.agent_id
      WHERE c.subject_id=? OR c.subject_id LIKE ? ORDER BY c.role,a.name`).all(id, `${id}:%`) as Array<Record<string, unknown>>
    return {
      id, kind: 'release', title: String(row.title ?? row.plex_rating_key), subtitle: row.artist ? String(row.artist) : null,
      period: null, genre: null, ownedCount: 1, imageUrl: row.thumb ? String(row.thumb) : null,
      externalIds: row.mbid ? { musicbrainz: String(row.mbid) } : {} as Record<string, string>,
      plexServerId: row.plex_server_id ? String(row.plex_server_id) : null, plexRatingKey: String(row.plex_rating_key),
      year: row.year == null ? null : Number(row.year), thumb: row.thumb ? String(row.thumb) : null,
      credits: creditRows.map((credit) => ({ agent: this.agentSummary(credit), role: String(credit.role), instrument: credit.instrument ? String(credit.instrument) : null, character: credit.character_name ? String(credit.character_name) : null }))
    }
  }

  getAgent(id: string): ClassicalAgentDetail | null {
    const base = this.summaryById(id)
    if (!base || (base.kind !== 'performer' && base.kind !== 'ensemble' && base.kind !== 'composer')) return null
    const aliases = this.db.prepare('SELECT name FROM aliases WHERE entity_id=? ORDER BY name').pluck().all(id) as string[]
    const roles = this.db.prepare('SELECT DISTINCT role FROM credits WHERE agent_id=? ORDER BY role').pluck().all(id) as string[]
    const releaseRows = this.db.prepare(`SELECT DISTINCT r.* FROM releases r JOIN credits c
      ON c.subject_id=r.id OR c.subject_id LIKE r.id || ':%' WHERE c.agent_id=? ORDER BY r.year,r.title`).all(id) as Array<Record<string, unknown>>
    const workRows = this.db.prepare(`SELECT DISTINCT w.*,COUNT(DISTINCT rt.release_id) owned_count,
      COUNT(DISTINCT rec.id) recording_count,COUNT(DISTINCT wr.child_work_id) movement_count,
      group_concat(DISTINCT r.plex_rating_key) release_keys
      FROM works w JOIN release_tracks rt ON rt.work_id=w.id JOIN releases r ON r.id=rt.release_id
      LEFT JOIN recordings rec ON rec.work_id=w.id LEFT JOIN work_relations wr ON wr.parent_work_id=w.id
      JOIN credits c ON c.subject_id=r.id OR c.subject_id=r.id || ':' || rt.plex_track_key
      WHERE c.agent_id=? GROUP BY w.id ORDER BY w.title`).all(id) as Array<Record<string, unknown>>
    return { ...base, aliases, roles, releases: releaseRows.map((row) => this.releaseSummary(row)), works: workRows.map((row) => this.workSummary(row)) }
  }

  getRelease(id: string): ClassicalReleaseDetail | null {
    const row = this.db.prepare('SELECT * FROM releases WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const release = this.releaseSummary(row)
    const workRows = this.db.prepare(`SELECT w.*,COUNT(DISTINCT rt.release_id) owned_count,
      COUNT(DISTINCT rec.id) recording_count,COUNT(DISTINCT wr.child_work_id) movement_count,
      group_concat(DISTINCT r.plex_rating_key) release_keys,group_concat(DISTINCT rt.plex_track_key) track_keys
      FROM works w JOIN release_tracks rt ON rt.work_id=w.id JOIN releases r ON r.id=rt.release_id
      LEFT JOIN recordings rec ON rec.work_id=w.id LEFT JOIN work_relations wr ON wr.parent_work_id=w.id
      WHERE rt.release_id=? GROUP BY w.id ORDER BY MIN(rt.rowid)`).all(id) as Array<Record<string, unknown>>
    const program = workRows.map((workRow) => ({
      work: this.workSummary(workRow),
      composers: (this.db.prepare("SELECT a.* FROM agents a JOIN work_agents wa ON wa.agent_id=a.id WHERE wa.work_id=? AND wa.role='composer'").all(String(workRow.id)) as Array<Record<string, unknown>>).map((agent) => this.agentSummary(agent)),
      trackKeys: workRow.track_keys ? String(workRow.track_keys).split(',') : []
    }))
    return { ...release, program }
  }

  getRecording(id: string): ClassicalRecordingDetail | null {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const work = row.work_id ? this.summaryById(String(row.work_id), 'work') as ClassicalWorkSummary | null : null
    const releaseRows = this.db.prepare('SELECT DISTINCT r.* FROM releases r JOIN release_tracks rt ON rt.release_id=r.id WHERE rt.recording_id=?').all(id) as Array<Record<string, unknown>>
    return {
      id, kind: 'recording', title: String(row.title ?? work?.title ?? 'Untitled recording'), subtitle: work?.title ?? null,
      period: work?.period ?? null, genre: work?.genre ?? null, ownedCount: releaseRows.length, imageUrl: null,
      externalIds: row.mbid ? { musicbrainz: String(row.mbid) } : {} as Record<string, string>,
      musicBrainzId: row.mbid ? String(row.mbid) : null, durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      matchMethod: row.match_method ? String(row.match_method) : null, confidence: row.confidence ? String(row.confidence) : null,
      work, releases: releaseRows.map((release) => this.releaseSummary(release)), credits: []
    }
  }

  getWork(id: string): ClassicalWorkDetail | null {
    const base = this.summaryById(id, 'work')
    if (!base || base.kind !== 'work') return null
    const work = base as ClassicalWorkSummary
    const composers = (this.db.prepare("SELECT a.* FROM agents a JOIN work_agents wa ON wa.agent_id=a.id WHERE wa.work_id=? AND wa.role='composer' ORDER BY a.name").all(id) as Array<Record<string, unknown>>).map((row) => this.agentSummary(row))
    const related = (direction: 'parent' | 'child'): ClassicalWorkSummary[] => {
      const join = direction === 'child' ? 'wr.child_work_id=w.id' : 'wr.parent_work_id=w.id'
      const filter = direction === 'child' ? 'wr.parent_work_id=?' : 'wr.child_work_id=?'
      return (this.db.prepare(`SELECT w.*, 0 owned_count, 0 recording_count, 0 movement_count, NULL release_keys FROM works w JOIN work_relations wr ON ${join} WHERE ${filter} ORDER BY wr.ordering,w.title`).all(id) as Array<Record<string, unknown>>).map((row) => this.workSummary(row))
    }
    const releaseRows = this.db.prepare(`SELECT DISTINCT r.* FROM releases r JOIN release_tracks rt ON rt.release_id=r.id WHERE rt.work_id=? ORDER BY r.year,r.title`).all(id) as Array<Record<string, unknown>>
    const releases = releaseRows.map((row) => this.releaseSummary(row))
    return { ...work, composers, children: related('child'), parents: related('parent'), releases }
  }

  getSyncStatus(): ClassicalSyncStatus {
    const get = (key: string): string | null => (this.db.prepare('SELECT value FROM sync_state WHERE key=?').pluck().get(key) as string | undefined) ?? null
    const pending = Number(this.db.prepare("SELECT COUNT(*) FROM sync_jobs WHERE status IN ('pending','running')").pluck().get() ?? 0)
    const failed = Number(this.db.prepare("SELECT COUNT(*) FROM sync_jobs WHERE status='failed'").pluck().get() ?? 0)
    const completed = Number(this.db.prepare("SELECT COUNT(*) FROM sync_jobs WHERE status='complete'").pluck().get() ?? 0)
    const phase = this.syncPaused() ? 'paused' : pending ? 'enriching' : failed ? 'error' : 'idle'
    return { phase, usable: this.getSourceVersion() !== null, completed, total: completed + pending + failed, current: null, pending, failed, lastOpenOpusRefresh: get('last_openopus_refresh'), lastLibrarySync: get('last_library_sync'), error: null }
  }

  claimNextSyncJob(): ClassicalSyncJob | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT j.id,j.subject_id release_id,j.attempts,
        r.plex_server_id,r.plex_rating_key,r.title,r.artist,r.year
        FROM sync_jobs j JOIN releases r ON r.id=j.subject_id
        WHERE j.kind='enrich-release' AND j.status='pending' AND j.available_at<=CURRENT_TIMESTAMP
        ORDER BY j.priority DESC,j.created_at LIMIT 1`).get() as Record<string, unknown> | undefined
      if (!row) return null
      this.db.prepare("UPDATE sync_jobs SET status='running',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(row.id))
      return {
        id: String(row.id), releaseId: String(row.release_id), serverId: String(row.plex_server_id ?? ''),
        ratingKey: String(row.plex_rating_key), title: String(row.title ?? ''), artist: String(row.artist ?? ''),
        year: row.year == null ? null : Number(row.year), attempts: Number(row.attempts) + 1
      }
    })()
  }

  completeSyncJob(id: string): void {
    this.db.prepare("UPDATE sync_jobs SET status='complete',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
  }

  failSyncJob(id: string, message: string, attempts: number): void {
    const terminal = attempts >= 5
    const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1))
    this.db.prepare(`UPDATE sync_jobs SET status=?,last_error=?,
      available_at=datetime('now', ?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(terminal ? 'failed' : 'pending', message.slice(0, 1000), `+${delayMinutes} minutes`, id)
  }

  pauseSyncJobs(): void {
    this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('sync_paused','1')").run()
  }

  resumeSyncJobs(): void {
    this.db.prepare("INSERT OR REPLACE INTO sync_state(key,value) VALUES('sync_paused','0')").run()
  }

  syncPaused(): boolean {
    return this.db.prepare("SELECT value FROM sync_state WHERE key='sync_paused'").pluck().get() === '1'
  }

  retryFailedSyncJobs(): number {
    return this.db.prepare("UPDATE sync_jobs SET status='pending',attempts=0,last_error=NULL,available_at=CURRENT_TIMESTAMP WHERE status='failed'").run().changes
  }

  recoverInterruptedSyncJobs(): number {
    return this.db.prepare(`UPDATE sync_jobs SET status='pending',attempts=MAX(0,attempts-1),
      available_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='running'`).run().changes
  }

  listReviewCandidates(limit = 100): ClassicalReviewCandidate[] {
    const rows = this.db.prepare("SELECT * FROM review_candidates WHERE status='pending' ORDER BY created_at LIMIT ?").all(limit) as Array<Record<string, unknown>>
    return rows.flatMap((row) => {
      const subject = this.summaryById(String(row.subject_id))
      if (!subject) return []
      return [{ id: String(row.id), kind: String(row.kind) as ClassicalReviewCandidate['kind'], subject, candidate: row.candidate_id ? this.summaryById(String(row.candidate_id)) : null, confidence: Number(row.confidence), evidence: JSON.parse(String(row.evidence_json)) as string[], createdAt: String(row.created_at) }]
    })
  }

  applyCorrection(command: ClassicalCorrectionCommand, metadata?: { id: string; createdAt: string }): ClassicalCorrection {
    const correction: ClassicalCorrection = { id: metadata?.id ?? randomUUID(), command, createdAt: metadata?.createdAt ?? new Date().toISOString(), undoneAt: null }
    this.db.transaction(() => {
      if (command.kind === 'preferred-title') {
        const work = this.db.prepare('SELECT id FROM works WHERE id=?').get(command.entityId)
        if (work) this.db.prepare('UPDATE works SET title=?,normalized_title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(command.title.trim(), normalize(command.title), command.entityId)
        else this.db.prepare('UPDATE agents SET name=?,normalized_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(command.title.trim(), normalize(command.title), command.entityId)
      } else if (command.kind === 'map-recording-work') {
        this.db.prepare('UPDATE recordings SET work_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(command.workId, command.recordingId)
      } else if (command.kind === 'dismiss-candidate') {
        this.db.prepare("UPDATE review_candidates SET status='dismissed' WHERE id=?").run(command.candidateId)
      } else if (command.kind === 'accept-candidate') {
        const candidate = this.db.prepare('SELECT subject_id,candidate_id FROM review_candidates WHERE id=?').get(command.candidateId) as { subject_id: string; candidate_id: string | null } | undefined
        if (!candidate?.candidate_id) throw new Error('Review candidate cannot be accepted')
        this.mergeEntities(candidate.candidate_id, candidate.subject_id)
        this.db.prepare("UPDATE review_candidates SET status='accepted' WHERE id=?").run(command.candidateId)
      } else if (command.kind === 'merge-entities') {
        this.mergeEntities(command.winnerId, command.loserId)
      }
      this.db.prepare('INSERT INTO corrections(id,command_json,created_at) VALUES(?,?,?)').run(correction.id, JSON.stringify(command), correction.createdAt)
      this.rebuildSearchIndex()
    })()
    return correction
  }

  hasCorrection(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM corrections WHERE id=?').get(id) !== undefined
  }

  private mergeEntities(winnerId: string, loserId: string): void {
    const winnerWork = this.db.prepare('SELECT id FROM works WHERE id=?').get(winnerId)
    const loserWork = this.db.prepare('SELECT id FROM works WHERE id=?').get(loserId)
    if (winnerWork && loserWork) {
      this.db.prepare('UPDATE OR IGNORE work_agents SET work_id=? WHERE work_id=?').run(winnerId, loserId)
      this.db.prepare('UPDATE recordings SET work_id=? WHERE work_id=?').run(winnerId, loserId)
      this.db.prepare('UPDATE release_tracks SET work_id=? WHERE work_id=?').run(winnerId, loserId)
      this.db.prepare('UPDATE external_ids SET entity_id=? WHERE entity_id=?').run(winnerId, loserId)
      this.db.prepare('DELETE FROM works WHERE id=?').run(loserId)
      return
    }
    this.db.prepare('UPDATE OR IGNORE work_agents SET agent_id=? WHERE agent_id=?').run(winnerId, loserId)
    this.db.prepare('UPDATE OR IGNORE credits SET agent_id=? WHERE agent_id=?').run(winnerId, loserId)
    this.db.prepare('UPDATE external_ids SET entity_id=? WHERE entity_id=?').run(winnerId, loserId)
    this.db.prepare('DELETE FROM agents WHERE id=?').run(loserId)
  }
}
