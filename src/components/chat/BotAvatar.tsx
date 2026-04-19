"use client";

import { useEffect, useState } from "react";
import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";

export type BotAvatarState = "idle" | "thinking" | "speaking" | "happy";

interface Props {
  state?: BotAvatarState;
  size?: number;
  className?: string;
}

const ANIMATION_CLASSES: Record<BotAvatarState, string> = {
  idle: "animate-[float_3s_ease-in-out_infinite]",
  thinking: "animate-[pulse-think_2s_ease-in-out_infinite]",
  speaking: "animate-[bounce-speak_0.6s_ease-in-out_infinite]",
  happy: "animate-[happy-pop_0.5s_ease-out]",
};

export function BotAvatar({ state = "idle", size = 28, className }: Props) {
  const [dataUri, setDataUri] = useState<string>("");

  useEffect(() => {
    const avatar = createAvatar(bottts, {
      seed: "quorum-bot",
      size: 128,
      radius: 50,
    });
    setDataUri(avatar.toDataUri());
  }, []);

  const animClass = ANIMATION_CLASSES[state] ?? "";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${animClass} ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {dataUri ? (
        <img
          src={dataUri}
          alt="Quorum Bot"
          width={size}
          height={size}
          className="rounded-full"
        />
      ) : (
        <div
          className="rounded-full bg-foreground"
          style={{ width: size, height: size }}
        />
      )}
    </div>
  );
}
