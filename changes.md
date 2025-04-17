# db-overhaul (Backend refactor & addition of tests)

## Server Changes
- **Preparation for the renaming of Mods & ModVersions to Projects & Versions**
  - This is to hopefully reduce confusion between the two as having "mod" in both names is confusing.
- Reworked Approval Endpoints
  - **All approvals now use `ApprovalAction`.**
  - `status` from mods/modVersions and `accepted` from edit request bodies has been replaced with `action`.
  - `reason` field has been added to project & version approval endpoints.
  - add `includeUnverified` query parameter to `/approval/:queueType`.
  - [Additional info can be found on the frontend within the approval dialog.](https://github.com/Futuremappermydud/bsmods-frontend/blob/285b39375de4a8bcdd4f0627e3ad95f43521b5f4/src/lib/components/ui/approval/ApprovalDialog.svelte#L131-L133)
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

- Added `pending` status & redefined `unverified`.
  - `pending` is to be used for mods that are currently in the queue.
  - `unverified` is to be used for:
    - Mods that have newer versions in the queue
    - Mods that are uploaded for versions no longer supported by approvers 
    - Mods that do not fully comply with the approval guidelines 
    - Mods that are not compatible with all other verified mods.
  - Mods with the `unverified` should not receive support, but should be preserved for those who might need to run a older version of a mod or game.
  - [additional info can be found on the frontend](https://github.com/Futuremappermydud/bsmods-frontend/blob/285b39375de4a8bcdd4f0627e3ad95f43521b5f4/src/lib/components/ui/approval/ApprovalDialog.svelte#L131-L133)
- Added `linkedVersionIds` to gameVersions
  - For all intents and purposes, this is basically "aliases". BBM still considers each game version to be unique, but this will automatically add all linked game versions to a Version when it is created or edited.
- The character `v` is now stripped from the start of version numbers when saving to the database. 
- The error `Dependent cannot depend on a ModVersion that does not support the earliest supported Game Version of the dependent.` has been removed
- Added `statusHistory` to projects & versions. These store time, status, reason, and user id.
- Edits to mod descriptions bypass the edit queue

## API Changes
- Swagger file separated into 2 files (full and public)
- Ratelimit has been lowered to 100 req/min.
- Removed `moderator` role
- Removed `POST /admin/linkversions`
- Removed `PATCH /approval/mod/:modIdParam`
- Removed `PATCH /approval/modVersion/:modVersionIdParam`
- Removed `POST /approval/modVersion/:modVersionIdParam/revoke`
- Renamed `GET /multihashlookup` to `GET /multi/hashlookup`
- Added `GET /multi/modversions` to get multiple modVersions at once (for getting data about dependencies)
- Added `GET /inc/mod/:hash` for incrementing download counts & getting the file name for version downloads
- Added `status` to `GET /hashlookup` endpoint
- Added `status` to `GET /multi/hashlookup` endpoint
- Allow `all` as a value for `status` on  `GET /mods`


## Development
- Move to ECMAScript modules
- Updated packages (mainly typescript)
- Database classes have been separated into their own files
- Version detection has been moved to the `Utils` class
- Removed various bits of unused code and files
- Logic for editing/checking permissions for mods & modVersions has been moved to the their classes instead of being done in the api routes 
- `index.ts` no longer uses `import()` to load GitHub PAT support
- `index.ts` can now start and stop the server.
- Added tests
- Server now properly supports using sqlite in memory (for testing)
- Run role migrator on users table after db sync.
- Disable logging and config loading if `NODE_ENV` is set to `test`.
- Use `Map.get` for id lookups instead of `Array.find`