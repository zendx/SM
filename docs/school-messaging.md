# Parent and school conversations

School administrators have one **Message parents** navigation item. Parents use **Message school**. The separate **Messages** menu has been removed; old `#conversations/:id` links redirect to `#messages/:id`. Teachers, other staff roles and platform operators cannot access this messenger.

Choose **New conversation**, then an active parent or school administrator in the same school. Contacts are searchable and show online status. A child does not have to be enrolled before a parent can contact the school. All endpoints recheck active school membership, participants and platform access. Conversations are private to their participants and excluded from other administrators' general delivery logs.

The **Send school update** tab retains the parent, class and all-parent recipient picker and review screen. Each update also arrives in a private conversation with its sender, so parents can reply. Other recipients and their responses remain private. Updates longer than the chat message limit are stored as consecutive messages without truncation.

Messages are stored in the database before success is reported. They remain available when a recipient signs back in. Each send carries a client UUID so retrying a lost response does not create duplicate messages or notifications. Failed sends retain the draft while that conversation stays open. Older messages can be loaded from the conversation history.

Visible conversations refresh every second; contacts, the header bell and inbox refresh every five seconds. Hidden tabs stop these timers' requests and refresh on return or reconnect. Online status uses authenticated session heartbeats and expires after 45 seconds without a recent heartbeat. This uses ordinary authenticated requests and works with the existing stateless hosting setup; it is not a WebSocket service or a device push-notification service. Reading a conversation acknowledges its incoming messages and associated bell notifications. Marking a notification as read alone does not claim the chat message was read.

Notification topics open an HTML reader. HTML is sanitised with an allowlist, and plain text keeps its line breaks. List previews contain at most 250 characters, including any ellipsis. Related activities only link within the current application. Communication preferences appear below the inbox.

The bell combines the recipient's school notifications and SMPIS notices. School complaint submissions notify active tenant administrators, principals and proprietors, plus the assigned handler. The parent receives an acknowledgement and notifications for each school workflow update. Parent feedback notifies school leadership and the assignee. Notification links open the conversation or the complaints tab. The school email queue continues to process school notices using its existing worker and email configuration.

## Database rollout

Before deploying this version, apply the protected schema with the existing maintenance command:

```powershell
npm run supabase:setup
```

`server/messaging-schema.sql` adds conversations, messages, recipient read timestamps, school-notification links and lookup indexes. Direct conversations use a nullable student ID and a unique index on the school, parent and administrator. Existing rows are retained. The schema is included in the normal initializer with Supabase RLS and browser-role protection. Deployment preflight and `supabase:check` reject databases missing the direct-conversation migration.

## Verification

```powershell
node scripts/test-embedded.mjs --test --test-concurrency=2 tests/messaging.test.js tests/messaging-schema.test.js tests/platform-notifications.test.js tests/notification-content.test.js tests/school-staff.test.js tests/workspace-navigation.test.js
npm run build
```

Integration coverage includes role, tenant and participant isolation, private delivery-log filtering, CSRF, offline persistence, retry deduplication, read receipts, online presence expiry, membership revocation, replyable announcements and notification ownership. HTML safety, preview length, menu grouping and shared staff registration have dedicated tests. Browser verification used separate administrator and parent sessions in Chrome, including mobile messaging, the notification reader, navigation expansion and the shared account form.
