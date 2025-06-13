import { SemVer } from "semver";
import { InferAttributes, Model, InferCreationAttributes, CreationOptional, Op, NonAttribute } from "sequelize";
import { Logger } from "../../Logger.ts";
import * as fs from "fs";
import { Platform, ContentHash, DatabaseHelper, GameVersionAPIPublicResponse, VersionAPIPublicResponse, Status, StatusHistory, UserRoles, Dependency } from "../DBHelper.ts";
import { sendEditLog, sendVersionLog, WebhookLogType } from "../../ModWebhooks.ts";
import { User } from "./User.ts";
import { Project } from "./Project.ts";
import { EditQueue } from "./EditQueue.ts";
import path from "path";
import { Config } from "../../Config.ts";

export type VersionInfer = InferAttributes<Version>;
export type VersionEdit = Partial<Pick<Version, `modVersion` | `platform` | `supportedGameVersionIds` | `dependencies`>>;
export class Version extends Model<InferAttributes<Version>, InferCreationAttributes<Version>> {
    declare readonly id: CreationOptional<number>;
    declare projectId: number;
    declare authorId: number;
    declare modVersion: SemVer;
    declare supportedGameVersionIds: number[];
    declare status: Status;
    declare dependencies: Dependency[];
    declare platform: Platform;
    declare zipHash: string;
    declare contentHashes: ContentHash[];
    declare downloadCount: CreationOptional<number>;
    declare lastApprovedById: CreationOptional<number> | null;
    declare lastUpdatedById: number;
    declare fileSize: number;
    declare statusHistory: CreationOptional<StatusHistory[]>;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public get mod(): NonAttribute<Project | undefined> {
        let mod = DatabaseHelper.mapCache.projects.get(this.projectId);
        if (!mod) {
            Logger.error(`Failed to find mod ${this.projectId} for mod version ${this.id}`);
            return undefined;
        }
        return mod;
    }

    public async isAllowedToView(user: User|null|undefined, useCache:Project|boolean = true) {
        let parentMod: Project | null | undefined;
        if (typeof useCache === `object`) {
            parentMod = useCache; // if a mod is passed in, use that as the parent mod
        } else if (useCache) {
            parentMod = DatabaseHelper.mapCache.projects.get(this.projectId);
        } else {
            parentMod = await DatabaseHelper.database.Projects.findByPk(this.projectId);
        }

        if (!parentMod) {
            Logger.error(`ModVersion ${this.id} does not have a valid parent mod (reading ${this.projectId}).`);
            return false;
        }

        let parentModVisible = parentMod.isAllowedToView(user);

        if (!parentModVisible) {
            return false;
        }

        if (this.status == Status.Verified || this.status == Status.Unverified || this.status == Status.Pending) {
            return true;
        }

        if (!user || !user.roles || !user.roles.sitewide) {
            return false;
        }

        if (
            user.roles.sitewide.includes(UserRoles.Admin) ||
            user.roles.sitewide.includes(UserRoles.AllPermissions) ||
            user.roles.sitewide.includes(UserRoles.Approver) ||
            user.roles.sitewide.includes(UserRoles.GameManager) ||
            this.authorId == user.id
        ) {
            return true;
        } else {
            if (!user.roles.perGame[parentMod.gameName]) {
                return false;
            } else {
                let roles = user.roles.perGame[parentMod.gameName];
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
    }

    public async isAllowedToEdit(user: User|null, useCache:Project|boolean = true) {
        let parentMod: Project | null | undefined;
        if (useCache instanceof Project) {
            parentMod = useCache; // if a mod is passed in, use that as the parent mod
        } else if (useCache) {
            parentMod = DatabaseHelper.mapCache.projects.get(this.projectId);
        } else {
            parentMod = await DatabaseHelper.database.Projects.findByPk(this.projectId);
        }

        if (!parentMod) {
            Logger.error(`ModVersion ${this.id} does not have a valid parent mod (reading ${this.projectId}).`);
            return false;
        }

        if (await this.isAllowedToView(user, parentMod)) {
            if (parentMod.isAllowedToEdit(user)) {
                return true;
            }
        }
        return false;
    }

    public async edit(object: VersionEdit, submitter: User): Promise<{isEditObj: true, newEdit: boolean, edit: EditQueue} | {isEditObj: false, version: Version}> {
        if (this.status !== Status.Verified) {
            this.update({...object, lastUpdatedById: submitter.id});
            sendVersionLog(this, submitter, WebhookLogType.Text_Updated);
            return {isEditObj: false, version: this};
        }
    
        // check if there is already a pending edit
        let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: this.id, objectTableName: `modVersions`, approved: { [Op.eq]: null } } });
        if (existingEdit) {
            // if an edit already exists, update it
            existingEdit.object = object;
            existingEdit.submitterId = submitter.id;
            let newEdit = await existingEdit.save();
            sendEditLog(newEdit, submitter, WebhookLogType.Text_Updated, this);
            return {isEditObj: true, newEdit: false, edit: newEdit};
        }
    
