# Parent and school conversations

Parents, teachers, principals, proprietors and tenant administrators have a **Messages** navigation item. The existing **Message parents** tool remains available to administrators for announcements.

Choose **New conversation**, then a child and recipient. Parents can contact that child's class teacher, subject teachers, principal, proprietor or school administrator. Staff can start conversations with the corresponding parents. Contacts require an active account and a currently enrolled child linked to the parent. All endpoints recheck the school, participants, child link and current teaching assignment. A conversation's body is also excluded from the general school delivery log for administrators who are not its recipient.

Messages are stored in the database before success is reported. They remain available when a recipient signs back in. Each send carries a client UUID so retrying a lost response does not create duplicate messages or notifications. Failed sends retain the draft while that conversation stays open. Older messages can be loaded from the conversation history.

Visible conversations refresh every three seconds; the header bell and inbox refresh every five seconds. Hidden tabs stop these timers' requests and refresh on return or reconnect. Online status uses authenticated session heartbeats and expires after 45 seconds without a recent heartbeat. This uses ordinary authenticated requests and works with the existing stateless hosting setup; it is not a WebSocket service or a device push-notification service. Reading a conversation acknowledges its incoming messages and associated bell notifications. Marking a notification as read alone does not claim the chat message was read.

The bell combines the recipient's school notifications and SMPIS notices. School complaint submissions notify active tenant administrators, principals and proprietors, plus the assigned handler. The parent receives an acknowledgement and notifications for each school workflow update. Parent feedback notifies school leadership and the assignee. Notification links open the conversation or the complaints tab. The school email queue continues to process school notices using its existing worker and email configuration.

## Database rollout

Before deploying this version, apply the protected schema with the existing maintenance command:

```powershell
npm run supabase:setup
```

`server/messaging-schema.sql` adds conversations, messages, recipient read timestamps, school-notification links and lookup indexes. It is included in the normal schema initializer, including Supabase RLS and browser-role access protection. Existing rows are retained. The application seeds the updated proprietor complaint permission when it starts. The read-only deployment preflight checks the new tables along with the existing protected schema.

## Verification

```powershell
node scripts/test-embedded.mjs --test --test-concurrency=2 tests/messaging.test.js tests/platform-notifications.test.js tests/operations.test.js
npm run build
```

Integration coverage includes contacts and assignment scoping, tenant and participant isolation, private delivery-log filtering, CSRF, offline persistence, retry deduplication, read receipts, online presence expiry, relationship revocation, notification ownership and complaints in both directions. Browser verification used separate parent, teacher and tenant sessions in WebKit, including the real parent and teacher mobile application routes.
