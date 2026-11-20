"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { ui } from "@/components/ui";
import type { SongResult } from "@/server/library/song-view";
import styles from "./song.module.css";

// The heart. Liking it gives a small springy pop, so you feel it land.
export function LikeButton({ song, className, size }: { song: SongResult; className?: string; size?: number }) {
  const library = useLibrary();
  const liked = library.isLiked(song.id);
  const [pop, setPop] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`${ui.iconButton} ${styles.likeButton} ${className ?? ""}`}
      aria-pressed={liked}
      aria-label={liked ? "Remove from Liked" : "Add to Liked"}
      title={liked ? "Remove from Liked" : "Add to Liked"}
      data-pop={pop || undefined}
      style={size ? { fontSize: size } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!liked) {
          setPop(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setPop(false), 600);
        }
        library.toggleLike(song);
      }}
    >
      <Icon name={liked ? "heart-solid" : "heart"} />
    </button>
  );
}
