import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { LISTEN_ENDS } from "./import-library";
import { readSpotifyExport, readSpotifyFiles } from "./spotify-library";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const json = (name: string, data: unknown) => ({ name, text: JSON.stringify(data) });

const library = json("Spotify Account Data/YourLibrary.json", {
  tracks: [
    { artist: "TINI", album: "Futttura Live", track: "Intro Futttura", uri: "spotify:track:0aaaaaaaaaaaaaaaaaaaaa" },
    { artist: "Mitski", album: "Be the Cowboy", track: "Nobody", uri: "spotify:track:1bbbbbbbbbbbbbbbbbbbbb" },
  ],
  albums: [],
  artists: [],
  bannedTracks: [],
});

const playlists = json("Spotify Account Data/Playlist1.json", {
  playlists: [
    {
      name: "Road trip",
      lastModifiedDate: "2025-06-01",
      description: "windows down",
      items: [
        { track: { trackName: "Nobody", artistName: "Mitski", albumName: "Be the Cowboy", trackUri: "spotify:track:1bbbbbbbbbbbbbbbbbbbbb" }, episode: null, localTrack: null, addedDate: "2025-06-01" },
        { track: null, episode: { episodeName: "A podcast" }, localTrack: null, addedDate: "2025-06-01" },
        { track: null, episode: null, localTrack: { uri: "spotify:local:Burial:Untrue:Archangel:238" }, addedDate: "2025-06-02" },
      ],
    },
    { name: "Road trip", items: [] },
  ],
});

const extended = json("Spotify Extended Streaming History/Streaming_History_Audio_2024-2025_0.json", [
  { ts: "2025-03-01T08:15:00Z", ms_played: 180000, master_metadata_track_name: "Nobody", master_metadata_album_artist_name: "Mitski", master_metadata_album_album_name: "Be the Cowboy", spotify_track_uri: "spotify:track:1bbbbbbbbbbbbbbbbbbbbb", reason_end: "trackdone", skipped: false },
  { ts: "2025-03-01T08:16:00Z", ms_played: 9000, master_metadata_track_name: "Intro Futttura", master_metadata_album_artist_name: "TINI", master_metadata_album_album_name: "Futttura Live", spotify_track_uri: "spotify:track:0aaaaaaaaaaaaaaaaaaaaa", reason_end: "fwdbtn", skipped: true },
  { ts: "2025-03-01T23:00:00Z", ms_played: 100000, master_metadata_track_name: "Secret", master_metadata_album_artist_name: "Someone", spotify_track_uri: "spotify:track:2ccccccccccccccccccccc", reason_end: "trackdone", incognito_mode: true },
  { ts: "2025-03-02T09:00:00Z", ms_played: 600000, master_metadata_track_name: null, episode_name: "A podcast", spotify_episode_uri: "spotify:episode:x", reason_end: "endplay" },
  { ts: "2025-03-02T10:00:00Z", ms_played: 120000, master_metadata_track_name: "New Song", master_metadata_album_artist_name: "Someone", spotify_track_uri: "spotify:track:3ddddddddddddddddddddd", reason_end: "logout" },
]);

// "Account data"'s year of plays: no ids, minutes only, overlapping the full history.
const year = json("Spotify Account Data/StreamingHistory_music_0.json", [
  { endTime: "2025-03-01 08:15", artistName: "Mitski", trackName: "Nobody", msPlayed: 180000 },
  { endTime: "2025-04-01 07:30", artistName: "Mitski", trackName: "Nobody", msPlayed: 175000 },
  { endTime: "2025-04-01 07:35", artistName: "Phoebe Bridgers", trackName: "Motion Sickness", msPlayed: 20000 },
]);

describe("readSpotifyExport", () => {
  const lib = readSpotifyExport([library, playlists, extended, year, json("Spotify Account Data/Userdata.json", { username: "x" })], NOW);
  const byTitle = (t: string) => lib.tracks.find((x) => x.title === t)!;

  test("Liked Songs are the library, newest first", () => {
    expect(lib.source).toBe("spotify");
    expect(lib.tracks.filter((t) => t.inLibrary).map((t) => t.title)).toEqual(["Intro Futttura", "Nobody"]);
    expect(Date.parse(byTitle("Intro Futttura").addedAt!)).toBeGreaterThan(Date.parse(byTitle("Nobody").addedAt!));
    expect(byTitle("Intro Futttura").id).toBe("0aaaaaaaaaaaaaaaaaaaaa");
    expect(byTitle("Intro Futttura").album).toBe("Futttura Live");
  });

  test("playlists keep their songs and order, local files included, podcasts not", () => {
    expect(lib.playlists.map((p) => p.id)).toEqual(["Road trip", "Road trip#2"]);
    const [trip] = lib.playlists;
    expect(trip.description).toBe("windows down");
    expect(trip.trackIds.map((id) => lib.tracks.find((t) => t.id === id)!.title)).toEqual(["Nobody", "Archangel"]);
    expect(byTitle("Archangel")).toMatchObject({ artist: "Burial", album: "Untrue", durationMs: 238_000, inLibrary: false });
  });

  test("every play, with how it ended; private sessions and podcasts left out", () => {
    const listens = lib.listens!;
    const plays = listens.map(([i, at, ms, end]) => [lib.tracks[i].title, new Date(at * 1000).toISOString(), ms, LISTEN_ENDS[end]]);
    expect(plays).toEqual([
      ["Nobody", "2025-03-01T08:15:00.000Z", 180000, "ended"],
      ["Intro Futttura", "2025-03-01T08:16:00.000Z", 9000, "skip"],
      ["New Song", "2025-03-02T10:00:00.000Z", 120000, "close"],
      // From the year of plays: only what's after the full history, found by name.
      ["Nobody", "2025-04-01T07:30:00.000Z", 175000, "unknown"],
      ["Motion Sickness", "2025-04-01T07:35:00.000Z", 20000, "unknown"],
    ]);
    expect(lib.tracks.some((t) => t.title === "Secret")).toBe(false);
    expect(byTitle("Nobody")).toMatchObject({ plays: 2, skips: 0, playedAt: "2025-04-01T07:30:00.000Z" });
    expect(byTitle("Intro Futttura")).toMatchObject({ plays: 0, skips: 1 });
  });

  test("the year of plays on its own", () => {
    const only = readSpotifyExport([year], NOW);
    expect(only.listens).toHaveLength(3);
    expect(only.tracks.map((t) => t.id)).toEqual(["n0", "n1"]);
  });

  test("anything else is turned away", () => {
    expect(() => readSpotifyExport([json("x.json", { hello: 1 })], NOW)).toThrow(/doesn't look like your Spotify data/);
  });
});

test("reads the zips Spotify sends, zip in a zip included", async () => {
  const inner = zipSync({ "Spotify Extended Streaming History/Streaming_History_Audio_2024-2025_0.json": strToU8(extended.text) });
  const outer = zipSync({
    [library.name]: strToU8(library.text),
    "Spotify Account Data/StreamingHistory_podcast_0.json": strToU8("[]"),
    "nested.zip": inner,
  });
  const lib = await readSpotifyFiles([new File([outer], "my_spotify_data.zip")]);
  expect(lib.tracks.filter((t) => t.inLibrary)).toHaveLength(2);
  expect(lib.listens).toHaveLength(3);
});
