import { AdminProvider } from "./admin";

export default function ServerSettingsLayout({ children }: LayoutProps<"/settings/server">) {
  return <AdminProvider>{children}</AdminProvider>;
}
