import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sendEditLog, WebhookLogType } from "../../ModWebhooks.ts";
import { Logger } from "../../Logger.ts";
import { DatabaseHelper, Status } from "../DBHelper.ts";
import { User } from "./User.ts";
import { Mod, ModApproval, ModInfer } from "./Mod.ts";
import { ModVersion, ModVersionApproval, ModVersionInfer } from "./ModVersion.ts";

export class EditQueue extends Model<InferAttributes<EditQueue>, InferCreationAttributes<EditQueue>> {
    declare readonly id: CreationOptional<number>;
    declare submitterId: number;
    declare objectId: number;
    declare objectTableName: `modVersions` | `mods`;
    declare object: ModVersionApproval | ModApproval;

    declare approverId: CreationOptional<number> | null;
    declare approved: boolean | null; // just use null as a 3rd bit 5head
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public isModVersion(): this is EditQueue & { objectTableName: `modVersions`, object: ModVersionApproval } {
        let hasModVersionKeys = `modVersion` in this.object ||
            `platform` in this.object ||
            `supportedGameVersionIds` in this.object ||
            `dependencies` in this.object;
        return this.objectTableName === `modVersions` && hasModVersionKeys;
    }

    public isMod(): this is EditQueue & { objTableName: `mods`, object: ModApproval } {
        let hasModKeys = `name` in this.object ||
            `summary` in this.object ||
            `description` in this.object ||
            `category` in this.object ||
            `gitUrl` in this.object ||
            `authorIds` in this.object ||
            `gameName` in this.object;
        return this.objectTableName === `mods` && hasModKeys;
    }

    public async approve(approver: User) {
        if (typeof this.approved == `boolean`) {
            return;
        }
        
        let record: Mod | ModVersion | undefined = undefined;
        let original: ModInfer | ModVersionInfer | undefined = undefined;

        if (this.objectTableName == `modVersions` && `modVersion` in this.object) {
            let modVersion = await DatabaseHelper.database.ModVersions.findByPk(this.objectId);
            if (modVersion) {
                original = modVersion.toJSON();
                modVersion.modVersion = this.object.modVersion || modVersion.modVersion;
                modVersion.platform = this.object.platform || modVersion.platform;
                modVersion.supportedGameVersionIds = this.object.supportedGameVersionIds || modVersion.supportedGameVersionIds;
                modVersion.dependencies = this.object.dependencies || modVersion.dependencies;
                //modVersion.lastApprovedById = approver.id;
                modVersion.lastUpdatedById = this.submitterId;
                //modVersion.status = Status.Verified;
                if (modVersion.status == Status.Verified) {
                    modVersion.lastApprovedById = approver.id;
                }
                record = await modVersion.save();
            }
        } else if (this.objectTableName == `mods` && `name` in this.object) {
            let mod = await DatabaseHelper.database.Mods.findByPk(this.objectId);
            if (mod) {
                original = mod.toJSON();
                mod.name = this.object.name || mod.name;
                mod.summary = this.object.summary || mod.summary;
                mod.description = this.object.description || mod.description;
                mod.category = this.object.category || mod.category;
                mod.gitUrl = this.object.gitUrl || mod.gitUrl;
                mod.authorIds = this.object.authorIds || mod.authorIds;
                mod.gameName = this.object.gameName || mod.gameName;
                //mod.lastApprovedById = approver.id;
                mod.lastUpdatedById = this.submitterId;
                //mod.status = Status.Verified;
                if (mod.status == Status.Verified) {
                    mod.lastApprovedById = approver.id;
                }
                record = await mod.save();
            }
        }
        this.approved = true;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} approved by ${approver.username}`);
            sendEditLog(this, approver, WebhookLogType.EditApproved, original);
        }).catch((error) => {
            Logger.error(`Error approving edit ${this.id}: ${error}`);
        });
        return record;
    }

    public async deny(approver: User) {
        if (typeof this.approved == `boolean`) {
            return;
        }

        //let record = this.isMod() ? await DatabaseHelper.database.Mods.findByPk(this.objectId) : await DatabaseHelper.database.ModVersions.findByPk(this.objectId);
        this.approved = false;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} denied by ${approver.username}`);
            sendEditLog(this, approver, WebhookLogType.EditRejected);
        }).catch((error) => {
            Logger.error(`Error denying edit ${this.id}: ${error}`);
        });
    }
}