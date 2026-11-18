"use client";

import { useEffect, useState } from "react";
import { useServer, useUser } from "@/components/providers/user";
import { dailySpiceLabel, dayPart, deviceTimeZone } from "@/lib/day-part";

export const DAILY_SPICE_HREF = "/spice/daily";

// Someone's Daily Spice as the sidebar and library show it: "Ejaz's Spice",
// with the part of the day it's in now. Null while loading, or when the
// server has Super Processing off (nothing to make it from).
export function useDailySpice(): { label: string; part: string } | null {
  const user = useUser();
  const server = useServer();
  const [now, setNow] = useState<Date | null>(null);

  // Set after mounting (the server can't know the device's time), and again
  // each time the part of the day ends.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = new Date();
      setNow(at);
      const ends = dayPart(at, deviceTimeZone() ?? "UTC").endsAt.getTime();
      timer = setTimeout(tick, Math.max(60_000, ends - at.getTime() + 1000));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  if (!user || !now || !server?.features.superProcessing) return null;
  return { label: dailySpiceLabel(user.name), part: dayPart(now, deviceTimeZone() ?? "UTC").label };
}
