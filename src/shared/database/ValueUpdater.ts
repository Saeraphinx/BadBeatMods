import { Logger } from "../Logger.ts";
import { UserRoles } from "./DBHelper.ts";
import { User } from "./models/User.ts";

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