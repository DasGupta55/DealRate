// Action registry — the single place that maps the 30 source action names
// to their standalone handlers.
//
// Deliberate differences from the source's 30 (spec §5.5 gaps closed):
//  - `saveChannelFetch` is NOT exposed: it was a trusted internal callback
//    with no auth. The YouTube fetch now runs inline inside
//    `requestChannelFetch` (see actions/profiles.ts), so there is no
//    callback to expose. POST /api/saveChannelFetch -> 404.
//  - `handleRazorpayWebhook` is NOT a public action: the webhook logic
//    lives in server/src/webhook.ts behind a real POST route that reads
//    the raw body and the X-Razorpay-Signature header and FAILS CLOSED
//    without a valid signature. POST /api/handleRazorpayWebhook -> 404.
//
// That leaves 28 public actions in `Actions`. Each entry has a matching
// zod schema in `ActionSchemas` (same key); the router validates the
// request body against the schema before calling the handler.
// Plus 3 one-click Gmail send actions (sendPitch, sendInvoice,
// sendInvoiceReminder), added later — 31 public actions total.

import { z } from "zod";
import type { ActionCtx } from "./lib/db";
import {
  getDashboard,
  getDashboardSchema,
} from "./actions/dashboard";
import {
  calculatePrice,
  calculatePriceSchema,
  deleteCalculation,
  deleteCalculationSchema,
  requestChannelFetch,
  requestChannelFetchSchema,
  saveManualProfile,
  saveManualProfileSchema,
} from "./actions/profiles";
import {
  addBrand,
  addBrandSchema,
  addBrandToDeals,
  addBrandToDealsSchema,
  deleteBrand,
  deleteBrandSchema,
  discoverBrands,
  discoverBrandsSchema,
} from "./actions/brands";
import {
  createDeal,
  createDealSchema,
  deleteDeal,
  deleteDealSchema,
  generatePitch,
  generatePitchSchema,
  requestSendPitch,
  requestSendPitchSchema,
  savePitch,
  savePitchSchema,
  sendPitch,
  sendPitchSchema,
  updateDeal,
  updateDealSchema,
} from "./actions/deals";
import {
  checkOverdueInvoices,
  checkOverdueInvoicesSchema,
  createInvoice,
  createInvoiceSchema,
  deleteInvoice,
  deleteInvoiceSchema,
  requestInvoiceReminder,
  requestInvoiceReminderSchema,
  sendInvoice,
  sendInvoiceReminder,
  sendInvoiceReminderSchema,
  sendInvoiceSchema,
  updateInvoiceStatus,
  updateInvoiceStatusSchema,
} from "./actions/invoices";
import {
  cancelPro,
  cancelProSchema,
  createProOrder,
  createProOrderSchema,
  deleteAccountData,
  deleteAccountDataSchema,
  getProCheckoutInfo,
  getProCheckoutInfoSchema,
  listManualPayments,
  listManualPaymentsSchema,
  reviewManualPayment,
  reviewManualPaymentSchema,
  submitManualPayment,
  submitManualPaymentSchema,
  verifyProPayment,
  verifyProPaymentSchema,
} from "./actions/payments";
import {
  updateSettings,
  updateSettingsSchema,
} from "./actions/settings";

export type ActionHandler = (
  ctx: ActionCtx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
) => Promise<unknown>;

// Each handler is typed against its own schema; the registry stores them
// behind the common handler shape (the router parses with the schema
// first, so the cast is safe).
function asHandler(
  fn: (ctx: ActionCtx, args: never) => Promise<unknown>,
): ActionHandler {
  return fn as ActionHandler;
}

export const Actions: Record<string, ActionHandler> = {
  getDashboard: asHandler(getDashboard),
  requestChannelFetch: asHandler(requestChannelFetch),
  saveManualProfile: asHandler(saveManualProfile),
  calculatePrice: asHandler(calculatePrice),
  deleteCalculation: asHandler(deleteCalculation),
  discoverBrands: asHandler(discoverBrands),
  addBrand: asHandler(addBrand),
  addBrandToDeals: asHandler(addBrandToDeals),
  deleteBrand: asHandler(deleteBrand),
  createDeal: asHandler(createDeal),
  updateDeal: asHandler(updateDeal),
  deleteDeal: asHandler(deleteDeal),
  generatePitch: asHandler(generatePitch),
  savePitch: asHandler(savePitch),
  requestSendPitch: asHandler(requestSendPitch),
  sendPitch: asHandler(sendPitch),
  createInvoice: asHandler(createInvoice),
  updateInvoiceStatus: asHandler(updateInvoiceStatus),
  deleteInvoice: asHandler(deleteInvoice),
  requestInvoiceReminder: asHandler(requestInvoiceReminder),
  sendInvoiceReminder: asHandler(sendInvoiceReminder),
  sendInvoice: asHandler(sendInvoice),
  checkOverdueInvoices: asHandler(checkOverdueInvoices),
  getProCheckoutInfo: asHandler(getProCheckoutInfo),
  createProOrder: asHandler(createProOrder),
  verifyProPayment: asHandler(verifyProPayment),
  submitManualPayment: asHandler(submitManualPayment),
  listManualPayments: asHandler(listManualPayments),
  reviewManualPayment: asHandler(reviewManualPayment),
  cancelPro: asHandler(cancelPro),
  deleteAccountData: asHandler(deleteAccountData),
  updateSettings: asHandler(updateSettings),
};

