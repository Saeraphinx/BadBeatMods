import { Version } from "../Database.ts";
import { Logger } from "../Logger.ts";
import { DatabaseHelper, Dependency, UserRoles } from "./DBHelper.ts";
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
// #endregion

// #region Games (The Great ChroMapper Migration)
export async function populateGamesAndMigrateCategories() {
    // This function is a placeholder for the future migration of games and categories.
    let projects = await DatabaseHelper.database.Projects.findAll();
    if (!((await DatabaseHelper.database.Games.findAll()).length === 0 && projects.length !== 0)) {
        Logger.debug(`Games table already populated. Skipping migration.`);
        return;
    }
    Logger.warn(`Games table is empty. Migrating games and categories...`);
    await DatabaseHelper.database.Games.bulkCreate([
        {
            name: `BeatSaber`,
            displayName: `Beat Saber`,
            categories: [`Core`, `Essential`, `Library`, `Cosmetic`, `Practice and Training`, `Gameplay`, `Stream Tools`, `UI Enchancements`, `Lighting`, `Tweaks and Tools`, `Multiplayer`, `Text Changes`, `Editor`, `Other`],
            webhookConfig: [],
            default: true,
        },
        {
            name: `Chromapper`,
            displayName: `ChroMapper`,
            categories: [`Core`, `Essential`, `Library`, `Cosmetic`, `Practice and Training`, `Gameplay`, `Stream Tools`, `UI Enchancements`, `Lighting`, `Tweaks and Tools`, `Multiplayer`, `Text Changes`, `Editor`, `Other`],
            webhookConfig: [],
            default: false,
        }
    ]);
    await DatabaseHelper.refreshCache(`games`);
            
    for (let project of projects) {
        let game = await DatabaseHelper.database.Games.findOne({ where: { name: project.gameName } });
        if (!game) {
            game = await DatabaseHelper.database.Games.create({
                name: project.gameName,
                displayName: project.gameName,
                categories: [project.category],
                webhookConfig: [],
                default: false,
            });
            Logger.log(`Game ${project.gameName} created.`);
        }

        if (game.name == `BeatSaber` || game.name == `Chromapper`) {
            await project.update({ category: translateCategory(project.category) });
        }

        if (game.categories.includes(project.category) === false) {
            Logger.log(`Adding category ${project.category} to game ${game.name}.`);
            game.categories.push(project.category);
            await game.save();
        }
    }
}

function translateCategory(category: string): string {
    switch (category) {
        case `core`:
            return `Core`;
        case `essential`:
            return `Essential`;
        case `library`:
            return `Library`;
        case `cosmetic`:
            return `Cosmetic`;
        case `practice`:
            return `Practice and Training`;
        case `gameplay`:
            return `Gameplay`;
        case `streamtools`:
            return `Stream Tools`;
        case `ui`:
            return `UI Enchancements`;
        case `lighting`:
            return `Lighting`;
        case `tweaks`:
            return `Tweaks and Tools`;
        case `multiplayer`:
            return `Multiplayer`;
        case `text`:
            return `Text Changes`;
        case `editor`:
            return `Editor`;
        case `other`:
            return `Other`;
        default:
            Logger.warn(`Unknown category: ${category}. Defaulting to 'Other'.`);
            return `Other`;
    }
}
// #endregion