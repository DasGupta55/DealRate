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
  listBrandContacts,
  listBrandContactsSchema,
  researchBrand,
  researchBrandSchema,
  selectBrandContact,
  selectBrandContactSchema,
} from "./actions/brandResearch";
import {
  addBrand,
  addBrandSchema,
  addBrandToDeals,
  addBrandToDealsSchema,
  deleteBrand,
  deleteBrandSchema,
  discoverBrands,
  discoverBrandsSchema,
  enrichBrandEmails,
  enrichBrandEmailsSchema,
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
import {
  disconnectGmail,
  disconnectGmailSchema,
  getGmailStatus,
  getGmailStatusSchema,
  saveGmailToken,
  saveGmailTokenSchema,
  syncGmailNow,
  syncGmailNowSchema,
} from "./actions/gmail";
import {
  approveDeal,
  approveDealSchema,
  createInvoiceFromDeal,
  createInvoiceFromDealSchema,
  generateReplyDraft,
  generateReplyDraftSchema,
  listContentSubmissions,
  listContentSubmissionsSchema,
  listDealMessages,
  listDealMessagesSchema,
  sendDealReply,
  sendDealReplySchema,
  submitContent,
  submitContentSchema,
  updateDealStage,
  updateDealStageSchema,
} from "./actions/replies";
import {
  listNotifications,
  listNotificationsSchema,
  markAllNotificationsRead,
  markAllNotificationsReadSchema,
  markNotificationRead,
  markNotificationReadSchema,
} from "./actions/notifications";

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
  enrichBrandEmails: asHandler(enrichBrandEmails),
  addBrand: asHandler(addBrand),
  addBrandToDeals: asHandler(addBrandToDeals),
  researchBrand: asHandler(researchBrand),
  listBrandContacts: asHandler(listBrandContacts),
  selectBrandContact: asHandler(selectBrandContact),
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
  saveGmailToken: asHandler(saveGmailToken),
  getGmailStatus: asHandler(getGmailStatus),
  disconnectGmail: asHandler(disconnectGmail),
  syncGmailNow: asHandler(syncGmailNow),
  listDealMessages: asHandler(listDealMessages),
  generateReplyDraft: asHandler(generateReplyDraft),
  sendDealReply: asHandler(sendDealReply),
  approveDeal: asHandler(approveDeal),
  submitContent: asHandler(submitContent),
  listContentSubmissions: asHandler(listContentSubmissions),
  createInvoiceFromDeal: asHandler(createInvoiceFromDeal),
  updateDealStage: asHandler(updateDealStage),
  listNotifications: asHandler(listNotifications),
  markNotificationRead: asHandler(markNotificationRead),
  markAllNotificationsRead: asHandler(markAllNotificationsRead),
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
  enrichBrandEmails: typeof enrichBrandEmails;
  addBrand: typeof addBrand;
  addBrandToDeals: typeof addBrandToDeals;
  researchBrand: typeof researchBrand;
  listBrandContacts: typeof listBrandContacts;
  selectBrandContact: typeof selectBrandContact;
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
  saveGmailToken: typeof saveGmailToken;
  getGmailStatus: typeof getGmailStatus;
  disconnectGmail: typeof disconnectGmail;
  syncGmailNow: typeof syncGmailNow;
  listDealMessages: typeof listDealMessages;
  generateReplyDraft: typeof generateReplyDraft;
  sendDealReply: typeof sendDealReply;
  approveDeal: typeof approveDeal;
  submitContent: typeof submitContent;
  listContentSubmissions: typeof listContentSubmissions;
  createInvoiceFromDeal: typeof createInvoiceFromDeal;
  updateDealStage: typeof updateDealStage;
  listNotifications: typeof listNotifications;
  markNotificationRead: typeof markNotificationRead;
  markAllNotificationsRead: typeof markAllNotificationsRead;
};

export const ActionSchemas: Record<string, z.ZodTypeAny> = {
  getDashboard: getDashboardSchema,
  requestChannelFetch: requestChannelFetchSchema,
  saveManualProfile: saveManualProfileSchema,
  calculatePrice: calculatePriceSchema,
  deleteCalculation: deleteCalculationSchema,
  discoverBrands: discoverBrandsSchema,
  enrichBrandEmails: enrichBrandEmailsSchema,
  addBrand: addBrandSchema,
  addBrandToDeals: addBrandToDealsSchema,
  researchBrand: researchBrandSchema,
  listBrandContacts: listBrandContactsSchema,
  selectBrandContact: selectBrandContactSchema,
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
  saveGmailToken: saveGmailTokenSchema,
  getGmailStatus: getGmailStatusSchema,
  disconnectGmail: disconnectGmailSchema,
  syncGmailNow: syncGmailNowSchema,
  listDealMessages: listDealMessagesSchema,
  generateReplyDraft: generateReplyDraftSchema,
  sendDealReply: sendDealReplySchema,
  approveDeal: approveDealSchema,
  submitContent: submitContentSchema,
  listContentSubmissions: listContentSubmissionsSchema,
  createInvoiceFromDeal: createInvoiceFromDealSchema,
  updateDealStage: updateDealStageSchema,
  listNotifications: listNotificationsSchema,
  markNotificationRead: markNotificationReadSchema,
  markAllNotificationsRead: markAllNotificationsReadSchema,
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
