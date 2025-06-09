# Project/Version rename, Multi game support, and dependency overhaul (e.g. The Great ChroMapper Migration) - 06/2025
> [!CAUTION]
> This is a major update that includes breaking changes to the API and database. Please read through the changes.

## Server Changes
### Renamed Mods & ModVersions to Projects & Versions
This is to hopefully reduce confusion between the two as having "mod" in both names is confusing.
- All mentions of "mod" and "modVersion" in the API and database have been changed to "project" and "version" respectively.
- All mentions of "mod" and "modVersion" in the codebase have been changed to "project" and "version" respectively, aside from in a few places.
- DB table names have not been changed to due to how the edit approval queue is structured.
- The `modId` property on a version has been changed to `projectId`.

### Dependency Overhaul
Dependencies are no longer tied to a version of a project, they are now tied to the project itself. The object looks like this now:
```json
"dependencies": [
  {
    "parentId": 1, // The ID of the project that this dependency is for
    "sv": "^1.0.0", // The semver version range of the dependency 
  }
]
```
All mods returned by the `/mods` endpoint will still have their dependencies validated, so you can assume that all dependencies are present in the response.

### Multi Game Support
Games are no longer hardcoded, and can be added through the API. The following restrictions have been added:
- A project's `gameName` must match a game's `name`.
- A project category must be a category within the game specified by the project's `gameName`.
- A game version's `gameName` must match a game's `name`.
- A user's `perGame` permissions must match a game's `name`.

In addition, the following changes have been made:
- Webhook configuration is now per-game.
- Categories are now per-game.
- Categories must be between 1 and 64 characters long.

### Other Changes
- If there is already a pending edit for a object, the edit will be updated instead of overwriting the original.
- BeatMods importer has been removed.
  - The `enableBeatModsDownloads` flag has been removed
- BA route linkversionexclude now also takes statuses into account when checking for duplicate entries in the array. 
- Messages refrencing invalid parameters from the server should now be more descriptive.
- Reversed the order of game version strings that are compared by `localCompare` to match the semver comparison.
- `getLatestVersion()` has had all of its paramters marked as optional.
- Edits now check for certain properties before allowing the edit to be submitted.
- Edit types for both Projects & Versions are now using `Pick<>` instead of `Omit<>`.
- The `toApiResponse()` for versions no longer takes any parameters, as it does not resolve dependencies anymore.

## API Changes
- All mentions of "mod" and "modVersion" in the API have been changed to "project" and "version" respectively.
- Many endpoints have been refactored to not wrap responses in an object.
- Documentation has been updated to reflect changes & also has been checked to make sure all non-deprecated endpoints are documented.
### Endpoint Changes
- Updated documentation for every endpoint to reflect changes.
- All instances of `modId` in request bodies have been changed to `projectId`.
- All instances of a `VersionAPIPublicResponse` now have the new structure for `dependencies`.
- Changed almost all instances of `mods` & `modVersions` to `projects` & `versions`
- Changed all instances of `mod` & `modVersion` to `project` & `version`

- Renamed `POST /mods/create` to `POST /projects/create`. Both endpoints will still work for the time being.
- Renamed `POST /mods/:modIdParam/upload` to `POST /projects/:projectIdParam/create`. Both endpoints will still work for the time being. Additionally, both `upload` and `create` will work for the time being.
- Renamed `GET /mods/:modIdParam` to `GET /projects/:projectIdParam`. Both endpoints will still work for the time being.
- Renamed `GET /modversions/:modVersionIdParam` to `GET /versions/:versionIdParam`. Both endpoints will still work for the time being.
- Renamed `GET /mods/:modIdParam/versions` to `GET /projects/:projectIdParam/versions`. Both endpoints will still work for the time being.

- Renamed `GET /multi/modversions` to `GET /multi/versions`.
- Renamed `POST /approval/mod/:modIdParam/approve` to `POST /approval/project/:projectIdParam/approve`.
- Renamed `POST /approval/modVersion/:modVersionIdParam/approve` to `POST /approval/version/:versionIdParam/approve`.
- Renamed the `modVersionIdsToExclude` body parameter to `versionIdsToExclude` `POST /ba/linkVersionsExclude`.
- Fixed the `error` field in `GET /auth/github/callback` to be `message`.
- `GET /ba/linkVersionsExclude` now considers the `status` of the versions when checking for duplicates.
- Updated the `message` field for the `PATCH /approval/edit/:editIdParam` endpoint to be more descriptive.
- Updated the `message` field in the `POST /projects/create` endpoint to be more descriptive.
- Updated the `message` field in the `POST /projects/:projectIdParam/create` endpoint to be more descriptive.
- Updated the `message` field in the `GET /mods` endpoint to be more descriptive.
- Updated the `message` field in the `GET /motd` endpoint to be more descriptive.
- Updated the `message` field in the `POST /motd` endpoint to be more descriptive.

- `GET /mods` now returns the additional properties:
  - `total`: The total number of projects found.
  - `invalidCount`: The number of projects that are invalid (e.g. missing dependencies).
  - `invalidIds`: An array of IDs of the invalid projects.

- `GET /mods/:modIdParam` not longer wraps the response in an object.
- `GET /multi/versions` no longer wraps the response in an object.
- `GET /hashlookup` no longer wraps the response in an object.
- `GET /multi/hashlookup` no longer wraps the response in an object.
- `GET /user/:id/mods` no longer wraps the response in an object.
- `GET /users` no longer wraps the response in an object.

- Removed the `platform` query parameter from the `GET /user/:id/mods` endpoint.

- Reworked `GET /games` to get all games, versions and categories.
- Added `POST /games` to add a new game.
- Added `GET /games/:gameName` to get a specific game.
- Added `POST /games/:gameName/versions` to add a new game version.
- Added `POST /games/:gameName/categories` to add a new category to a game.
- Deprecated `GET /versions`
- Deprecated `POST /versions`
- Deprecated `GET /versions/default`
- Deprecated `POST /versions/default`


# db-overhaul (Backend refactor & addition of tests) - 04/2025

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
    - Default is to send all logs.
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
    // All = `all`, // All logs
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
- Added `gamemanager` role
  - This role is able to use add game versions and set the default game version.
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
- Fixed role endpoints not checking for per-game permissions.


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
- Auth ID has been moved to a different object within the request object to allow for sessions to be managed more easily
- Fixed mispelling of "response" in various places