// Precise per-action handler types for the client. The Actions record
// above erases each handler to the common ActionHandler shape, so the
// client types its RPC proxy against this map instead: each entry is
// the un-cast handler (ctx, args: z.infer<typeof XSchema>) =>
// Promise<Out>, and the client's MethodFor drops the ctx parameter.
export type ActionHandlers = {
  getDashboard: typeof getDashboard;
  requestChannelFetch: typeof requestChannelFetch;
  saveManualProfile: typeof saveManualProfile;
  calculatePrice: typeof calculatePrice;
  deleteCalculation: typeof deleteCalculation;
  discoverBrands: typeof discoverBrands;
  addBrand: typeof addBrand;
  addBrandToDeals: typeof addBrandToDeals;
  deleteBrand: typeof deleteBrand;
  createDeal: typeof createDeal;
  updateDeal: typeof updateDeal;
  deleteDeal: typeof deleteDeal;
  generatePitch: typeof generatePitch;
  savePitch: typeof savePitch;
  requestSendPitch: typeof requestSendPitch;
  sendPitch: typeof sendPitch;
  createInvoice: typeof createInvoice;
  updateInvoiceStatus: typeof updateInvoiceStatus;
  deleteInvoice: typeof deleteInvoice;
  requestInvoiceReminder: typeof requestInvoiceReminder;
  sendInvoiceReminder: typeof sendInvoiceReminder;
  sendInvoice: typeof sendInvoice;
  checkOverdueInvoices: typeof checkOverdueInvoices;
  getProCheckoutInfo: typeof getProCheckoutInfo;
  createProOrder: typeof createProOrder;
  verifyProPayment: typeof verifyProPayment;
  submitManualPayment: typeof submitManualPayment;
  listManualPayments: typeof listManualPayments;
  reviewManualPayment: typeof reviewManualPayment;
  cancelPro: typeof cancelPro;
  deleteAccountData: typeof deleteAccountData;
  updateSettings: typeof updateSettings;
};

export const ActionSchemas: Record<string, z.ZodTypeAny> = {
  getDashboard: getDashboardSchema,
  requestChannelFetch: requestChannelFetchSchema,
  saveManualProfile: saveManualProfileSchema,
  calculatePrice: calculatePriceSchema,
  deleteCalculation: deleteCalculationSchema,
  discoverBrands: discoverBrandsSchema,
  addBrand: addBrandSchema,
  addBrandToDeals: addBrandToDealsSchema,
  deleteBrand: deleteBrandSchema,
  createDeal: createDealSchema,
  updateDeal: updateDealSchema,
  deleteDeal: deleteDealSchema,
  generatePitch: generatePitchSchema,
  savePitch: savePitchSchema,
  requestSendPitch: requestSendPitchSchema,
  sendPitch: sendPitchSchema,
  createInvoice: createInvoiceSchema,
  updateInvoiceStatus: updateInvoiceStatusSchema,
  deleteInvoice: deleteInvoiceSchema,
  requestInvoiceReminder: requestInvoiceReminderSchema,
  sendInvoiceReminder: sendInvoiceReminderSchema,
  sendInvoice: sendInvoiceSchema,
  checkOverdueInvoices: checkOverdueInvoicesSchema,
  getProCheckoutInfo: getProCheckoutInfoSchema,
  createProOrder: createProOrderSchema,
  verifyProPayment: verifyProPaymentSchema,
  submitManualPayment: submitManualPaymentSchema,
  listManualPayments: listManualPaymentsSchema,
  reviewManualPayment: reviewManualPaymentSchema,
  cancelPro: cancelProSchema,
  deleteAccountData: deleteAccountDataSchema,
  updateSettings: updateSettingsSchema,
};

export type ActionName = keyof typeof Actions;

// Shared wire output types (defined in actions/common.ts).
export type {
  BrandOut,
  CalcOut,
  DealOut,
  InvoiceOut,
  ManualPaymentOut,
  PitchDraft,
  ProfileOut,
  ProPaymentOut,
  ReminderOut,
} from "./actions/common";
export type { DashboardOut } from "./actions/dashboard";
