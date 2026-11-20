import { ImportLibrary } from "../import-library";
import { SettingsPage } from "../parts";

export default function ImportPage() {
  return (
    <SettingsPage title="Import music" description="Bring your library, playlists and listening history from Spotify or Apple Music. Files are read on your device and only the music in them is uploaded.">
      <ImportLibrary />
    </SettingsPage>
  );
}
