"use client";

import { useRouter } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { SeedPicker } from "@/components/spice/seed-picker";

export default function NewSpicePage() {
  const library = useLibrary();
  const router = useRouter();
  return (
    <SeedPicker
      kind="New Spice"
      title="What should it taste like?"
      intro="Pick a few songs you love. Harmoni grows a mix from them, and makes it fresh every day."
      action="Make it"
      onDone={async (seeds, name) => {
        const id = await library.createSpice(seeds, name);
        if (id) router.replace(`/spice/${id}`);
      }}
    />
  );
}
