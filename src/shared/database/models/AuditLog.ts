import { Model, InferAttributes, InferCreationAttributes, CreationOptional, Op } from "sequelize";
import { Mod, ModInfer } from "./Mod.ts";
import { ModVersion, ModVersionInfer } from "./ModVersion.ts";
import { GameVersion, GameVersionInfer } from "./GameVersion.ts";

export type AuditLogInfer = InferAttributes<AuditLog>;
export type AuditLogActionType = `create` | `update` | `delete`;
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
    declare readonly id: CreationOptional<number>;
    declare objectId: number;
    declare objectTableName: `gameVersions` | `mods` | `modVersions`;
    declare object: any; // this needs to be any, as it can change throughout the lifetime of the database

    declare heldById: CreationOptional<number> | null;
    declare heldFromDeletion: CreationOptional<boolean>;

    declare actionType: CreationOptional<AuditLogActionType>;
    declare actionReason: CreationOptional<string> | null;

    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    // declare readonly deletedAt: CreationOptional<Date> | null; //this table is not paranoid.

    public isGameVersion(): this is AuditLog & { objectTableName: `gameVersions` } {
        return this.objectTableName === `gameVersions`;
    }

    public isModVersion(): this is AuditLog & { objectTableName: `modVersions` } {
        return this.objectTableName === `modVersions`;
    }

    public isMod(): this is AuditLog & { objectTableName: `mods` } {
        return this.objectTableName === `mods`;
    }

    public static pruneOldLogs(): Promise<number> {
        return this.destroy({
            where: {
                heldFromDeletion: false,
                createdAt: {
                    [Op.lt]: new Date(Date.now()).setDate(-30) // 30 days
                }
            }
        });
    }

    public static async createLog(object: ModInfer | ModVersionInfer | GameVersionInfer, actionType: AuditLogActionType, actionReason: string|null) {
        let objectTableName: `gameVersions` | `mods` | `modVersions`;
        if (object instanceof Mod) {
            objectTableName = `mods`;
        } else if (object instanceof ModVersion) {
            objectTableName = `modVersions`;
        } else if (object instanceof GameVersion) {
            objectTableName = `gameVersions`;
        } else {
            throw new Error(`Invalid object type passed to createLog`);
        }

        return this.create({
            objectId: object.id,
            objectTableName: objectTableName,
            object: object,
            actionType: actionType,
            actionReason: actionReason,
            heldById: null,
            heldFromDeletion: false
        }).catch((err) => {
            throw err;
        });
    }
}