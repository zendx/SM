# Teacher and parent account assignments

In **Administration → Users → Create account**, choose **Teacher** or **Parent** to reveal the optional assignment section.

- Teachers: select any number of classes. Class names include the academic year.
- Parents: select any number of children. Search by name, student number or class.
- Leave every checkbox empty to create the account without assignments.
- Selected items remain selected when searching. Remove an item using its checkbox or chip, or use **Clear selection**.

After creation, use **Assign classes** or **Link children** beside the account to add or remove links. Existing selections are preselected. Saving an empty selection removes that account's links without deleting classes or students.

Records assigned to someone else are labelled and unavailable in this form. Change an existing link through its class or student record before transferring it. Stale forms and concurrent creation requests cannot silently overwrite another teacher's or parent's links.

Account creation, links and audit entries are saved in one transaction. Invalid selections roll back the account creation. Existing activation emails and automatic teacher attendance profiles are preserved. The linked classes and children feed the existing access rules and messaging contacts immediately.

No database migration is required. Integration tests are in `tests/account-assignments.test.js`; run them using the existing embedded test command.
