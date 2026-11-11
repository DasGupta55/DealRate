// In-app notifications — brand replies, approvals, overdue invoices.
// One row per event; the sync and the approval flow insert them, and
// the client lists them (badge = unread count) and marks them read.
// Notifications are never duplicated for the same underlying event
// because the sync inserts one per saved message and the approval
// flow inserts one per approval.

import { z } from "zod";
import { requireVerifiedUser } from "../lib/auth";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type NotificationRow,
} from "../lib/db";
import { userIdArg } from "./common";

export interface NotificationOut {
  id: number;
  dealId: number | null;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

function toNotificationOut(r: NotificationRow): NotificationOut {
  return {
    id: r.id,
    dealId: r.deal_id,
    type: r.type,
    title: r.title,
    body: r.body,
    isRead: r.is_read,
    createdAt: r.created_at,
  };
}

export const listNotificationsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function listNotifications(
  ctx: ActionCtx,
  args: z.infer<typeof listNotificationsSchema>,
): Promise<{ notifications: NotificationOut[]; unreadCount: number }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { data, error } = await db
    .from("notifications")
    .select("*")
    .eq("owner_id", args.userId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 30);
  dbThrow(error, "listNotifications");
  const rows = (data ?? []) as NotificationRow[];
  return {
    notifications: rows.map(toNotificationOut),
    unreadCount: rows.filter((r) => !r.is_read).length,
  };
}

export const markNotificationReadSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  notificationId: z.number().int().positive(),
});

export async function markNotificationRead(
  ctx: ActionCtx,
  args: z.infer<typeof markNotificationReadSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { error } = await db
    .from("notifications")
    .update({ is_read: true })
    .eq("id", args.notificationId)
    .eq("owner_id", args.userId);
  dbThrow(error, "markNotificationRead");
  return { ok: true };
}

export const markAllNotificationsReadSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export async function markAllNotificationsRead(
  ctx: ActionCtx,
  args: z.infer<typeof markAllNotificationsReadSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { error } = await db
    .from("notifications")
    .update({ is_read: true })
    .eq("owner_id", args.userId)
    .eq("is_read", false);
  dbThrow(error, "markAllNotificationsRead");
  return { ok: true };
}
