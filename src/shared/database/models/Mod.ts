import { InferAttributes, Model, InferCreationAttributes, CreationOptional, Op } from "sequelize";
import { Logger } from "../../Logger.ts";
import { SupportedGames } from "../../Database.ts";
import { sendModLog } from "../../ModWebhooks.ts";
import { Categories, Platform, DatabaseHelper, Status, ModAPIPublicResponse } from "../DBHelper.ts";
import { ModVersion } from "./ModVersion.ts";
import { User, UserRoles } from "./User.ts";

export type ModInfer = InferAttributes<Mod>;
export type ModApproval = InferAttributes<Mod, { omit: `id` | `createdAt` | `updatedAt` | `deletedAt` | `iconFileName` | `status` | `lastApprovedById` | `lastUpdatedById` }>
export class Mod extends Model<InferAttributes<Mod>, InferCreationAttributes<Mod>> {
    declare readonly id: CreationOptional<number>;
    declare name: string;
    declare summary: string;
    declare description: string;
    declare gameName: SupportedGames;
    declare category: Categories;
    declare authorIds: number[];
    declare status: Status;
    declare iconFileName: string;
    declare gitUrl: string;
    declare lastApprovedById: CreationOptional<number> | null;
    declare lastUpdatedById: number;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date>;

    public isAllowedToView(user: User|null) {
        if (this.status == Status.Verified || this.status == Status.Unverified) {
            return true;
        }
        // Private & Removed are the only mods that are not viewable by the public
        if (!user || !user.roles || !user.roles.sitewide) {
            return false;
        }
        
        if (
            user.roles.sitewide.includes(UserRoles.Admin) ||
            user.roles.sitewide.includes(UserRoles.Moderator) ||
            user.roles.sitewide.includes(UserRoles.AllPermissions) ||
            user.roles.sitewide.includes(UserRoles.Approver) ||
            this.authorIds.includes(user.id)
        ) {
            return true;
        } else {
            if (!user.roles.perGame[this.gameName]) {
                return false;
            } else {
                let roles = user.roles.perGame[this.gameName];
                if (!roles) {
                    return false;
                }
                if (roles.includes(UserRoles.Admin) ||
                    roles.includes(UserRoles.Moderator) ||
                    roles.includes(UserRoles.Approver) ||
                    roles.includes(UserRoles.AllPermissions)) {
                    return true;
                }
            }
        }
    }


    public async getLatestVersion(gameVersionId: number, platform: Platform, statusesToSearchFor: Status[]): Promise<ModVersion | null> {
        let versions = DatabaseHelper.cache.modVersions.filter((version) => {
            // if the version is not for the correct platform
            if (version.modId !== this.id) {
                return false;
            }

            if (!statusesToSearchFor.includes(version.status)) {
                return false;
            }

            // if the version is not for the correct game
            if (!version.supportedGameVersionIds.includes(gameVersionId)) {
                return false;
            }

            if (version.platform === Platform.UniversalQuest) {
                return platform === Platform.UniversalQuest;
            } else {
                if (version.platform === Platform.UniversalPC || version.platform === platform) {
                    return true;
                }
            }
        });

        let latest = null;
        for (let version of versions) {
            if (!latest || version.modVersion.compare(latest.modVersion) > 0) {
                latest = version;
            }
        }

        return latest;
    }

    public async createEdit(object: ModApproval, submitter: User) {
        if (this.status !== Status.Verified) {
            // do not create an edit if the mod is not verified
            return this;
        }

        // check if there is already a pending edit
        let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: this.id, objectTableName: `mods`, approved: { [Op.eq]: null } } });
        if (existingEdit) {
            // if an edit already exists, update it
            existingEdit.object = object;
            existingEdit.submitterId = submitter.id;
            return await existingEdit.save();
        }

        // create a new edit
        let edit = await DatabaseHelper.database.EditApprovalQueue.create({
            objectId: this.id,
            objectTableName: `mods`,
            object: object,
            submitterId: submitter.id,
        });
        return edit;
    }

    public async setStatus(status:Status, user: User) {
        this.status = status;
        try {
            await this.save();
        } catch (error) {
            Logger.error(`Error setting status: ${error}`);
            throw error;
        }
        Logger.log(`Mod ${this.id} set to status ${status} by ${user.username}`);
        switch (status) {
            case Status.Unverified:
                sendModLog(this, user, `New`);
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                sendModLog(this, user, `Approved`);
                break;
            case Status.Removed:
                sendModLog(this, user, `Rejected`);
                break;
        }
        return this;
    }

    public static async checkForExistingMod(name: string) {
        let mod = await DatabaseHelper.database.Mods.findOne({ where: { name: name } });
        return mod;
    }

    public static async countExistingMods(name: string) {
        let count = await DatabaseHelper.database.Mods.count({ where: { name: name } });
        return count;
    }

    public toAPIResponse(): ModAPIPublicResponse {
        return {
            id: this.id,
            name: this.name,
            summary: this.summary,
            description: this.description,
            gameName: this.gameName,
            category: this.category,
            authors: DatabaseHelper.cache.users.filter((user) => this.authorIds.includes(user.id)).map((user) => user.toAPIResponse()),
            status: this.status,
            iconFileName: this.iconFileName,
            gitUrl: this.gitUrl,
            lastApprovedById: this.lastApprovedById,
            lastUpdatedById: this.lastUpdatedById,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}