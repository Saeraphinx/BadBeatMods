import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sendEditLog, WebhookLogType } from "../../ModWebhooks.ts";
import { Logger } from "../../Logger.ts";
import { DatabaseHelper, Status } from "../DBHelper.ts";
import { User } from "./User.ts";
import { Project, ProjectEdit, ProjectInfer } from "./Project.ts";
import { Version, VersionEdit, VersionInfer } from "./Version.ts";

export class EditQueue extends Model<InferAttributes<EditQueue>, InferCreationAttributes<EditQueue>> {
    declare readonly id: CreationOptional<number>;
    declare submitterId: number;
    declare objectId: number;
    declare objectTableName: `modVersions` | `mods`;
    declare object: VersionEdit | ProjectEdit;

    declare approverId: CreationOptional<number> | null;
    declare approved: boolean | null; // just use null as a 3rd bit 5head
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public isVersion(): this is EditQueue & { objectTableName: `modVersions`, object: VersionEdit } {
        let hasVersionKeys = `modVersion` in this.object ||
            `platform` in this.object ||
            `supportedGameVersionIds` in this.object ||
            `dependencies` in this.object;
        return this.objectTableName === `modVersions` && hasVersionKeys;
    }

    public isProject(): this is EditQueue & { objTableName: `mods`, object: ProjectEdit } {
        let hasProjectKeys = `name` in this.object ||
            `summary` in this.object ||
            `description` in this.object ||
            `category` in this.object ||
            `gitUrl` in this.object ||
            `authorIds` in this.object ||
            `gameName` in this.object;
        return this.objectTableName === `mods` && hasProjectKeys;
    }

    public async approve(approver: User, bypassApproval: boolean = false): Promise<Project | Version | undefined> {
        if (typeof this.approved == `boolean`) {
            return;
        }
        
        let record: Project | Version | undefined = undefined;
        let original: ProjectInfer | VersionInfer | undefined = undefined;

        if (this.objectTableName == `modVersions` && `modVersion` in this.object) {
            let version = await DatabaseHelper.database.Versions.findByPk(this.objectId);
            if (version) {
                original = version.toJSON();
                version.modVersion = this.object.modVersion || version.modVersion;
                version.platform = this.object.platform || version.platform;
                version.supportedGameVersionIds = this.object.supportedGameVersionIds || version.supportedGameVersionIds;
                version.dependencies = this.object.dependencies || version.dependencies;
                //version.lastApprovedById = approver.id;
                version.lastUpdatedById = this.submitterId;
                //version.status = Status.Verified;
                if (version.status == Status.Verified) {
                    version.lastApprovedById = approver.id;
                }
                record = await version.save();
            }
        } else if (this.objectTableName == `mods` && `name` in this.object) {
            let project = await DatabaseHelper.database.Projects.findByPk(this.objectId);
            if (project) {
                original = project.toJSON();
                project.name = this.object.name || project.name;
                project.summary = this.object.summary || project.summary;
                project.description = this.object.description || project.description;
                project.category = this.object.category || project.category;
                project.gitUrl = this.object.gitUrl || project.gitUrl;
                project.authorIds = this.object.authorIds || project.authorIds;
                project.gameName = this.object.gameName || project.gameName;
                //project.lastApprovedById = approver.id;
                project.lastUpdatedById = this.submitterId;
                //project.status = Status.Verified;
                if (project.status == Status.Verified) {
                    project.lastApprovedById = approver.id;
                }
                record = await project.save();
            }
        }
        this.approved = true;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} approved by ${approver.username}`);
            if (bypassApproval) {
                sendEditLog(this, approver, WebhookLogType.Text_EditBypassed, original);
            }
            sendEditLog(this, approver, WebhookLogType.EditApproved, original);
            
        }).catch((error) => {
            Logger.error(`Error approving edit ${this.id}: ${error}`);
        });
        return record;
    }

    public async deny(approver: User, bypassApproval: boolean = false): Promise<void> {
        if (typeof this.approved == `boolean`) {
            return;
        }

        //let record = this.isMod() ? await DatabaseHelper.database.Projects.findByPk(this.objectId) : await DatabaseHelper.database.ModVersions.findByPk(this.objectId);
        this.approved = false;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} denied by ${approver.username}`);
            if (bypassApproval) {
                sendEditLog(this, approver, WebhookLogType.Text_EditBypassed);
            } else {
                sendEditLog(this, approver, WebhookLogType.EditRejected);
            }
        }).catch((error) => {
            Logger.error(`Error denying edit ${this.id}: ${error}`);
        });
    }
}