import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { Logger } from "../../Logger.ts";
import { SupportedGames, UserAPIPublicResponse } from "../../Database.ts";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare readonly id: CreationOptional<number>;
    declare username: string;
    declare githubId: string | null;
    declare discordId: string | null;
    declare sponsorUrl: string | null;
    declare displayName: string;
    declare bio: string;
    declare roles: UserRolesObject;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date>;

    public addSiteWideRole(role: UserRoles) {
        if (!this.roles.sitewide.includes(role)) {
            this.roles = {
                sitewide: [...this.roles.sitewide, role],
                perGame: this.roles.perGame,
            };
            this.save();
        } else {
            Logger.warn(`User ${this.username} already has role ${role}`);
        }
    }

    public addPerGameRole(game: SupportedGames, role: UserRoles) {
        let roleObj = { ...this.roles };
        if (!roleObj.perGame[game]) {
            roleObj.perGame[game] = [];
        }

        if (!roleObj.perGame[game].includes(role)) {
            roleObj.perGame[game] = [...roleObj.perGame[game], role];
            this.roles = roleObj;
            this.save();
        } else {
            Logger.warn(`User ${this.username} already has role ${role} for game ${game}`);
        }
    }

    public removeSiteWideRole(role: UserRoles) {
        if (this.roles.sitewide.includes(role)) {
            this.roles = {
                sitewide: this.roles.sitewide.filter((r) => r != role),
                perGame: this.roles.perGame,
            };
            this.save();
        } else {
            Logger.warn(`User ${this.username} does not have role ${role}`);
        }
    }

    public removePerGameRole(game: SupportedGames, role: UserRoles) {
        let roleObj = { ...this.roles };
        if (roleObj.perGame[game] && roleObj.perGame[game].includes(role)) {
            roleObj.perGame[game] = roleObj.perGame[game].filter((r) => r != role);
            this.roles = roleObj;
            this.save();
        } else {
            Logger.warn(`User ${this.username} does not have role ${role} for game ${game}`);
        }
    }

    public toAPIResponse(): UserAPIPublicResponse {
        return {
            id: this.id.valueOf(), // this is a number, but the type system doesn't like it
            username: this.username,
            githubId: this.githubId,
            sponsorUrl: this.sponsorUrl,
            displayName: this.displayName,
            roles: this.roles,
            bio: this.bio,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}

export interface UserRolesObject {
    sitewide: UserRoles[];
    perGame: {
        [gameName in SupportedGames]?: UserRoles[];
    }
}

export enum UserRoles {
    AllPermissions = `allpermissions`,
    Admin = `admin`,
    Poster = `poster`,
    Approver = `approver`,
    Moderator = `moderator`,
    LargeFiles = `largefiles`,
    Banned = `banned`,
}