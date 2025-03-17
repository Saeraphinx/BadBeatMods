import { SemVer, satisfies } from "semver";
import { InferAttributes, Model, InferCreationAttributes, CreationOptional, Op } from "sequelize";
import { Logger } from "../../Logger.ts";
import { Platform, ContentHash, DatabaseHelper, GameVersionAPIPublicResponse, ModVersionAPIPublicResponse, Status } from "../DBHelper.ts";
import { sendEditLog, sendModVersionLog, WebhookLogType } from "../../ModWebhooks.ts";
import { User, UserRoles } from "./User.ts";
import { Mod } from "./Mod.ts";
import { EditQueue } from "./EditQueue.ts";
import { ValidationOptions } from "sequelize/types/instance-validator";

export type ModVersionInfer = InferAttributes<ModVersion>;
export type ModVersionApproval = Partial<InferAttributes<ModVersion, { omit: `modId` | `id` | `createdAt` | `updatedAt` | `deletedAt` | `authorId` | `status` | `contentHashes` | `zipHash` | `fileSize` | `lastApprovedById` | `lastUpdatedById` | `downloadCount` }>>
export class ModVersion extends Model<InferAttributes<ModVersion>, InferCreationAttributes<ModVersion>> {
    declare readonly id: CreationOptional<number>;
    declare modId: number;
    declare authorId: number;
    declare modVersion: SemVer;
    declare supportedGameVersionIds: number[];
    declare status: Status;
    declare dependencies: number[]; // array of modVersion ids
    declare platform: Platform;
    declare zipHash: string;
    declare contentHashes: ContentHash[];
    declare downloadCount: CreationOptional<number>;
    declare lastApprovedById: CreationOptional<number> | null;
    declare lastUpdatedById: number;
    declare fileSize: number;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public async isAllowedToView(user: User|null, useCache:Mod|boolean = true) {
        let parentMod: Mod | null | undefined;
        if (typeof useCache === `object`) {
            parentMod = useCache; // if a mod is passed in, use that as the parent mod
        } else if (useCache) {
            parentMod = DatabaseHelper.cache.mods.find((mod) => mod.id == this.modId);
        } else {
            parentMod = await DatabaseHelper.database.Mods.findByPk(this.modId);
        }

        if (!parentMod) {
            Logger.error(`ModVersion ${this.id} does not have a valid parent mod (reading ${this.modId}).`);
            return false;
        }

        let parentModVisible = parentMod.isAllowedToView(user);

        if (!parentModVisible) {
            return false;
        }

        if (this.status == Status.Verified || this.status == Status.Unverified) {
            return true;
        }

        if (!user || !user.roles || !user.roles.sitewide) {
            return false;
        }

        if (
            user.roles.sitewide.includes(UserRoles.Admin) ||
            user.roles.sitewide.includes(UserRoles.AllPermissions) ||
            user.roles.sitewide.includes(UserRoles.Approver) ||
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
                    roles.includes(UserRoles.AllPermissions)) {
                    return true;
                }
            }
        }
    }

    public async isAllowedToEdit(user: User|null, useCache:Mod|boolean = true) {
        let parentMod: Mod | null | undefined;
        if (useCache instanceof Mod) {
            parentMod = useCache; // if a mod is passed in, use that as the parent mod
        } else if (useCache) {
            parentMod = DatabaseHelper.cache.mods.find((mod) => mod.id == this.modId);
        } else {
            parentMod = await DatabaseHelper.database.Mods.findByPk(this.modId);
        }

        if (!parentMod) {
            Logger.error(`ModVersion ${this.id} does not have a valid parent mod (reading ${this.modId}).`);
            return false;
        }

        if (await this.isAllowedToView(user, parentMod)) {
            if (parentMod.isAllowedToEdit(user)) {
                return true;
            }
        }
        return false;
    }

    public async edit(object: ModVersionApproval, submitter: User): Promise<{isEditObj: true, newEdit: boolean, edit: EditQueue} | {isEditObj: false, modVersion: ModVersion}> {
        if (this.status !== Status.Verified) {
            this.update(object);
            sendModVersionLog(this, submitter, WebhookLogType.Text_Updated);
            return {isEditObj: false, modVersion: this};
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

    public async setStatus(status:Status, user: User, shouldSendEmbed: boolean = true) {
        let prevStatus = this.status;
        this.status = status;
        try {
            await this.save();
        } catch (error) {
            Logger.error(`Error setting status: ${error}`);
            throw error;
        }
        sendModVersionLog(this, user, WebhookLogType.Text_StatusChanged);
        Logger.log(`Mod ${this.id} approved by ${user.username}`);
        switch (status) {
            case Status.Unverified:
                if (prevStatus == Status.Verified) {
                    this.lastApprovedById = user.id;
                    shouldSendEmbed ? sendModVersionLog(this, user, WebhookLogType.VerificationRevoked) : undefined;
                } else {
                    sendModVersionLog(this, user, WebhookLogType.RejectedUnverified);
                }
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                shouldSendEmbed ? sendModVersionLog(this, user, WebhookLogType.Verified) : undefined;
                break;
            case Status.Removed:
                shouldSendEmbed ? sendModVersionLog(this, user, WebhookLogType.Removed) : undefined;
                this.lastApprovedById = user.id;
                break;
            case Status.Pending:
                shouldSendEmbed ? sendModVersionLog(this, user, WebhookLogType.SetToPending) : undefined;
                break;
        }
        return this;
    }

    public async addGameVersionId(gameVersionId: number, submitter: User, shouldSendLog:boolean = true): Promise<ModVersion | EditQueue | null> {
        if (this.supportedGameVersionIds.includes(gameVersionId)) {
            return Promise.resolve(null);
        }

        if (this.status !== Status.Verified) {
            this.supportedGameVersionIds = [...this.supportedGameVersionIds, gameVersionId];
            let res = this.save();
            shouldSendLog ? sendModVersionLog(this, submitter, WebhookLogType.Text_Updated) : null;
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
    public static async checkForExistingVersion(modId: number, semver: SemVer, platform:Platform): Promise<ModVersion | null> {
        let modVersion = await DatabaseHelper.database.ModVersions.findOne({ where: { modId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
        return modVersion;
    }

    public static async countExistingVersions(modId: number, semver: SemVer, platform:Platform): Promise<number> {
        let count = await DatabaseHelper.database.ModVersions.count({ where: { modId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
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

    public getRawDependencies() {
        let deps = DatabaseHelper.cache.modVersions.filter((version) => this.dependencies.includes(version.id));
        if (deps.length != this.dependencies.length) {
            Logger.error(`Failed to find all dependencies for ${this.id}`);
            return null;
        } else {
            return deps;
        }
    }

    public async getLiveDependencies(gameVersionId: number, statusesToSearchFor: Status[]): Promise<ModVersion[] | null> {
        let dependencies = [];

        for (let dependencyId of this.dependencies) {
            let dependency = DatabaseHelper.cache.modVersions.find((version) => version.id == dependencyId);
            if (!dependency) {
                let dbDep = await DatabaseHelper.database.ModVersions.findByPk(dependencyId);
                if (dbDep) {
                    dependency = dbDep;
                } else {
                    Logger.error(`Failed to find dependency ${dependencyId} (Req by ${this.id})`);
                    return null;
                }
            }

            let parentMod = DatabaseHelper.cache.mods.find((mod) => mod.id == dependency.modId);
            if (!parentMod) {
                let dbMod = await DatabaseHelper.database.Mods.findByPk(dependency.modId);
                if (dbMod) {
                    parentMod = dbMod;
                } else {
                    Logger.error(`Failed to find parent mod ${dependency.modId} for dependency ${dependency.id} (Req by ${this.id})`);
                    return null;
                }
            }

            let latestVersion = await parentMod.getLatestVersion(gameVersionId, dependency.platform, statusesToSearchFor);
            if (latestVersion) {
                dependencies.push(latestVersion);
            } else {
                Logger.debugWarn(`Failed to find latest version for dependency ${dependency.id} (Req by ${this.id})`);
                return null;
            }
        }

        return dependencies;
    }
    // this function is for when a mod supports a newer version but the dependancy does not. (uses ^x.x.x for comparison)
    public static async isValidDependancySucessor(originalVersion:ModVersion, newVersion:ModVersion, forVersion: number): Promise<boolean> {
        let newGameVersions = await newVersion.getSupportedGameVersions();

        if (!newGameVersions.find((version) => version.id == forVersion)) {
            return false;
        }

        return satisfies(newVersion.modVersion, `^${originalVersion.modVersion.raw}`);
    }

    public async checkDependencies(gameVersionId: number, statusesToSearchFor: Status[]): Promise<DependencyCheckResults[]> {
        let results: DependencyCheckResults[] = [];
        let deps = this.dependencies.map((dependencyId) => {
            return {id: dependencyId, depObj: DatabaseHelper.cache.modVersions.find((version) => version.id == dependencyId)};
        });
        let updatedDeps = await this.getLiveDependencies(gameVersionId, statusesToSearchFor);
        for (let dep of deps) {
            // check if the dependency exists
            if (dep.depObj == undefined) {
                Logger.error(`Failed to find dependency ${dep.id} (Req by ${this.id})`);
                results.push({
                    modId: null,
                    dependencyId: dep.id,
                    newerDependencyId: null,
                    isAvailable: false,
                    reason: `Failed to find dependency ${dep.id}`,
                });
                continue;
            }

            // check if able to find updated dependencies
            if (updatedDeps == null) {
                Logger.error(`Failed to find dependencies for ${this.id}`);
                results.push({
                    modId: null,
                    dependencyId: dep.id,
                    newerDependencyId: null,
                    isAvailable: false,
                    reason: `Failed to resolve dependencies for ${this.id}`,
                });
                continue;
            }

            //
            let updatedDep = updatedDeps.find((version) => version.modId == dep.depObj?.modId);
            if (!updatedDep) {
                Logger.warn(`Failed to find updated dependency ${dep.id} (Req by ${this.id})`);
                results.push({
                    modId: dep.depObj?.modId,
                    dependencyId: dep.id,
                    newerDependencyId: null,
                    isAvailable: false,
                    reason: `Failed to find updated dependency ${dep.id}`,
                });
                continue;
            }

            // check if the dependency is available
            if (statusesToSearchFor.includes(updatedDep.status)) {
                results.push({
                    modId: dep.depObj?.modId,
                    dependencyId: dep.id,
                    newerDependencyId: updatedDep.id,
                    isAvailable: true,
                    reason: null,
                });
            } else {
                results.push({
                    modId: dep.depObj?.modId,
                    dependencyId: dep.id,
                    newerDependencyId: updatedDep.id,
                    isAvailable: false,
                    reason: `Dependency ${dep.id} is not available (status ${updatedDep.status} was not found in ${statusesToSearchFor.join(`, `)})`,
                });
            }
        }

        return results;
    }

    public toRawAPIResonse() {
        return {
            id: this.id,
            modId: this.modId,
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
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }

    public async toAPIResonse(gameVersionId: number = this.supportedGameVersionIds[0], statusesToSearchFor:Status[]): Promise<ModVersionAPIPublicResponse|null> {
        let dependencies = await this.getLiveDependencies(gameVersionId, statusesToSearchFor);
        if (!dependencies) {
            dependencies = this.getRawDependencies();
            if (!dependencies) {
                Logger.error(`Failed to find dependencies for ${this.id}`);
                return null;
            }
        }

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
            modId: this.modId,
            author: author.toAPIResponse(),
            modVersion: this.modVersion.raw,
            platform: this.platform,
            zipHash: this.zipHash,
            status: this.status,
            dependencies: dependencies.flatMap((dependancy) => dependancy.id),
            contentHashes: this.contentHashes,
            downloadCount: this.downloadCount,
            supportedGameVersions: await this.getSupportedGameVersions(),
            fileSize: this.fileSize,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}

export type DependencyCheckResults = {
    modId: number|null;
    dependencyId: number;
    newerDependencyId: number|null;
    isAvailable: boolean;
    reason: string|null;
}