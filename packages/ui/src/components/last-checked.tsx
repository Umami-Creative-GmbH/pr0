"use client";
import { useEffect, useState } from "react";

const age = (at: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
export const LastChecked = ({ at }: { at?: string | null }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return at ? (
    <p>
      Last checked for updates{" "}
      <time dateTime={at} title={new Date(at).toLocaleString()}>
        {age(at, now)}
      </time>
      .
      <span className="block text-sm">
        Exact check time: {new Date(at).toLocaleString()}. Other devices may
        still have changes to upload.
      </span>
    </p>
  ) : (
    <p>Not yet checked for updates.</p>
  );
};
