import { Model, InferAttributes, InferCreationAttributes, CreationOptional, Op } from "sequelize";
import { ModInfer } from "./Mod";
import { ModVersionInfer } from "./ModVersion";

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
    declare readonly id: CreationOptional<number>;
    declare objectId: number;
    declare objectTableName: `gameVersions` | `mods` | `modVersions`;
    declare object: any;

    declare heldById: CreationOptional<number> | null;
    declare heldFromDeletion: CreationOptional<boolean>;
    declare heldUntil: CreationOptional<Date> | null;

    declare actionType: CreationOptional<`create` | `update` | `delete`>;
    declare actionReason: CreationOptional<string> | null;

    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    // declare readonly deletedAt: CreationOptional<Date> | null; //this table is not paranoid.

    public isGameVersion(): this is AuditLog & { objectTableName: `gameVersions`, object: any } {
        return this.objectTableName === `gameVersions`;
    }

    public isModVersion(): this is AuditLog & { objectTableName: `modVersions`, object: ModVersionInfer } {
        return this.objectTableName === `modVersions`;
    }

    public isMod(): this is AuditLog & { objectTableName: `mods`, object: ModInfer } {
        return this.objectTableName === `mods`;
    }

    public static pruneOldLogs(): Promise<number> {
        return this.destroy({
            where: {
                heldUntil: {
                    [Op.lt]: new Date(Date.now()) // 30 days
                }
            }
        });
    }
}