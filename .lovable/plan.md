# Chat inbox, mobile chat UI, and a real Visual Flow Builder

Three pieces of work plus one answer about WhatsApp coexistence.

---

## 1. Messages we send don't appear in Meta's own inbox

This is a platform behaviour, not a data bug. Messages we send from the CRM are
stored correctly on our side (they are written to the chat thread and to the
communication record). They do not appear in the WhatsApp Business phone app or
in Meta Business Suite because the number is connected through the Cloud API:
Cloud API conversations and app conversations are separate surfaces unless the
number is onboarded in **coexistence** mode.

What will be done here:

- A short "Where your messages live" explainer card on the chat screen and in
  the WhatsApp settings area, stating plainly that the CRM is the system of
  record and Meta's inbox will not mirror CRM sends unless coexistence is
  enabled.
- A verification pass confirming every outbound path (manual reply, automated
  reminder, campaign, AI reply) writes a thread bubble, so nothing is missing on
  our side. Anything found missing gets fixed.

Enabling coexistence itself is a change made with the provider that owns the
number connection, not something that can be switched on from inside the app.
Once it is enabled, the phone app and the CRM share the same conversation and no
code change is needed here.

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
- No change to webhooks, campaign tracking, or the communication dispatcher.

---

## Build order

1. Outbound storage verification + coexistence explainer.
2. Mobile chat rebuild, verified in a browser at three widths.
3. Flow schema, canvas editor, node settings drawers, validation, publish.
4. Interpreter wiring with the default flow, then live verification on a test
   conversation.
