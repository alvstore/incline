// Shared AI tool registry — used by whatsapp-webhook + meta-webhook (IG/FB)
// v1.1.0 — added classes, renewal, addon intent, branch services, escalation status

export type MemberContext = {
  isMember?: boolean;
  memberId?: string;
  memberName: string;
  branchId: string;
  membershipId?: string | null;
  planId?: string | null;
  contextPrompt: string;
};

export function getAllToolDefinitions() {
  return [
    // Membership & Account
    tool("get_membership_status",
      "Get the member's current membership status: plan name, expiry date, days remaining, and any pending dues."),
    tool("get_member_profile",
      "Get the member's profile: name, contact, branch and join date."),
    tool("update_member_contact",
      "Update the member's email or phone. Always confirm with the member before calling.",
      { email: ["string", "New email address"], phone: ["string", "New phone with country code"] }),
    tool("request_freeze",
      "Submit a membership freeze request for staff approval.",
      {
        from_date: ["string", "Freeze start date YYYY-MM-DD"],
        to_date: ["string", "Freeze end date YYYY-MM-DD"],
        reason: ["string", "Reason for freeze"],
      }, ["from_date", "to_date"]),
    tool("request_resume",
      "Resume a frozen membership immediately.", {}),

    // Benefits & Bookings
    tool("get_benefit_balance",
      "Get remaining benefit credits (sauna, ice bath, group classes). Optional benefit_type filter.",
      { benefit_type: ["string", "Optional: 'sauna', 'ice_bath', 'group_classes', etc."] }),
    tool("get_available_slots",
      "List available facility booking slots.",
      {
        facility_type: ["string", "Type of facility e.g. 'sauna', 'ice_bath'"],
        date: ["string", "YYYY-MM-DD. Defaults to today."],
      }, ["facility_type"]),
    tool("book_facility_slot",
      "Book a facility slot. Use slot_id from get_available_slots.",
      { slot_id: ["string", "UUID of the slot"] }, ["slot_id"]),
    tool("cancel_facility_booking",
      "Cancel an existing facility booking.",
      { booking_id: ["string", "UUID of booking"] }, ["booking_id"]),
    tool("list_my_bookings",
      "List the member's upcoming facility bookings."),

    // Personal Training
    tool("get_pt_balance",
      "Get personal training (PT) sessions balance and package expiry."),
    tool("list_trainers",
      "List active trainers at the member's branch."),
    tool("book_pt_session",
      "Book a PT session with a trainer.",
      {
        trainer_id: ["string", "Trainer UUID from list_trainers"],
        scheduled_at: ["string", "ISO 8601 datetime"],
        duration_minutes: ["number", "Defaults to 60"],
      }, ["trainer_id", "scheduled_at"]),
    tool("cancel_pt_session",
      "Cancel an upcoming PT session.",
      { session_id: ["string", "PT session UUID"] }, ["session_id"]),

    // Payments & Billing
    tool("get_outstanding_dues",
      "Total pending invoice amount for the member, grouped by invoice."),
    tool("list_invoices",
      "Recent invoices with status (paid / pending / overdue)."),
    tool("send_invoice_pdf",
      "Send the invoice PDF link to the member via WhatsApp.",
      { invoice_id: ["string", "Invoice UUID"] }, ["invoice_id"]),
    tool("create_payment_link",
      "Generate a secure Razorpay payment link for an open invoice.",
      { invoice_id: ["string", "Invoice UUID"] }, ["invoice_id"]),
    tool("get_wallet_balance",
      "Get wallet balance and last transactions."),
    tool("pay_with_wallet",
      "Apply wallet credit toward an open invoice. Confirm amount with member first.",
      {
        invoice_id: ["string", "Invoice UUID"],
        amount: ["number", "Amount to apply (max = pending due)"],
      }, ["invoice_id", "amount"]),

    // Engagement & Loyalty
    tool("get_rewards_balance",
      "Get loyalty rewards points balance and recent activity."),
    tool("redeem_reward",
      "Redeem points for a reward. Confirm option before calling.",
      {
        points: ["number", "Points to redeem"],
        reason: ["string", "Reward description"],
      }, ["points", "reason"]),
    tool("get_referral_link",
      "Personalised referral link for the member."),
    tool("list_announcements",
      "Active branch announcements and offers."),
    tool("list_store_products",
      "Browse merchandise / supplements at the member's branch.",
      { category: ["string", "Optional category filter"] }),

    // Branch info
    tool("get_branch_info",
      "Branch address, phone, opening hours."),
    tool("get_class_schedule",
      "Group class schedule.",
      { date: ["string", "YYYY-MM-DD, defaults to today"] }),
    tool("book_class",
      "Book a spot in a group class. Use class_id from get_class_schedule. Confirms capacity before booking.",
      { class_id: ["string", "Class UUID from get_class_schedule"] }, ["class_id"]),
    tool("cancel_class_booking",
      "Cancel an existing group class booking.",
      { booking_id: ["string", "Class booking UUID"] }, ["booking_id"]),

    // Renewal & Add-On intents (return checkout / payment links — never charge directly)
    tool("initiate_membership_renewal",
      "Generate a renewal invoice + payment link for the member's current plan. Member pays via the returned link. Confirm with the member before calling.",
      { plan_id: ["string", "Optional plan UUID. Defaults to current plan."] }),
    tool("purchase_addon_intent",
      "Return a checkout link for a benefit or PT add-on package the member can buy. Use list_branch_services to find package_id and kind.",
      {
        package_id: ["string", "Package UUID (benefit_packages.id or pt_packages.id)"],
        kind: ["string", "'benefit' or 'pt'"],
      }, ["package_id", "kind"]),
    tool("list_branch_services",
      "List facilities, group classes today, and available benefit/PT add-on packages at the member's home branch."),

    // Request status & escalation
    tool("escalate_request",
      "Mark the conversation as needing manual staff review (handoff with optional category). Use for complex questions, complaints, or if the member wants something not listed.",
      {
        category: ["string", "Brief category e.g. 'billing', 'membership', 'complaint', 'diet_workout'"],
        reason: ["string", "Why escalation is needed"],
      }, ["reason"]),
    tool("get_request_status",
      "Look up the latest status of a member's pending requests (freezes, transfers, escalations)."),

    // Escalation
    tool("transfer_to_human",
      "Hand off conversation to gym staff. Use for complaints, manager requests, or repeated errors.",
      { reason: ["string", "Brief reason"] }),

    // Fitness Plans (Self-Service)
    tool("get_my_fitness_plans",
      "List the member's current active workout and diet plans."),
  ];
}

function tool(
  name: string,
  description: string,
  paramsSpec: Record<string, [string, string]> = {},
  required: string[] = [],
) {
  const properties: Record<string, any> = {};
  for (const [k, [type, desc]] of Object.entries(paramsSpec)) {
    properties[k] = { type, description: desc };
  }
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}
