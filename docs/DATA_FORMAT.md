# Annales data format

Annales is one app in the Abditum suite and shares the origin `andromedajolan.github.io` with the others, so it only uses names that start with `annales`. The one shared key is `studio.theme`, which it reads and follows. Every format below is versioned with `schema`. Unknown fields are ignored on import and ids never change.

## Storage names

| What | Name |
| --- | --- |
| IndexedDB database | `annales-db` (stores `songs`, `releases`) |
| Cache | `annales-cache-<version>` |
| localStorage | `annales.settings`, `annales.ui`, `annales.lastBackup`, `annales.summary` |
| Shared (read, and written only from the Theme setting) | `studio.theme` = `dark` \| `gray` \| `light` |

## Backup file (`annales-backup`, schema 1)

Made by Data → Export catalogue as `annales-backup-YYYY-MM-DD.json`.

```json
{
  "format": "annales-backup",
  "schema": 1,
  "app": "annales",
  "appVersion": "0.1.0",
  "exported": "2026-11-20T18:00:00.000Z",
  "songs": [ { "...": "see Song" } ],
  "releases": [ { "...": "see Release" } ]
}
```

Import refuses a backup with a higher `schema` than the app knows. Merge keeps both sides and takes the record with the newer `updated`. Replace makes the backup the whole catalogue. Songs that point to a release missing from the result lose that link.

### Song

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable, `[A-Za-z0-9_-]`, up to 80 characters |
| `title`, `artist` | string | `artist` is the artist name used (she has several) |
| `releaseId` | string or null | The release this song is on |
| `track` | integer or null | Track number on that release |
| `key`, `mode`, `timeSig` | string | e.g. `A`, `minor`, `4/4` |
| `bpm` | number or null | 20 to 400 |
| `length` | integer or null | Seconds |
| `releaseDate` | `YYYY-MM-DD` or `""` | |
| `status` | string | `idea`, `written`, `produced`, `mastered`, `released` |
| `isrc`, `upc` | string | Typed by hand |
| `copyright` | `{ status, date }` | `status`: `none`, `pending`, `registered`; `date`: `YYYY-MM-DD` or `""` |
| `meaning` | string | What the song is about, in her words |
| `notes` | string | |
| `stilusId` | string | Id of the linked Stilus song, or `""` |
| `created`, `updated` | ISO 8601 UTC | |

### Release

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable |
| `type` | string | `album`, `single`, `pool` |
| `title`, `artist` | string | |
| `plannedDate`, `actualDate` | `YYYY-MM-DD` or `""` | |
| `distributor`, `upc` | string | |
| `cover` | `{ thumb, name }` or null | `thumb` is a small `data:image/jpeg;base64,...` (max 320 px); `name` is the file name of the full-size cover |
| `links` | `[{ platform, url }]` | |
| `notes` | string | |
| `created`, `updated` | ISO 8601 UTC | |

The tracklist is not stored on the release. It is the songs whose `releaseId` is the release, ordered by `track`.

## Stilus import

Accepted: a Stilus backup (`format: "lyricwriter-backup"` with a `songs` array), an array of songs, or one song. Only these Stilus fields are read: `id`, `title`, `key`, `mode`, `bpm`, `timeSig`, `release` (`type`: `none`, `album`, `single`, `pool`; `name`), `notes.meaning`, `created`. Anything else is ignored. Songs without an `id` are skipped.

The Stilus `id` is kept as `stilusId`, so importing again updates the same song instead of adding a copy.

- New song: status `written`, artist = the default artist name from Settings. If the Stilus release has a type and name, the matching release (same type and title) is reused or created, and the song is added at the next track number.
- Existing song: Stilus updates `title`, `key`, `mode`, `bpm`, `timeSig` and `meaning`, but an empty Stilus value never clears what is already here. Status, IDs, rights, notes and the track number are never touched. A release is only linked if the song has none yet.

## Launcher hooks (read-only for Ianua)

`localStorage["annales.summary"]`, schema 1:

```json
{
  "schema": 1,
  "appId": "annales",
  "version": "0.1.0",
  "lastOpened": "2026-11-20T18:00:00.000Z",
  "recent": [ { "id": "sng_ab12cd34ef56ab12", "title": "Song title", "updated": "2026-11-20T17:58:00.000Z" } ]
}
```

`recent` holds up to 8 songs and releases, newest edit first.

`/annales/suite-app.json`:

```json
{ "schema": 1, "id": "annales", "name": "Annales", "version": "0.1.0", "updated": "2026-11-20" }
```
