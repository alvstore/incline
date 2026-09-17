# Coexistence, chat inbox, mobile chat UI, and a real Visual Flow Builder

Four pieces of work.

---

## 1. Messages we send don't appear in Meta's own inbox — adopt coexistence

Cause: the number is connected through the Cloud API only. Cloud API
conversations and WhatsApp Business app conversations are separate surfaces, so
CRM sends are stored correctly on our side but never appear on the phone app or
in Meta Business Suite. The fix is to run the number in **coexistence** mode, so
the team can chat from the phone while the CRM and automations keep running on
the same number.

Adopting coexistence, without breaking anything that works today:

- **Onboarding:** the number is re-linked through the provider's coexistence
  onboarding (select coexistence, scan the code from the WhatsApp Business app,
  approve the link). The existing number, templates, campaigns, automations and
  history stay in place — this is a link, not a migration, and the account is
  never deleted.
- **Two-way visibility once linked:**
  - Messages staff send from the phone app arrive as echo events on the webhook
    and are stored as outbound bubbles in our chat thread, attributed to "sent
    from phone" so they are distinguishable from CRM sends.
  - Messages sent from the CRM appear in the phone app conversation.
- **History import:** a one-time pull of recent phone-app conversations into the
  CRM thread, deduplicated against messages we already hold. This is only
  available in a short window right after linking, so it runs as part of the
  onboarding step.
- **Safety:** echoes are de-duplicated against the messages we already sent, so
  no double bubbles; the AI assistant never auto-replies to a conversation a
  human just answered from the phone; do-not-contact and paused-chat rules still
  apply.
- **Status panel:** a WhatsApp settings card showing whether the number is in
  coexistence mode, when it was linked, whether history import ran, and clear
  step-by-step instructions plus troubleshooting for the common "number already
  connected" error.
- A verification pass confirming every outbound path (manual reply, automated
  reminder, campaign, AI reply) writes a thread bubble on our side. Anything
  found missing gets fixed.

Note: the onboarding itself needs a few minutes of your hands-on time in the
provider flow and on the phone. Everything else is built and ready before that.

---

## 2. Chat screen rebuilt for mobile

Today the chat screen is a fixed three-pane desktop layout with no phone
breakpoints, so it is unusable below tablet width.

New behaviour:

- **Phone:** one pane at a time. Conversation list fills the screen; tapping a
  chat slides in the thread with a back arrow, contact name, avatar and channel
  badge in a compact top bar. Contact details open as a bottom sheet.
- **Composer:** sticky to the bottom, safe-area aware, grows with typed text,
  attachment and send controls at comfortable touch size, keyboard never covers
  the last message.
- **Filters:** the All / WhatsApp / Instagram / Messenger triage becomes a
  horizontally scrollable chip row with unread counts.
- **Tablet and desktop:** unchanged two- and three-pane behaviour, with polish —
  tighter bubble rhythm, clearer day separators, delivery ticks, and skeleton,
  empty and error states throughout.
- Verified with a real browser at phone, tablet and desktop widths before
  hand-off.

Styling stays on the existing design system (indigo/violet, rounded-2xl, soft
shadows, Inter).

---

## 3. Visual Flow Builder — a real editable canvas

The current screen is a static explainer list. It gets replaced with a
node-graph editor in the style of the reference image.

Canvas:

- Pan, zoom, fit-to-view, grid background, mini-map.
- Nodes dragged from a side palette, connected by dragging between ports,
  selected, duplicated and deleted.
- Clicking a node opens a right-side drawer with that node's settings.
- Save, revert, and version history; a draft can be edited without affecting
  live behaviour until published.

Node types, matching what the assistant actually does:

- **Trigger** — inbound message (WhatsApp / Instagram / Messenger), campaign
  reply, or manual start.
- **Safety gate** — do-not-contact, paused chat, off-topic.
- **Identify** — member / team member / lead branch, with an output per branch.
- **Agent** — persona, tone, knowledge scope, which model behaviour applies.
- **Tool** — one node per operational tool (dues, bookings, attendance, plans…),
  each attachable to an agent node.
- **Condition** — route on a value such as role, membership status, or keyword.
- **Human handoff** — assign to staff, raise a follow-up task.
- **Send** — reply on the same channel, or hand to the message dispatcher.
- **End**.

Critically, the saved graph **drives behaviour**: the inbound message handler
reads the published flow and follows it — which agent answers, which tools that
agent may call, and where a person takes over. Existing role and permission
rules still apply on top of the graph, so a flow can never grant a lead access
to member data or financials.

Safeguards: validation before publish (unreachable nodes, missing connections,
tool attached to the wrong agent), and a built-in default flow that exactly
matches today's behaviour, so publishing on day one changes nothing.

---

## Technical notes

- Canvas built with React Flow (`@xyflow/react`), Vuexy-styled custom nodes and
  edges; layout assistance via a dagre auto-arrange action.
- New tables: `agent_flows` (branch-scoped, draft/published versions, JSON graph)
  and `agent_flow_versions` for history. Row-level security scoped to branch with
  owner/admin/manager write, staff read. Explicit grants included.
- A flow interpreter in the shared agent code resolves the published graph into
  the existing agent/tool selection, with a hard fallback to current behaviour if
  no flow is published or the graph fails validation. Tool authorisation stays
  server-side and role-gated — the graph can only narrow, never widen it.
- Chat screen responsiveness handled with existing breakpoints plus the mobile
  hook; no new layout library.
- Coexistence: the WhatsApp webhook gains handling for message-echo events
  (store as outbound, mark `sent_from_phone`, dedupe on provider message id via
  the existing unique index) and a one-time history-sync request right after
  linking. Auto-reply suppression keys off a recent human reply on the thread.
  Send paths, campaign tracking and the communication dispatcher are untouched.

---

## Build order

1. Coexistence support: echo handling, dedupe, history import, status panel, and
   outbound storage verification — then the onboarding run with you.
2. Mobile chat rebuild, verified in a browser at three widths.
3. Flow schema, canvas editor, node settings drawers, validation, publish.
4. Interpreter wiring with the default flow, then live verification on a test
   conversation.
