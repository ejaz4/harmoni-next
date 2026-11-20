import { AccountSettings } from "./account";
import { SettingsIndex } from "./nav";
import s from "./settings.module.css";

// Wide screens open on Account, beside the categories; narrow ones open on
// the list of categories itself.
export default function SettingsHome() {
  return (
    <>
      <SettingsIndex />
      <div className={s.wideOnly}>
        <AccountSettings />
      </div>
    </>
  );
}
