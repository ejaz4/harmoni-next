import { describe, expect, test } from "bun:test";
import { readAppleLibrary } from "./apple-library";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Major Version</key><integer>1</integer>
	<key>Tracks</key>
	<dict>
		<key>10</key>
		<dict>
			<key>Track ID</key><integer>10</integer>
			<key>Name</key><string>Sway to My Beat in Cosmos</string>
			<key>Artist</key><string>Robin, HOYO-MiX &#38; Chevy</string>
			<key>Album</key><string>INSIDE - EP</string>
			<key>Total Time</key><integer>165463</integer>
			<key>Date Added</key><date>2025-10-31T19:59:45Z</date>
			<key>Play Count</key><integer>11</integer>
			<key>Play Date UTC</key><date>2026-07-04T11:13:28Z</date>
			<key>Skip Count</key><integer>5</integer>
			<key>Loved</key><true/>
			<key>Explicit</key><true/>
		</dict>
		<key>12</key>
		<dict>
			<key>Track ID</key><integer>12</integer>
			<key>Name</key><string>夜に駆ける</string>
			<key>Artist</key><string>YOASOBI</string>
			<key>Playlist Only</key><true/>
		</dict>
		<key>14</key>
		<dict>
			<key>Track ID</key><integer>14</integer>
			<key>Name</key><string>A Podcast</string>
			<key>Podcast</key><true/>
		</dict>
	</dict>
	<key>Playlists</key>
	<array>
		<dict><key>Name</key><string>Library</string><key>Master</key><true/><key>Playlist Persistent ID</key><string>A</string></dict>
		<dict><key>Name</key><string>Music</string><key>Distinguished Kind</key><integer>4</integer><key>Playlist Persistent ID</key><string>B</string></dict>
		<dict>
			<key>Name</key><string>sleep</string>
			<key>Description</key><string>quiet &amp; slow</string>
			<key>Playlist Persistent ID</key><string>C</string>
			<key>Playlist Items</key>
			<array>
				<dict><key>Track ID</key><integer>12</integer></dict>
				<dict><key>Track ID</key><integer>14</integer></dict>
				<dict><key>Track ID</key><integer>10</integer></dict>
			</array>
		</dict>
		<dict><key>Name</key><string>Empty</string><key>Playlist Persistent ID</key><string>D</string><key>Playlist Items</key><array/></dict>
	</array>
</dict>
</plist>`;

describe("readAppleLibrary", () => {
  const lib = readAppleLibrary(xml);

  test("reads songs, leaving out what isn't music", () => {
    expect(lib.tracks.map((t) => t.title)).toEqual(["Sway to My Beat in Cosmos", "夜に駆ける"]);
    expect(lib.tracks[0]).toEqual({
      id: "10",
      title: "Sway to My Beat in Cosmos",
      artist: "Robin, HOYO-MiX & Chevy",
      album: "INSIDE - EP",
      durationMs: 165463,
      explicit: true,
      inLibrary: true,
      loved: true,
      addedAt: "2025-10-31T19:59:45.000Z",
      plays: 11,
      playedAt: "2026-07-04T11:13:28.000Z",
      skips: 5,
      skippedAt: undefined,
    });
    expect(lib.tracks[1].inLibrary).toBe(false);
  });

  test("keeps their playlists in order, not Apple's own", () => {
    expect(lib.playlists).toEqual([
      { id: "C", name: "sleep", description: "quiet & slow", trackIds: ["12", "10"] },
      { id: "D", name: "Empty", description: undefined, trackIds: [] },
    ]);
  });

  test("anything else is refused", () => {
    expect(() => readAppleLibrary("<html>nope</html>")).toThrow();
  });
});
