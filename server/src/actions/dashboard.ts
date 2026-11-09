// getDashboard — the whole workspace read. Unverified callers get the
// public config + empty lists only; NULL-owner rows are never returned.

import { z } from "zod";
import { todayKolkata } from "../lib/pricing";
import {
  isPublicId,
  userProStatus,
  verifyUserToken,
} from "../lib/auth";
import { DEFAULT_SUPABASE_URL } from "../lib/env";
import {
  dbThrow,
  ensureSettings,
  requireDb,
  type ActionCtx,
  type BrandRow,
  type CalculationRow,
  type DealRow,
  type InvoiceRow,
  type ManualPaymentRow,
  type ProfileRow,
  type ProPaymentRow,
  type ReminderRow,
} from "../lib/db";
import {
  toBrandOut,
  toCalcOut,
  toDealOut,
  toInvoiceOut,
  toManualPaymentOut,
  toProfileOut,
  toProPaymentOut,
  toReminderOut,
  type BrandOut,
  type CalcOut,
  type DealOut,
  type InvoiceOut,
  type ManualPaymentOut,
  type ProfileOut,
  type ProPaymentOut,
  type ReminderOut,
} from "./common";

export const getDashboardSchema = z.object({
  userId: z.string().optional(),
  accessToken: z.string().optional(),
});

export interface DashboardOut {
  profile: ProfileOut | null;
  profiles: ProfileOut[];
  calculations: CalcOut[];
  brands: BrandOut[];
  deals: DealOut[];
  invoices: InvoiceOut[];
  reminders: ReminderOut[];
  plan: string;
  proActive: boolean;
  proBilling: string | null;
  proStartsAt: string | null;
  proExpiresAt: string | null;
  proDaysLeft: number | null;
  proCancelled: boolean;
  proPayments: ProPaymentOut[];
  manualPayments: ManualPaymentOut[];
  paymentMode: string;
  inrRate: number;
  today: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseConfigured: boolean;
  supabaseKeyHint: string | null;
  senderEmail: string | null;
  senderConnected: boolean;
  payLinkInrMonthly: string | null;
  payLinkInrAnnual: string | null;
  payLinkUsdMonthly: string | null;
  payLinkUsdAnnual: string | null;
}

export async function getDashboard(
  ctx: ActionCtx,
  args: z.infer<typeof getDashboardSchema>,
): Promise<DashboardOut> {
  const db = requireDb(ctx);
  const today = todayKolkata();
  const s = await ensureSettings(db);

  let userId =
    args.userId && args.userId.trim() ? args.userId.trim() : null;
  let senderEmail: string | null = null;
  if (userId && isPublicId(userId)) {
    // Guest / demo reviewer: keep the id so their own fetched channel
    // profiles read back; neither has an email or a sender, and neither
    // can hold Pro or payment rows.
    senderEmail = null;
  } else if (userId) {
    const verified = await verifyUserToken(
      ctx.env,
      userId,
      args.accessToken ?? ctx.accessToken,
    );
    if (!verified) userId = null;
    else senderEmail = verified.email;
  }

  const proSub =
    userId && !isPublicId(userId) ? await userProStatus(db, userId) : null;

  const empty = {
    profiles: [] as ProfileRow[],
    calculations: [] as CalculationRow[],
    brands: [] as BrandRow[],
    deals: [] as DealRow[],
    invoices: [] as InvoiceRow[],
    reminders: [] as ReminderRow[],
    proPayments: [] as ProPaymentRow[],
    manualPayments: [] as ManualPaymentRow[],
  };
  const rows = userId
    ? await (async () => {
        const list = async <T>(
          table: string,
          limit: number,
        ): Promise<T[]> => {
          const { data, error } = await db
            .from(table)
            .select("*")
            .eq("owner_id", userId)
            .order("id", { ascending: false })
            .limit(limit);
          dbThrow(error, `getDashboard ${table}`);
          return (data ?? []) as T[];
        };
        const [profiles, calculations, brands, deals, invoices, reminders, proPayments, manualPayments] =
          await Promise.all([
            list<ProfileRow>("profiles", 10),
            list<CalculationRow>("calculations", 20),
            list<BrandRow>("brands", 60),
            list<DealRow>("deals", 60),
            list<InvoiceRow>("invoices", 60),
            list<ReminderRow>("reminders", 40),
            list<ProPaymentRow>("pro_payments", 20),
            list<ManualPaymentRow>("manual_payments", 10),
          ]);
        return {
          profiles,
          calculations,
          brands,
          deals,
          invoices,
          reminders,
          proPayments,
          manualPayments,
        };
      })()
    : empty;

  // Second layer over the DB-level owner filter (source behaviour).
  const mine = <T,>(list: T[], get: (r: T) => string | null): T[] =>
    userId ? list.filter((r) => get(r) === userId) : [];
  const profiles = mine(rows.profiles, (p) => p.owner_id);
  const doneProfile =
    profiles.find((p) => p.status === "done" || p.status === "manual") ??
    null;
  const calcs = mine(rows.calculations, (c) => c.owner_id);
  const gmailEmail = userId ? senderEmail : null;

  return {
    profile: doneProfile
      ? toProfileOut(doneProfile)
      : profiles[0]
        ? toProfileOut(profiles[0])
        : null,
    profiles: profiles.map(toProfileOut),
    calculations: calcs.map(toCalcOut),
    brands: rows.brands.map(toBrandOut),
    deals: rows.deals.map(toDealOut),
    invoices: rows.invoices.map((r) => toInvoiceOut(r, today)),
    reminders: rows.reminders.map(toReminderOut),
    plan: s?.plan ?? "free",
    proActive: !!proSub,
    proBilling: proSub?.billing ?? null,
    proStartsAt: proSub?.startsAt ? proSub.startsAt.toISOString() : null,
    proExpiresAt: proSub ? proSub.expiresAt.toISOString() : null,
    proDaysLeft: proSub?.daysLeft ?? null,
    proCancelled: proSub?.cancelled ?? false,
    proPayments: rows.proPayments.map(toProPaymentOut),
    manualPayments: rows.manualPayments.map(toManualPaymentOut),
    paymentMode: s?.payment_mode === "manual" ? "manual" : "automatic",
    inrRate: s?.inr_rate ?? 83.5,
    today,
    supabaseUrl: s?.supabase_url ?? DEFAULT_SUPABASE_URL,
    supabaseAnonKey: s?.supabase_anon_key ?? null,
    supabaseConfigured: !!s?.supabase_anon_key,
    supabaseKeyHint: s?.supabase_anon_key
      ? `${s.supabase_anon_key.slice(0, 7)}…${s.supabase_anon_key.slice(-4)}`
      : null,
    senderEmail: gmailEmail,
    senderConnected: !!gmailEmail,
    payLinkInrMonthly: s?.pay_link_inr_monthly ?? null,
    payLinkInrAnnual: s?.pay_link_inr_annual ?? null,
    payLinkUsdMonthly: s?.pay_link_usd_monthly ?? null,
    payLinkUsdAnnual: s?.pay_link_usd_annual ?? null,
  };
}
