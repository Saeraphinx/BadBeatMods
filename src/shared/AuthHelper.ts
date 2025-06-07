import { Config } from "./Config.ts";
import { DatabaseHelper, SupportedGames, User, UserRoles } from "./Database.ts";
import { Request, Response } from "express";

// eslint-disable-next-line quotes
declare module 'express-session' {
    export interface Session {
        userId: number;
    }
}

// eslint-disable-next-line quotes
declare module 'express-serve-static-core' {
    interface Request {
      bbmAuth?: {
            userId: number;
            isApiAuth: boolean;
        }
    }
}

/**
 * @param {(UserRoles|boolean)} [role=UserRoles.Admin] if false, no role is required, you just have to be signed in. If True, the user must not be banned. If a UserRoles, the user must have that role.
 * @param {(SupportedGames|null|true)} [gameName=null] if null or false, the user must have the role sitewide. If true, the user must have the role in any game. If a SupportedGames, the user must have the role in that game.
 */
// setting the type in this way is stupid but it works for callbacks
export async function validateSession(req: Request, res: Response, role: UserRoles|boolean = UserRoles.Admin, gameName:SupportedGames|null|boolean = null, handleRequest:boolean = true): Promise<{ user: User } | { user: null }> {
    
    let sessionId = req?.bbmAuth?.userId as number | undefined;
    // check for devmode options
    if (Config.devmode && Config.authBypass) {
        let user = await DatabaseHelper.database.Users.findOne({ where: { id: 1 } });
        if (!user) {
            if (handleRequest) {
                res.status(403).send({ message: `Forbidden.` });
            }
            return { user: null };
        }
        return { user: user };
    }

    // check if signed in
    if (!sessionId) {
        if (handleRequest) {
            res.status(401).send({ message: `Unauthorized.` });
        }
        return { user: null };
    }
    
    // check if valid user
    let user = await DatabaseHelper.database.Users.findOne({ where: { id: sessionId } });
    if (!user) {
        if (handleRequest) {
            res.status(401).send({ message: `Unauthorized.` });
        }
        return { user: null };
    }

    // check if user is banned only
    if (typeof role === `boolean` && role == true) {
        if (user.roles.sitewide.includes(UserRoles.Banned) || (DatabaseHelper.isSupportedGame(gameName) && user.roles.perGame[gameName]?.includes(UserRoles.Banned))) {
            if (handleRequest) {
                res.status(403).send({ message: `Forbidden.` });
            }
            return { user: null };
        } else {
            return { user: user };
        }
    } else if (typeof role === `boolean` && role == false) {
        return { user: user };
    }

    // check if user has role (yes, sitewide overrides perGame roles. hence the name, "sitewide")
    if (user.roles.sitewide.includes(role) || (DatabaseHelper.isSupportedGame(gameName) && user.roles.perGame[gameName]?.includes(role))) {
        return { user: user };
    } else {
        if (user.roles.sitewide.includes(UserRoles.AllPermissions) || (DatabaseHelper.isSupportedGame(gameName) && user.roles.perGame[gameName]?.includes(UserRoles.AllPermissions))) {
            return { user: user };
        } else {
            // process the "role in any game" check
            if (typeof gameName === `boolean` && gameName == true) {
                gameName = null;
                //check for the user role in any game
                for (const game in user.roles.perGame) {
                    if (!DatabaseHelper.isSupportedGame(game) || !user.roles.perGame[game]) {
                        continue; // skip invalid games
                    }

                    if (user.roles.perGame[game].includes(role)) {
                        return { user: user };
                    }
                }

            }

            // if after all that we still don't have a valid user, return null
            if (handleRequest) {
                res.status(403).send({ message: `Forbidden.` });
            }
            return { user: null };
        }
    }
}

export function validateAdditionalGamePermissions(session: {user: User}, gameName: SupportedGames, role:UserRoles = UserRoles.Admin): boolean {
    if (!session.user) {
        return false;
    }
    if (session.user.roles.sitewide.includes(UserRoles.AllPermissions) || session.user.roles.sitewide.includes(role)) {
        return true;
    }
    if (session.user.roles.perGame[gameName]?.includes(UserRoles.AllPermissions) || session.user.roles.perGame[gameName]?.includes(role)) {
        return true;
    }
    return false;
}