# db-overhaul (Backend refactor & addition of tests)

## Server Changes
- **Preparation for the renaming of Mods & ModVersions to Projects & Versions**
  - This is to hopefully reduce confusion between the two as having "mod" in both names is confusing.
- Reworked Approval Endpoints
  - **All approvals now use `ApprovalAction`.**
  - `status` from mods/modVersions and `accepted` from edit request bodies has been replaced with `action`.
  - `reason` has been added to project & version approval endpoints
  - add `includeUnverified` query parameter to `/approval/:queueType`
  - [additional info can be found on the frontend](https://github.com/Futuremappermydud/bsmods-frontend/blob/285b39375de4a8bcdd4f0627e3ad95f43521b5f4/src/lib/components/ui/approval/ApprovalDialog.svelte#L131-L133)
```typescript
export enum ApprovalAction {
    Accept = `accept`, // Verify/accept the mod/modVersion/edit, set its status to verified
    Deny = `deny`, // Reject the mod/modVersion, set its status to unverified, but do not remove it
    Remove = `remove`, // sets the status to removed
    Restore = `restore`, // Restore the mod/modVersion if it was previously removed
}
```

- Webhook mod logs have been overhauled
  - These are now separated by type and can be filtered by type
  - If a type is not specified in the config for the webhook, logs with that type will not be sent.
  - Webhook logs include the reason for the action
  - Webhook logs now use a color scheme more similar to BSMG's BeatMods

```typescript
  export enum WebhookLogType {
    SetToPending = `setToPending`, // submitted for approval
    Verified = `verified`, // approved
    RejectedUnverified = `unverified`, // rejected, set to unverified
    VerificationRevoked = `verificationRevoked`, // verified mod has status changed
    Removed = `removed`, // rejected, set to removed
    EditSubmitted = `editSubmitted`, // submitted for approval
    EditApproved = `editApproved`, // approved
    EditRejected = `editRejected`, // rejected

    Text_Created = `created`,
    Text_StatusChanged = `statusChanged`,
    Text_EditBypassed = `editBypassed`,
    Text_Updated = `updated`,
}
```

- Added `pending` status. `unverified` is now for mods that either will not be verified due to being for an outdated version of the game or do not fully meet the requirements for verification.
  - [additional info can be found on the frontend](https://github.com/Futuremappermydud/bsmods-frontend/blob/285b39375de4a8bcdd4f0627e3ad95f43521b5f4/src/lib/components/ui/approval/ApprovalDialog.svelte#L131-L133)
- added `linkedVersionIds` to gameVersions
  - For all intents and purposes, this is basically "aliases". BBM still considers each game version to be a unique version, but this will automatically add all linked versions to a modversion when it is created.
- the character `v` is now stripped from the start of version numbers when saving to the database. 
- the error `Dependent cannot depend on a ModVersion that does not support the earliest supported Game Version of the dependent.` has been removed
- add `statusHistory` to mods & modversions. these store time, status, reason, and user id.
- Edits to mod descriptions bypass the edit queue

## API Changes
- Swagger file separated into 2 files (full and public)
- Ratelimit has been lowered to 100 req/min.
- `moderator` role has been removed
- `POST /admin/linkversions` has been removed
- removed `PATCH /approval/mod/:modIdParam`
- removed `PATCH /approval/modVersion/:modVersionIdParam`
- removed `POST /approval/modVersion/:modVersionIdParam/revoke`
- added `GET /multi/modversions` to get multiple modVersions at once (for getting data about dependencies)
- added `status` to `GET /hashlookup` endpoint
- renamed `GET /multihashlookup` to `GET /multi/hashlookup`
- added `status` to `GET /multi/hashlookup` endpoint
- allow `all` as a value for `status` on  `GET /mods`
- Add `GET /inc/mod/:hash` for incrementing download counts & getting the file name for version downloads

## Development
- Move to ECMAScript modules
- Updated packages (mainly typescript)
- Database classes have been separated into their own files
- Version detection has been moved to the `Utils` class
- Removed various bits of unused code and files
- Logic for editing/checking permissions for mods & modVersions has been moved to the their classes instead of being done in the api routes 
- `index.ts` no longer uses `import()` to load GitHub PAT support
- `index.ts` can now start and stop the server.
- added tests
- Server now properly supports using sqlite in memory (for testing)
- run role migrator on users table after db sync.
- disable logging and config loading if `NODE_ENV` is set to `test`.
- Use `Map.get` for id lookups instead of `Array.find`