import { InferAttributes, Model, InferCreationAttributes, CreationOptional, Op } from "sequelize";
import { Logger } from "../../Logger.ts";
import { EditQueue, SupportedGames } from "../../Database.ts";
import { sendEditLog, sendModLog, WebhookLogType } from "../../ModWebhooks.ts";
import { Categories, Platform, DatabaseHelper, Status, ProjectAPIPublicResponse, StatusHistory, UserRoles } from "../DBHelper.ts";
import { Version } from "./ModVersion.ts";
import { User } from "./User.ts";
import path from "path";
import fs from "fs";
import { Config } from "../../Config.ts";

export type ProjectInfer = InferAttributes<Project>;
export type ProjectEdit = Partial<Pick<Project, `name` | `summary` | `description` | `category` | `gitUrl` | `authorIds` | `gameName`>>;
export class Project extends Model<InferAttributes<Project>, InferCreationAttributes<Project>> {
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
    declare statusHistory: CreationOptional<StatusHistory[]>;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public isAllowedToView(user: User|null|undefined):boolean {
        if (this.status == Status.Verified || this.status == Status.Unverified || this.status == Status.Pending) {
            return true;
        }
        // Private & Removed are the only mods that are not viewable by the public
        if (!user || !user.roles || !user.roles.sitewide) {
            return false;
        }
        
        if (
            user.roles.sitewide.includes(UserRoles.Admin) ||
            user.roles.sitewide.includes(UserRoles.AllPermissions) ||
            user.roles.sitewide.includes(UserRoles.Approver) ||
            user.roles.sitewide.includes(UserRoles.GameManager) ||
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
                    roles.includes(UserRoles.Approver) ||
                    roles.includes(UserRoles.GameManager) ||
                    roles.includes(UserRoles.AllPermissions)) {
                    return true;
                }
            }
        }
        return false;
    }

    public isAllowedToEdit(user: User|null, isGameChange: boolean = false) {
        if (!this.isAllowedToView(user)) {
            return false;
        }

        if (!user) {
            return false;
        }

        if (!isGameChange) {
            if (this.authorIds.includes(user.id)) {
                return true;
            }
        }

        if (user.roles && user.roles.sitewide &&
            (user.roles.sitewide.includes(UserRoles.AllPermissions) ||
             user.roles.sitewide.includes(UserRoles.Approver))) {
            return true;
        }

        if (user && user.roles && user.roles.perGame && user.roles.perGame[this.gameName] &&
            (user.roles.perGame[this.gameName]?.includes(UserRoles.AllPermissions) ||
             user.roles.perGame[this.gameName]?.includes(UserRoles.Approver))) {
            return true;
        }

        return false;
    }

    public async getLatestVersion(gameVersionId: number, platform: Platform, statusesToSearchFor: Status[]): Promise<Version | null> {
        let versions = DatabaseHelper.cache.versions.filter((version) => {
            if (version.projectId !== this.id) {
                return false;
            }

            if (!statusesToSearchFor.includes(version.status)) {
                return false;
            }

            // if the version is not for the correct game
            if (!version.supportedGameVersionIds.includes(gameVersionId)) {
                return false;
            }

            
            if (platform === Platform.UniversalQuest) {
                return version.platform === Platform.UniversalQuest;
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

    public async edit(object: ProjectEdit, submitter: User): Promise<{isEditObj: true, newEdit: boolean, edit: EditQueue} | {isEditObj: false, mod: Project}> {
        if (this.status !== Status.Verified && this.status !== Status.Unverified) {
            await this.update({ ...object, lastUpdatedById: submitter.id });
            sendModLog(this, submitter, WebhookLogType.Text_Updated);
            return {isEditObj: false, mod: this};
        }

        // check if there is already a pending edit
        let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: this.id, objectTableName: `mods`, approved: { [Op.eq]: null } } });
        if (existingEdit) {
            // if an edit already exists, update it
            existingEdit.object = {
                ...existingEdit.object,
                ...object,
            };
            existingEdit.submitterId = submitter.id;
            let newEdit = await existingEdit.save();
            sendEditLog(newEdit, submitter, WebhookLogType.Text_Updated, this);
            return {isEditObj: true, newEdit: false, edit: newEdit};
        }

        // create a new edit
        let edit = await DatabaseHelper.database.EditApprovalQueue.create({
            objectId: this.id,
            objectTableName: `mods`,
            object: object,
            submitterId: submitter.id,
        });

        // check if the edit is just the description - this is intentionally after the existing edit check. existing edits will block all edits until it is approved
        if (Object.keys(object).length === 1 && object.description && object.description !== this.description) {
            // if the only edit is the description, just update the mod
            await edit.approve(submitter, true);
            await this.reload();
            // no need to send log, as it is already sent in the approve method
            return {isEditObj: false, mod: this};
        }
        
        sendEditLog(edit, submitter, WebhookLogType.EditSubmitted, this);
        return {isEditObj: true, newEdit: true, edit: edit};
    }

    public async setStatus(status:Status, user: User, reason:string = `No reason provided.`, shouldSendEmbed: boolean = true): Promise<Project> {
        let prevStatus = this.status;
        this.status = status;
        this.lastUpdatedById = user.id;
        if (reason.trim().length <= 1) {
            reason = `No reason provided.`;
        }
        this.statusHistory = [...this.statusHistory, {
            status: status,
            reason: reason,
            userId: user.id,
            setAt: new Date(),
        }];
        try {
            await this.save();
        } catch (error) {
            Logger.error(`Error setting status: ${error}`);
            throw error;
        }
        Logger.log(`Mod ${this.id} set to status ${status} by ${user.username}`);
        sendModLog(this, user, WebhookLogType.Text_StatusChanged);

        if (prevStatus == Status.Verified && status !== Status.Verified) {
            sendModLog(this, user, WebhookLogType.VerificationRevoked, reason);
            return this;
        }
        switch (status) {
            case Status.Unverified:
                this.lastApprovedById = user.id;
                this.save();
                if (prevStatus == Status.Removed) {
                    //sendModLog(this, user, WebhookLogType.Text_StatusChanged);
                } else {
                    sendModLog(this, user, WebhookLogType.RejectedUnverified, reason);
                }
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                this.save();
                shouldSendEmbed ? sendModLog(this, user, WebhookLogType.Verified, reason) : null;
                break;
            case Status.Removed:
                shouldSendEmbed ? sendModLog(this, user, WebhookLogType.Removed, reason) : null;
                break;
            case Status.Pending:
                shouldSendEmbed ? sendModLog(this, user, WebhookLogType.SetToPending, reason) : null;
                break;
        }
        return this;
    }

    public async isRestorable(): Promise<boolean> {
        return fs.existsSync(`${path.resolve(Config.storage.iconsDir)}/${this.iconFileName}`);
    }

    public static async checkForExistingMod(name: string) {
        let mod = await DatabaseHelper.database.Projects.findOne({ where: { name: name } });
        return mod;
    }

    public static async countExistingMods(name: string) {
        let count = await DatabaseHelper.database.Projects.count({ where: { name: name } });
        return count;
    }

    public toAPIResponse(): ProjectAPIPublicResponse {
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
            statusHistory: this.statusHistory,
            lastApprovedById: this.lastApprovedById,
            lastUpdatedById: this.lastUpdatedById,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}