![BadBSMods](https://github.com/Saeraphinx/badbsmods/blob/main/assets/banner.png)
# BadBeatMods
A multi-game mod repository designed 

BadBeatMods was developed as a replacement for [Beat Saber Modding Group's BeatMods](https://github.com/bsmg/BeatMods-Website). It is written in TypeScript, and primarially uses Express & Sequelize. You can find all of the models for the database in [`src/shared/Database.ts`](https://github.com/Saeraphinx/badbsmods/blob/main/src/shared/Database.ts). The server is written with the intent of using SQLite as its main database, but it should support PostgreSQL.

If anyone has any questions, comments, or feature requests, please let me (Saera) know as soon as possible.

## Todo List
All feature requests and bugs are tracked in the [issues](https://github.com/Saeraphinx/BadBeatMods).

## Main Differences & Things to Note
I might be missing a few things, but I'm pretty sure this list has all of the major points.
- 1 version can support multiple game versions.
- Mods have an icon.
  - Supports `png`, `jpeg`, and `webp`. Icon is not to exceed `8 MB`.
- Project metadata is updatable without a reupload.
- Game Versions do not have aliases, meaning that marking a mod as supporting 1.29.1 will not also mark it as supporting 1.29.0. This *may* change in the future.
- Accounts are made using GitHub OAuth2. You are able to link your Discord account for contact only.
- Users can have profiles (see `User` in the Database).
- There is no more `required` field for versions. Categories are used instead. It is encouraged that mod managers use the following categories to select mods by default:
  - `core` - Mods that are required.
  - `essential` - Mods that are likely to be installed by everyone upon a first install.
- In order to reduce calls to the database, the server caches all DB tables. It refreshes this cache every 5 minutes, and when an edit is made.

## Project & Version Rules
BBM has a few rules that mods must follow. These rules are enforced by the server, and are as follows:
### Projects (Mods)
- `name` must be unique.
- `summary` must not exceed 160 characters.
- `description` must not exceed 4096 characters. This property should support markdown. 
- Projects must have at least 1 author.
- Projects must have a icon. If an icon is not provided, the server will default to `default.png`.
- Editable properties are `name`, `summary`, `description`, `category`, `gitUrl`, `gameName` (subject to change), and `authorIds`.

### Versions (ModVersions)
- `modVersion` must be unique. 
  - It can share this property with other versions provided the `platform` property is different.
- `modVersion` must be a valid [SemVer](https://semver.org/) string.
  - This does not mean you have to follow SemVer, but it must be a valid SemVer string. This is determined by [SemVer](https://www.npmjs.com/package/semver)'s `valid` function.
- `dependencies` must be an array of `ModVersion` IDs.
  - These IDs must be valid. The server will not check that the ID (or sucessors) are available for game version on save, meaning that it is possible to have dependancies that are not available for any supported game version of the version. See [/mods](#mods) for more information.
- All supported game versions within must be have the same game name as the parent project.
- Editable properties are `modVersion`, `dependencies`, `gameVersions`, `platform`.

## API
API Documentation is available at `/api/docs` by default. Some endpoints have specific rules that must be followed. If any of these rules are broken, that is a bug, and should be reported as such. 

### `/mods`
This is the main endpoint that mod managers such as BSManager should use. When the `gameVersion` query is specified, the server will return the latest version (determined by SemVer's `compare` function) that supports that game version. Versions that are unable to find one of their dependencies will not be returned using the following check. 
```javascript
for (let dependency of mod.latest.dependencies) {
    if (!mods.find((mod) => mod?.latest?.id === dependency)) {
        return false;
    }
}
```
Because this check is done, it is garunteed that all dependancies are listed elsewhere in the response. This is done to reduce the number of calls to the server. You will be able to find them by doing the following:
```javascript
let currentMod; // The mod you are looking for
let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
```


### `/mod/:id`
This endpoint is used to get a specific mod. The server will return the latest version of the mod, and all of its dependancies. If you do not care about the validity of the dependencies, or are troubleshooting a mod that isn't showing up, you can use the `raw` query parameter to disable dependency resoultion. The versions are sorted by using SemVer's `coerce` function on their `version` property. This sort looks like this:
```javascript
returnVal.sort((a, b) => {
    if (a?.modVersion && b?.modVersion) {
        return new SemVer(b?.modVersion).compare(a?.modVersion);
    } else {
        return 0;
    }
});
```
Note that that this comparison *will* ignore build metadata.

### `/versions`
This endpoint is used to get all game versions available on the server. The game versions are sorted by using SemVer's `coerce` function on their `version` property. This sort looks like this:
```javascript
versions.sort((a, b) => {
    let verA = coerce(a.version, { loose: true });
    let verB = coerce(b.version, { loose: true });
    if (verA && verB) {
        return verB.compare(verA); // this is reversed so that the latest version is first in the array
    } else {
        return b.version.localeCompare(a.version);
    }
});
```




<!--## Rules/Goals of a ModVersion
A ModVersion can (atm) share a version with other versions provided the version string & platform string (steampc/oculuspc/universalpc) is unique.  
An example of allowed overlaps would be:
- Heck v1.0.0 (verified)
- Heck v1.0.0 (denied)
- Heck v1.0.0+1.39.0 (unverified)
- Heck v1.0.0+1.40.0 (verified)
 
An example of a prohibited overlap would be:
- Heck v1.0.0 (verified)
- Heck v1.0.0 (verified)

also prohibited is:
- Heck v1.0.0 (verified)
- Heck v1.0.0 (unverified)

A ModVersion can support multiple versions:
- BSIPA v4.3.5 supports versions 1.37.1 through 1.39.1
- NotOutYet v1.0.0 supports versions 0.11.2 through 1.40.0

Dependancies should be marked for the oldest supported GameVersion that the mod is marked as supporting. ModVersions that have a dependancy on another ModVersion that has not been marked as compatible with the requested versions will attempt to resolve a newer dependancy. It will not mark a version as a valid dependancy sucessor if any of the following is true:
- The original dependancy version supports the requested GameVersion
- The newer dependancy does not support the requested GameVersion
- The newer dependancy does not satisfy the check [``return satisfies(newVersion.modVersion, `^${originalVersion.modVersion.raw}\`);``](https://github.com/Saeraphinx/badbsmods/blob/63620b2f33d141175088e81c481eb988eb95b82e/src/shared/Database.ts#L557)` (e.g. ^{original version semver}).

## Rules/Goals of a Mod
A Mod stores all of the metadata for a mod (think name, description, authors, git url, etc).

Mods are required to have unique names. That's it. The name is matched using Sequalize's `Op.eq` (exact).

<!--## How are mods done differently?
> [!NOTE]
> This section is not complete, and might be inaccurate due to the project still being in active development.

In BadBeatMods, mods are stored in two parts:
1. `Mod`, responsible for mod metadata (such as name, description, gitUrl, category, etc), and
2. `ModVersion`, responsible for the zip file itself (such as hashes, dependancies, version, supportedGameVersion, platform, etc)
  
The process of uploading a new mod would look something like this:
1. Create a `Mod`, and fill in information
2. Using the `Mod`'s id that you just created, you'll make a new `ModVersion`, and supply it with the list of dependancies (which is an array of `ModVersion` IDs, the Mod Version (in SemVer), and the supported game versions), along with everything else it requires--->
