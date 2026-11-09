// Profiles + calculator: channel fetch, manual profile, price calc.

import { z } from "zod";
import {
  computePrice,
  DELIVERABLE_MULT,
  NICHE_MULT,
} from "../lib/pricing";
import {
  isPublicId,
  requireVerifiedUser,
} from "../lib/auth";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type ProfileRow,
} from "../lib/db";
import {
  fetchChannelStats,
  YouTubeApiError,
} from "../lib/youtube";
import { userIdArg, type CalcOut } from "./common";

export const requestChannelFetchSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  query: z.string().min(2),
});

/**
 * Standalone replacement for the spawned agent task: the YouTube fetch
 * runs INLINE on the server (create the profile row as "pending", call
 * YouTube Data API v3, update to "done" with stats or "error" with a
 * plain-words message). Same polling contract — the client polls
 * getDashboard until the profile becomes done/error — but the returned
 * status is the row's actual final status. There is no saveChannelFetch
 * public action: the trusted internal callback gap is closed.
 */
export async function requestChannelFetch(
  ctx: ActionCtx,
  args: z.infer<typeof requestChannelFetchSchema>,
): Promise<{ profileId: number; status: string }> {
  const db = requireDb(ctx);
  // Public channel stats are free for everyone: a signed-in user verifies
  // as usual; a guest/demo id fetches under its own namespace.
  if (!isPublicId(args.userId)) {
    await requireVerifiedUser(ctx, args.userId, args.accessToken);
  }
  const { data, error } = await db
    .from("profiles")
    .insert({
      owner_id: args.userId,
      query: args.query,
      status: "pending",
    })
    .select("id")
    .single();
  dbThrow(error, "requestChannelFetch insert");
  if (!data) throw new Error("requestChannelFetch: insert returned no rows");
  const profileId = (data as { id: number }).id;

  const setError = async (message: string) => {
    const { error: updateError } = await db
      .from("profiles")
      .update({ status: "error", error: message })
      .eq("id", profileId);
    dbThrow(updateError, "requestChannelFetch error update");
    return { profileId, status: "error" };
  };

  if (!ctx.env.youtubeApiKey) {
    return setError(
      "YouTube lookup isn't configured yet. Try manual numbers instead.",
    );
  }
  try {
    const stats = await fetchChannelStats(ctx.env.youtubeApiKey, args.query);
    const { error: updateError } = await db
      .from("profiles")
      .update({
        status: "done",
        error: null,
        channel_id: stats.channelId,
        title: stats.title,
        handle: stats.handle,
        yt_country: stats.ytCountry,
        subscribers: stats.subscribers,
        total_views: stats.totalViews,
        total_videos: stats.totalVideos,
        avg_views: stats.avgViews,
        avg_likes: stats.avgLikes,
        avg_comments: stats.avgComments,
        engagement_pct: stats.engagementPct,
        fetched_at: new Date().toISOString(),
      })
      .eq("id", profileId);
    dbThrow(updateError, "requestChannelFetch done update");
    return { profileId, status: "done" };
  } catch (e) {
    if (e instanceof YouTubeApiError) return setError(e.message);
    return setError("Could not fetch that channel. Try manual numbers instead.");
  }
}

export const saveManualProfileSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  label: z.string().min(1),
  avgViews: z.number().positive(),
  engagementPct: z.number().min(0).max(100),
  subscribers: z.number().nonnegative().optional(),
});

export async function saveManualProfile(
  ctx: ActionCtx,
  args: z.infer<typeof saveManualProfileSchema>,
): Promise<{ profileId: number }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { data, error } = await db
    .from("profiles")
    .insert({
      owner_id: args.userId,
      query: args.label,
      title: args.label,
      status: "manual",
      avg_views: args.avgViews,
      engagement_pct: args.engagementPct,
      subscribers: args.subscribers ?? null,
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  dbThrow(error, "saveManualProfile insert");
  if (!data) throw new Error("saveManualProfile: insert returned no rows");
  return { profileId: (data as { id: number }).id };
}

export const calculatePriceSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  label: z.string().min(1),
  avgViews: z.number().positive(),
  engagementPct: z.number().min(0).max(100),
  audienceCountry: z.string().min(1),
  niche: z.string().min(1),
  deliverable: z.string().min(1),
  cpm: z.number().positive().max(1000),
});

export async function calculatePrice(
  ctx: ActionCtx,
  args: z.infer<typeof calculatePriceSchema>,
): Promise<CalcOut> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  // Unknown niche/deliverable fall back to 1.0 — no validation error.
  // The CPM is client-supplied; the server never looks it up in the
  // COUNTRY_CPM table (the table lives in the client for the preview).
  const nicheMult = NICHE_MULT[args.niche] ?? 1.0;
  const deliverableMult = DELIVERABLE_MULT[args.deliverable] ?? 1.0;
  const p = computePrice({
    avgViews: args.avgViews,
    engagementPct: args.engagementPct,
    cpm: args.cpm,
    nicheMult,
    deliverableMult,
  });
  const { data, error } = await db
    .from("calculations")
    .insert({
      owner_id: args.userId,
      label: args.label,
      avg_views: args.avgViews,
      engagement_pct: args.engagementPct,
      audience_country: args.audienceCountry,
      niche: args.niche,
      deliverable: args.deliverable,
      cpm: args.cpm,
      niche_mult: nicheMult,
      deliverable_mult: deliverableMult,
      engagement_factor: p.engagementFactor,
      price_low: p.low,
      price_mid: p.mid,
      price_high: p.high,
    })
    .select("id, created_at")
    .single();
  dbThrow(error, "calculatePrice insert");
  if (!data) throw new Error("calculatePrice: insert returned no rows");
  const row = data as { id: number; created_at: string };
  return {
    id: row.id,
    label: args.label,
    avgViews: args.avgViews,
    engagementPct: args.engagementPct,
    audienceCountry: args.audienceCountry,
    niche: args.niche,
    deliverable: args.deliverable,
    cpm: args.cpm,
    nicheMult,
    deliverableMult,
    engagementFactor: p.engagementFactor,
    priceLow: p.low,
    priceMid: p.mid,
    priceHigh: p.high,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const deleteCalculationSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
});

export async function deleteCalculation(
  ctx: ActionCtx,
  args: z.infer<typeof deleteCalculationSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { error } = await db
    .from("calculations")
    .delete()
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "deleteCalculation");
  return { ok: true };
}
