import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { SupportedGames, PostType, Platform, Translations, DatabaseHelper } from "../../Database";

export class MOTD extends Model<InferAttributes<MOTD>, InferCreationAttributes<MOTD>> {
    declare readonly id: CreationOptional<number>;
    declare gameName: SupportedGames;
    declare gameVersionIds?: number[]|null;
    declare postType: PostType;
    declare platforms?: Platform[]|null;
    declare message: string;
    declare translations: Translations[];
    declare authorId: number;
    declare startTime: Date;
    declare endTime: Date;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public static async getActiveMOTDs(gameName: SupportedGames, versions:number[]|undefined = undefined, platform:Platform|undefined, getExpired = false): Promise<MOTD[]> {
        return DatabaseHelper.cache.motd.filter((motd) => {
            let now = new Date();
            if (getExpired) {
                if (motd.endTime < now) {
                    return false;
                }
            }

            if (motd.startTime > now) {
                return false;
            }

            if (motd.gameName != gameName) {
                return false;
            }

            if (motd.gameVersionIds) {
                if (versions && !motd.gameVersionIds.some((id) => versions.includes(id))) {
                    return false;
                }
            }

            if (motd.platforms && platform) {
                if (!motd.platforms.includes(platform)) {
                    return false;
                }
            }

            return true;
        });
    }
}