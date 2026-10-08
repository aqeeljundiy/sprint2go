# Before launch (audit, 8 Oct 2026)

**Historical.** The blockers below were fixed on 8 and 9 Oct 2026 (write rules, AI caps, production start, files on disk, sign-up and reset by email through our own mail server). What's open now is in BACKLOG.md.

Fixed on 8 Oct: an admin of any company (and anyone can make one) could invite an existing user's id and reset their password. Invites now only go to people who have never signed in, and accepting never overwrites a password.

## Blockers
1. **Write checks (one server pass, with tests).**
   - Sync accepts whole documents. Updates must also check the new version, so nothing moves into another company. The server should set authors (`userId`, `createdBy`, history `by`).
   - Only admins may change a workspace. Roles, plan and AI settings move to admin-only endpoints.
   - Users can change their own name, title, colour and photo only (done 8 Oct). Others can't change their email or `clientOf`. `clientLens` must check the person is on the guest list.
   - Mail accounts: the account map only looks inside your own companies. `/api/workspace` ignores the accounts the client sends.
2. **AI cost cap** for companies using our key: a limit per company and per person, plus rate limits.
3. **Production start:** no demo seeding unless `S2G_DEMO=1`. Never read `.env.example`. Make `HOST` configurable, add `/api/health`, logs and error reporting.
4. **Files:** an upload endpoint with object storage (S3 or R2) and signed links. Today Drive and chat files are `blob:` links that die on reload, and guest uploads are data URLs inside docs.
5. **A way in:** sign-up with an email code, password reset, account deletion, real email (Stalwart + SES), billing.

## Should fix
- **Sessions:**
  - `Secure` cookie;
  - store sessions hashed and expire them;
  - sign out other sessions on password change;
  - limit login attempts;
  - async scrypt;
  - same timing for unknown emails.
- **Requests from other sites:** check `Origin` and require JSON.
- **Live updates:** per-user filtering on deletes; don't trust `x-conn`; drop connections on sign-out; cache lenses.
- **Rejected saves:** show them instead of failing silently. Merge comments instead of overwriting the whole task. Notice an expired session.
- **Security headers:** CSP and `frame-ancestors`; compression; cache headers.
- **AI key `baseUrl`:** block private addresses.
- **Email HTML:** no `style` with `url()`.
- **Backups (Litestream), migrations, tests** for the visibility and write rules.
- **Crash screen:** an error boundary so a crash doesn't blank the app.

## Nice to have
- Split the 975 KB bundle.
- Break up `App.tsx` (3,400 lines).
- Keyboard support for clickable divs.
- Sync settings and Ask AI history across devices.
- An installable app manifest.
