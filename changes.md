# db-overhaul (Backend refactor & addition of tests)
- `"type": "module",`
- Updated packages (including typescript)
- Database classes have been separated into their own files
- Swagger file seperated into 2 files (full and public)
- `/admin/linkversions` has been removed
- `moderator` role has been removed
- Webhook mod logs have been overhauled
  - These are now seprated by type and can be filtered by type
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
    Text_Updated = `updated`,
}
```

- Version detection has been moved to the `Utils` class
- Reworked Approval Endpoints
  - **All approvals now use `ApprovalAction`.**
  - `status` from mods/modVersions and `accepted` from edit reqest bodies has been replaced with `action`.
  - add `includeUnverified` query param to `/approval/:queueType`
```typescript
export enum ApprovalAction {
    Accept = `accept`, // Verify/accept the mod/modVersion/edit, set its status to verified
    Deny = `deny`, // Reject the mod/modVersion, set its status to unverified, but do not remove it
    Remove = `remove`, // sets the status to removed
    Restore = `restore`, // Restore the mod/modVersion if it was previously removed
}
```


- Added `pending` status. `unverified` is now for mods that either will not be verified due to being for an outdated version of the game or do not fully meet the requirements for verification. For the time being, these both can be considered  `unverified`.
- Removed various bits of unused code and files
- removed `PATCH /approval/mod/:modIdParam`
- removed `PATCH /approval/modVersion/:modVersionIdParam`
- removed `POST /approval/modVersion/:modVersionIdParam/revoke`
- added `GET /multi/modversions` to get multiple modVersions at once (for getting data abotu dependencies)
- added `status` to `/hashlookup` endpoint
- renamed `/multihashlookup` to `/multi/hashlookup`
- added `status` to `/multi/hashlookup` endpoint
- Logic for editing/checking permissions for mods & modVersions has been moved to the their classes instead of being done in the api routes 
- `index.ts` no longer uses `import()` to load GitHub PAT support
- `index.ts` can now start and stop the server.
- Server now properly supports using sqlite in memory (for testing)
- added `linkedVersionIds` to gameVersions
  - For all intents and purposes, this is bascialy "aliases". BBM still considers each game version to be a unique version, but this will automatically add all linked versions to a modversion when it is created.
- run role migrator to users table after db sync.
- the charecter `v` is now stripped from the start of version numbers when saving to the database. 
- the error `Dependent cannot depend on a ModVersion that does not support the earliest supported Game Version of the dependent.` has been removed
- disable logging and config loading if `NODE_ENV` is set to `test`.
- allow `all` as a value for `status` in `/mods`
- added tests
