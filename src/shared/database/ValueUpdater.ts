import { Version } from "../Database.ts";
import { Logger } from "../Logger.ts";
import { Dependency, UserRoles } from "./DBHelper.ts";
import { User } from "./models/User.ts";

// #region UserRoles
export async function updateRoles(user: User) {
    let shouldSync = false;
    let userRoles = user.roles;
    let newSiteWideRoles: UserRoles[] = [...userRoles.sitewide];
    let newPerGameRoles: { [game: string]: UserRoles[] } = { ...userRoles.perGame };
    if (!user.roles.sitewide.every((role) => Object.values(UserRoles).includes(role))) {
        Logger.warn(`User ${user.username} has invalid sitewide roles. Correcting...`);
        for (let role of user.roles.sitewide) {
            if (!Object.values(UserRoles).includes(role)) {
                shouldSync = true;
                newSiteWideRoles.splice(newSiteWideRoles.indexOf(role), 1);
                newSiteWideRoles = [...newSiteWideRoles, ...translateUserRole(role)];
            }
        }

    }

    for (let game in user.roles.perGame) {
        // @ts-expect-error ts(7053)
        let gameRoles = user.roles.perGame[game] as UserRoles[] | null;
        if (!gameRoles) {
            continue;
        }
        if (!gameRoles.every((role) => Object.values(UserRoles).includes(role))) {
            Logger.warn(`User ${user.username} has invalid roles for game ${game}. Correcting...`);
            let newRoles: UserRoles[] = [...gameRoles];
            for (let role of gameRoles) {
                if (!Object.values(UserRoles).includes(role)) {
                    shouldSync = true;
                    newRoles.splice(newRoles.indexOf(role), 1);
                    newRoles = [...newRoles, ...translateUserRole(role)];
                }
            }
            newPerGameRoles[game] = newRoles;
        }
    }

    user.roles = { sitewide: newSiteWideRoles, perGame: newPerGameRoles };
    if (shouldSync) {
        await user.save();
    }
    return user;
}

function translateUserRole(oldRoleName: string): UserRoles[] {
    switch (oldRoleName) {
        case `admin`:
            return [UserRoles.Admin];
        case `moderator`:
            return [];
        case `poster`:
            return [UserRoles.Poster];
        case `approver`:
            return [UserRoles.Approver];
        case `allpermissions`:
            return [UserRoles.AllPermissions];
        case `banned`:
            return [UserRoles.Banned];
        case `largefiles`:
            return [UserRoles.LargeFiles];
        case `gamemanager`:
            return [UserRoles.GameManager];
        default:
            return [];
    }
    return [];
}
// #endregion

// #region Dependencies V2
/*
Yes. I'm aware this isn't the best solution, but I can't think of a better one and I think I can live with this for the time being.
Maybe a different solution will come to mind later, but for now, this should work w/o issue.
*/
export async function updateDependencies(version: Version, mvdb: Version[]) {
    if (version.dependencies && version.dependencies.length > 0 && version.dependencies.every((dep) => typeof dep == `number`)) {
        let newDepVer:Dependency[] = [];
        for (let dep of version.dependencies) {
            let mv = mvdb.find(d => d.id == dep);
            if (mv) {
                newDepVer.push({parentId: mv.projectId, sv: `^${mv.modVersion}`});
            } else {
                Logger.error(`Version ${version.id} has a dependency on a version that doesn't exist. Removing...`);
            }
        }
        version.dependencies = newDepVer;
        await version.save();
    }
}