import Link from "next/link";

import { LatestPost } from "~/app/_components/post";
import { api, HydrateClient } from "~/trpc/server";
import styles from "./index.module.css";

export default async function Home() {
  return (
    <HydrateClient>
      <main className={styles.main}></main>
    </HydrateClient>
  );
}
