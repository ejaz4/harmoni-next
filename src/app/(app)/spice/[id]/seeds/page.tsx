"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { useToast } from "@/components/providers/toast";
import { CollectionSkeleton } from "@/components/song/collection";
import { SeedPicker } from "@/components/spice/seed-picker";
import { EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { SpicePage } from "@/server/discovery/spice";

export default function SpiceSeedsRoute() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <SpiceSeeds />
    </Suspense>
  );
}

function SpiceSeeds() {
  const { id } = useParams<{ id: string }>();
  const library = useLibrary();
  const router = useRouter();
  const toast = useToast();
  const { data, error } = useApi<SpicePage>(`/api/spices/${id}`);

  if (error || data?.kind === "search") return <EmptyState title="Spice not found" body="It may have been deleted, or it belongs to someone else." />;
  if (!data) return <CollectionSkeleton />;
  return (
    <SeedPicker
      key={data.id}
      kind={data.name}
      title="Change what it grows from"
      intro="Add songs or take some away. It remakes itself from them the next time you open it."
      initial={data.seeds}
      name={data.autoNamed ? undefined : data.name}
      action="Save"
      onDone={async (seeds, name) => {
        try {
          await api(`/api/spices/${id}/seeds`, { method: "PUT", json: { songIds: seeds.map((s) => s.id) } });
          // No name means named after its songs again.
          if ((name ?? null) !== (data.autoNamed ? null : data.name)) await api(`/api/spices/${id}`, { method: "PATCH", json: { name: name ?? null } });
          await library.refreshSpices();
          router.replace(`/spice/${id}`);
        } catch {
          toast("Couldn't save that. Try again?", "error");
        }
      }}
    />
  );
}