        // create a new edit
        let edit = await DatabaseHelper.database.EditApprovalQueue.create({
            objectId: this.id,
            objectTableName: `modVersions`,
            object: object,
            submitterId: submitter.id,
        });

        sendEditLog(edit, submitter, WebhookLogType.EditSubmitted, this);
        return {isEditObj: true, newEdit: true, edit: edit};
    }

    public async setStatus(status:Status, user: User, reason:string = `No reason provided.`, shouldSendEmbed: boolean = true) {
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
        sendVersionLog(this, user, WebhookLogType.Text_StatusChanged);
        Logger.log(`Mod ${this.id} approved by ${user.username}`);

        if (prevStatus == Status.Verified && status !== Status.Verified) {
            this.lastApprovedById = user.id;
            shouldSendEmbed ? sendVersionLog(this, user, WebhookLogType.VerificationRevoked, undefined, reason) : undefined;
            return this;
        }

        switch (status) {
            case Status.Unverified:
                sendVersionLog(this, user, WebhookLogType.RejectedUnverified, undefined, reason);
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                this.save();
                shouldSendEmbed ? sendVersionLog(this, user, WebhookLogType.Verified, undefined, reason) : undefined;
                break;
            case Status.Removed:
                this.lastApprovedById = user.id;
                this.save();
                shouldSendEmbed ? sendVersionLog(this, user, WebhookLogType.Removed, undefined, reason) : undefined;
                break;
            case Status.Pending:
                shouldSendEmbed ? sendVersionLog(this, user, WebhookLogType.SetToPending, undefined, reason) : undefined;
                break;
        }
        return this;
    }

    public async isRestorable(): Promise<boolean> {
        let mod = await DatabaseHelper.database.Projects.findByPk(this.projectId);
        if (!mod) {
            Logger.error(`Mod ${this.projectId} not found for mod version ${this.id}`);
            return false;
        }
        if (!mod.isRestorable()) {
            return false;
        }
        return fs.existsSync(`${path.resolve(Config.storage.modsDir)}/${this.modVersion.raw}.zip`);
    }

    public async addGameVersionId(gameVersionId: number, submitter: User, shouldSendLog:boolean = true): Promise<Version | EditQueue | null> {
        if (this.supportedGameVersionIds.includes(gameVersionId)) {
            return Promise.resolve(null);
        }

        if (this.status !== Status.Verified) {
            this.supportedGameVersionIds = [...this.supportedGameVersionIds, gameVersionId];
            let res = this.save();
            shouldSendLog ? sendVersionLog(this, submitter, WebhookLogType.Text_Updated) : null;
            return res;
        } else {
            let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: this.id, objectTableName: `modVersions`, submitterId: submitter.id, approved: null } });

            if (existingEdit) {
                throw new Error(`Edit already exists for this mod version.`);
            }

            let res = await DatabaseHelper.database.EditApprovalQueue.create({
                submitterId: submitter.id,
                objectId: this.id,
                objectTableName: `modVersions`,
                object: {
                    dependencies: this.dependencies,
                    modVersion: this.modVersion,
                    platform: this.platform,
                    supportedGameVersionIds: [...this.supportedGameVersionIds, gameVersionId],
                },
            });
            shouldSendLog ? sendEditLog(res, submitter, WebhookLogType.EditSubmitted, this) : null;
            return res;
        }
    }

    // this function called to see if a duplicate version already exists in the database. if it does, creation of a new version should be halted.
    public static async checkForExistingVersion(modId: number, semver: SemVer, platform:Platform): Promise<Version | null> {
        let modVersion = await DatabaseHelper.database.Versions.findOne({ where: { projectId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
        return modVersion;
    }

    public static async countExistingVersions(modId: number, semver: SemVer, platform:Platform): Promise<number> {
        let count = await DatabaseHelper.database.Versions.count({ where: { projectId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
        return count;
    }

    public async getSupportedGameVersions(): Promise<GameVersionAPIPublicResponse[]> {
        let gameVersions: GameVersionAPIPublicResponse[] = [];
        for (let versionId of this.supportedGameVersionIds) {
            let version = DatabaseHelper.cache.gameVersions.find((version) => version.id == versionId);
            if (!version) {
                let dbVer = await DatabaseHelper.database.GameVersions.findByPk(versionId);
                if (dbVer) {
                    version = dbVer;
                }
            }

            if (version) {
                gameVersions.push(version.toAPIResponse());
            }

        }
        return gameVersions;
    }

    public async getDependencyObjs(gameVersionId: number, statusesToSearchFor: Status[]): Promise<Version[] | null> {
        let dependencies = [];

        for (let dep of this.dependencies) {
            let parentMod = DatabaseHelper.mapCache.projects.get(dep.parentId);
            if (!parentMod) {
                Logger.debugWarn(`Failed to find parent project ${dep.parentId} for dependency (Req by ${this.id})`);
                return null;
            }

            let latestVersion = await parentMod.getLatestVersion(gameVersionId, this.platform, statusesToSearchFor);
            if (latestVersion && latestVersion.modVersion.compare(dep.sv) >= 1) {
                dependencies.push(latestVersion);
            } else {
                Logger.debugWarn(`Failed to find compatible version from ${this.id} (Req by ${this.id})`);
                return null;
            }
        }

        return dependencies;
    }

    //this method should check to see if all dependencies are satisfied for a given game version id and status.
    /*public async checkDependencies(gameVersionId: number, statusesToSearchFor: Status[]) { //: Promise<DependencyCheckResults[]> {
        return null; // TODO: implement this function
    }*/

    public toRawAPIResponse() {
        return {
            id: this.id,
            projectId: this.projectId,
            authorId: this.authorId,
            modVersion: this.modVersion.raw,
            platform: this.platform,
            zipHash: this.zipHash,
            status: this.status,
            dependencies: this.dependencies,
            contentHashes: this.contentHashes,
            supportedGameVersionIds: this.supportedGameVersionIds,
            downloadCount: this.downloadCount,
            fileSize: this.fileSize,
            statusHistory: this.statusHistory,
            lastApprovedById: this.lastApprovedById,
            lastUpdatedById: this.lastUpdatedById,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }

    public async toAPIResponse(): Promise<VersionAPIPublicResponse|null> {
        let author = DatabaseHelper.cache.users.find((user) => user.id == this.authorId);
        if (!author) {
            let dbAuthor = await DatabaseHelper.database.Users.findByPk(this.authorId);
            if (dbAuthor) {
                author = dbAuthor;
            } else {
                Logger.error(`Failed to find author ${this.authorId} for mod version ${this.id}`);
                author = DatabaseHelper.database.serverAdmin;
            }
        }

        return {
            id: this.id,
            projectId: this.projectId,
            author: author.toAPIResponse(),
            modVersion: this.modVersion.raw,
            platform: this.platform,
            zipHash: this.zipHash,
            status: this.status,
            dependencies: this.dependencies,
            contentHashes: this.contentHashes,
            downloadCount: this.downloadCount,
            supportedGameVersions: await this.getSupportedGameVersions(),
            fileSize: this.fileSize,
            statusHistory: this.statusHistory,
            lastApprovedById: this.lastApprovedById,
            lastUpdatedById: this.lastUpdatedById,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}