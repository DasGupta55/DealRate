// YouTube Data API v3 — direct server-side calls replacing the
// Muse-internal spawned agent task + custom.youtube connector helper.
//
// Call chain (3 quota units per fetch, NEVER search.list):
//   channels.list (forHandle or id)
//     -> uploads playlist from contentDetails.relatedPlaylists
//     -> playlistItems.list (maxResults 10)
//     -> videos.list (statistics for the last 10 videos)
//
// Field mapping mirrors the connector helper exactly: averages are rounded
// to 1 decimal, engagement is (sum likes + sum comments) / sum views * 100
// rounded to 2 decimals, and missing counts default to 0. Never invent
// numbers; on failure throw a YouTubeApiError carrying a plain-words,
// user-facing message.

export class YouTubeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface ChannelStats {
  channelId: string;
  title: string;
  handle: string | null;
  ytCountry: string | null;
  subscribers: number;
  totalViews: number;
  totalVideos: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  engagementPct: number;
}

const BASE = "https://www.googleapis.com/youtube/v3";

async function ytGet(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, key: apiKey });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}?${qs}`, {
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new YouTubeApiError(
      "YouTube couldn't be reached. Check your connection and try again.",
    );
  }
  if (!res.ok) {
    if (res.status === 403) {
      throw new YouTubeApiError(
        "YouTube rejected the lookup (API key or quota). Try again later.",
      );
    }
    if (res.status === 404) {
      throw new YouTubeApiError("Couldn't find that YouTube channel.");
    }
    throw new YouTubeApiError(
      "YouTube lookup failed. Try again in a moment.",
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

type ResolvedQuery =
  | { kind: "id"; id: string }
  | { kind: "handle"; handle: string }
  | { kind: "username"; username: string };

function resolveQuery(query: string): ResolvedQuery {
  const q = query.trim();
  if (!q) throw new YouTubeApiError("Enter a channel handle, ID or link.");
  if (/^https?:\/\//i.test(q)) {
    let url: URL;
    try {
      url = new URL(q);
    } catch {
      throw new YouTubeApiError(
        "That link doesn't look like a YouTube channel link.",
      );
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") {
      throw new YouTubeApiError(
        "That link isn't a YouTube channel link. Paste a youtube.com channel link, a handle like @name, or a channel ID.",
      );
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) {
      return { kind: "id", id: parts[1] };
    }
    if (parts[0]?.startsWith("@")) {
      return { kind: "handle", handle: parts[0].slice(1) };
    }
    if (parts[0] === "c" && parts[1]) {
      return { kind: "handle", handle: parts[1] };
    }
    if (parts[0] === "user" && parts[1]) {
      return { kind: "username", username: parts[1] };
    }
    throw new YouTubeApiError(
      "That YouTube link doesn't point to a channel page. Open the channel page and copy its link, or paste a handle like @name.",
    );
  }
  if (/^UC[\w-]{22}$/.test(q)) return { kind: "id", id: q };
  if (q.startsWith("@") && q.length > 1) {
    return { kind: "handle", handle: q.slice(1) };
  }
  if (/^[A-Za-z0-9][\w.-]{0,63}$/.test(q)) {
    return { kind: "handle", handle: q };
  }
  throw new YouTubeApiError(
    "Enter a channel handle like @name, a channel ID, or a YouTube channel link.",
  );
}

interface YtChannel {
  id: string;
  snippet: {
    title: string;
    customUrl?: string;
    country?: string;
  };
  statistics: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
  };
  contentDetails: {
    relatedPlaylists?: { uploads?: string };
  };
}

async function getChannel(
  apiKey: string,
  resolved: ResolvedQuery,
): Promise<YtChannel> {
  const params: Record<string, string> = {
    part: "snippet,statistics,contentDetails",
  };
  if (resolved.kind === "id") params.id = resolved.id;
  else if (resolved.kind === "handle") {
    // The connector helper passes the handle WITH the "@" prefix.
    params.forHandle = resolved.handle.startsWith("@")
      ? resolved.handle
      : `@${resolved.handle}`;
  } else {
    params.forUsername = resolved.username;
  }
  const data = await ytGet(apiKey, "channels", params);
  const items = (data.items ?? []) as YtChannel[];
  if (items.length > 0) return items[0] as YtChannel;
  // Legacy /c/ names sometimes resolve only via forUsername.
  if (resolved.kind === "handle") {
    const retry = await ytGet(apiKey, "channels", {
      part: "snippet,statistics,contentDetails",
      forUsername: resolved.handle,
    });
    const retryItems = (retry.items ?? []) as YtChannel[];
    if (retryItems.length > 0) return retryItems[0] as YtChannel;
  }
  throw new YouTubeApiError(
    "Couldn't find that YouTube channel. Check the handle or link and try again.",
  );
}

export async function fetchChannelStats(
  apiKey: string,
  query: string,
): Promise<ChannelStats> {
  if (!apiKey) {
    throw new YouTubeApiError(
      "YouTube lookup isn't configured yet. Try manual numbers instead.",
    );
  }
  const resolved = resolveQuery(query);
  const ch = await getChannel(apiKey, resolved);
  const sn = ch.snippet ?? {};
  const st = ch.statistics ?? {};
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;

  let views: number[] = [];
  let likes: number[] = [];
  let comments: number[] = [];
  if (uploads) {
    const pl = await ytGet(apiKey, "playlistItems", {
      part: "contentDetails",
      playlistId: uploads,
      maxResults: "10",
    });
    const plItems = (pl.items ?? []) as {
      contentDetails?: { videoId?: string };
    }[];
    const ids = plItems
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => !!v);
    if (ids.length > 0) {
      const vids = await ytGet(apiKey, "videos", {
        part: "snippet,statistics",
        id: ids.join(","),
      });
      const vidItems = (vids.items ?? []) as {
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }[];
      views = vidItems.map((v) => Number(v.statistics?.viewCount ?? 0));
      likes = vidItems.map((v) => Number(v.statistics?.likeCount ?? 0));
      comments = vidItems.map((v) => Number(v.statistics?.commentCount ?? 0));
    }
  }
  const n = views.length;
  const sumViews = views.reduce((a, b) => a + b, 0);
  const sumLikes = likes.reduce((a, b) => a + b, 0);
  const sumComments = comments.reduce((a, b) => a + b, 0);
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    channelId: ch.id,
    title: sn.title ?? "",
    handle: sn.customUrl ?? null,
    ytCountry: sn.country ?? null,
    subscribers: Number(st.subscriberCount ?? 0),
    totalViews: Number(st.viewCount ?? 0),
    totalVideos: Number(st.videoCount ?? 0),
    avgViews: n ? round1(sumViews / n) : 0,
    avgLikes: n ? round1(sumLikes / n) : 0,
    avgComments: n ? round1(sumComments / n) : 0,
    engagementPct: sumViews
      ? Math.round(((sumLikes + sumComments) / sumViews) * 100 * 100) / 100
      : 0,
  };
}
