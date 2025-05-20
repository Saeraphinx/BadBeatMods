import { z } from "zod";
import { Categories, DatabaseHelper, GameVersion, Version, Platform, Status, SupportedGames, User, Project, PostType, UserRoles, EditQueue } from "./Database.ts";
import { valid, validRange } from "semver";
import { Config } from "./Config.ts";
import { ApprovalAction } from "../api/routes/approval.ts";

//generic types that I use a lot
const ZodDBID = z.number({coerce: true}).int().positive();
const ZodDBIDArray = z.preprocess((t, ctx) => {
    if (Array.isArray(t)) {
        return t;
    } else {
        if (typeof t === `string` && t.length > 0) {
            let ids = t.split(`,`);
            let retVal = ids.map(id => parseInt(id, 10));
            for (let iid of retVal) {
                let parsed = ZodDBID.safeParse(iid);
                if (!parsed.success) {
                    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid ID`});
                    return z.NEVER;
                }
            }
            return retVal;
        } else {
            return t;
        }
    }
}, z.array(ZodDBID));
const ZodBool = z.boolean({coerce: true});
const ZodStatus = z.nativeEnum(Status);
const ZodPlatform = z.nativeEnum(Platform);
const ZodCategory = z.nativeEnum(Categories);
const ZodGameName = z.nativeEnum(SupportedGames);
const ZodPostType = z.nativeEnum(PostType);
const ZodUserRoles = z.nativeEnum(UserRoles);

// from ./Database.ts
const ZodMod = z.object({
    id: ZodDBID,
    name: z.string().min(3).max(64),
    summary: z.string().min(3).max(160),
    description: z.string().min(3).max(4096),
    category: ZodCategory,
    gitUrl: z.string().min(5).max(256).url(),
    gameName: ZodGameName, //z.string().min(3).max(256),
    authorIds: ZodDBIDArray
});

// from ./Database.ts
const ZodModVersion = z.object({
    id: ZodDBID,
    modId: ZodDBID,
    supportedGameVersionIds: ZodDBIDArray,
    modVersion: z.string().refine(valid, { message: `Invalid SemVer` }),
    dependencies: z.array(z.object({
        parentId: ZodDBID,
        sv: z.string().refine(validRange, { message: `Invalid SemVer` }),
    })),
    platform: ZodPlatform,
    status: ZodStatus,
});

// for things marked as optional, zod will set them to undefined if they are not present, otherwise it will validate it.
export class Validator {
    public static readonly z = z;
    public static readonly zDBID = ZodDBID;
    public static readonly zDBIDArray = ZodDBIDArray;
    public static readonly zBool = ZodBool;
    public static readonly zString = z.string();
    public static readonly zStatus = ZodStatus;
    public static readonly zPlatform = ZodPlatform;
    public static readonly zCategory = ZodCategory;
    public static readonly zGameName = ZodGameName;
    public static readonly zPostType = ZodPostType;
    public static readonly zUserRoles = ZodUserRoles;
    public static readonly zHashStringOrArray = z.union([z.string().min(8), z.array(z.string().min(8))]);
    public static readonly zUrl = z.string().url().refine((url) => {
        try {
            let urlObj = new URL(url);
            return Config.auth.permittedRedirectDomains.includes(urlObj.origin);
        } catch (e) {
            return false;
        }
    });
    public static readonly zCreateProject = ZodMod.pick({
        name: true,
        summary: true,
        description: true,
        category: true,
        gitUrl: true,
        gameName: true,
    }).required().strict();

    public static readonly zCreateVersion = z.object({
        supportedGameVersionIds: ZodDBIDArray,
        modVersion: ZodModVersion.shape.modVersion,
        dependencies: ZodModVersion.shape.dependencies.optional(),
        platform: ZodModVersion.shape.platform,
    }).strict();

    public static readonly zUpdateProject = z.object({
        name: z.string().min(3).max(64).optional(),
        summary: z.string().min(3).max(100).optional(),
        description: z.string().min(3).max(4096).optional(),
        category: ZodCategory.optional(),
        gitUrl: z.string().min(5).max(256).url().optional(),
        gameName: ZodGameName.optional(),
        authorIds: ZodDBIDArray.optional(),
    }).strict();

    public static readonly zUpdateVersion = z.object({
        supportedGameVersionIds: ZodDBIDArray.optional(),
        modVersion: z.string().refine(valid, { message: `Invalid SemVer` }).optional(),
        dependencies: z.array(z.object({
            parentId: ZodDBID,
            sv: z.string().refine(validRange, { message: `Invalid SemVer` }),
        })).optional(),
        platform: ZodPlatform.optional(),
    });

    public static readonly zOAuth2Callback = z.object({
        code: z.string(),
        state: z.string()
    }).required();

    public static readonly zGetMods = z.object({
        gameName: ZodGameName.default(SupportedGames.BeatSaber),
        gameVersion: z.string().optional(),
        status: z.enum([`all`, Status.Verified, Status.Unverified, Status.Pending]).default(Status.Verified),
        platform: ZodPlatform.default(Platform.UniversalPC),
    });

    public static readonly zEditUserRoles = z.object({
        userId: ZodDBID,
        gameName: ZodGameName,
        role: this.zUserRoles
    }).strict();

    public static readonly zCreateMOTD = z.object({
        gameName: ZodGameName.default(SupportedGames.BeatSaber),
        platforms: z.array(ZodPlatform).default([Platform.UniversalPC]),
        gameVersionIds: z.array(this.zDBID).optional(),
        postType: z.nativeEnum(PostType).default(PostType.Community),
        message: z.string().min(3).max(64),
        startTime: z.coerce.date().default(new Date()),
        endTime: z.coerce.date().default(new Date(new Date().getTime() + 1000 * 60 * 60 * 24)),
    });

    public static readonly zGetMOTD = z.object({
        gameName: ZodGameName.default(SupportedGames.BeatSaber),
        gameVersion: z.string().optional(),
        platform: ZodPlatform.optional(),
        getExpired: z.boolean({coerce: true}).default(false),
    });

    public static readonly zCreateGameVersion = z.object({
        gameName: ZodGameName,
        version: z.string(),
    }).required();

    public static readonly zApproveObject = z.object({
        id: ZodDBID,
        action: z.nativeEnum(ApprovalAction),
        reason: z.string().optional(),
    }).strict();

    public static async validateIDArray(ids: number[]|undefined|null, tableName:TableNames, allowEmpty: boolean = false, allowNull = true): Promise<boolean> {
        if (!Array.isArray(ids) && allowNull === false) {
            return false;
        }

        // this is true since we've already passed the first check, and we want to allow null
        if (ids === undefined || ids === null) {
            return true;
        }

        if (ids.length == 0 && allowEmpty !== true) {
            return false;
        }

        if (ids.every(id => Validator.zDBID.safeParse(id).success) == false) {
            return false;
        }

        let records: Project[]|Version[]|User[]|GameVersion[]|EditQueue[] = [];
        switch (tableName) {
            case `mods`:
                records = await DatabaseHelper.database.Projects.findAll({ where: { id: ids } });
                break;
            case `modVersions`:
                records = await DatabaseHelper.database.Versions.findAll({ where: { id: ids } });
                break;
            case `users`:
                records = await DatabaseHelper.database.Users.findAll({ where: { id: ids } });
                break;
            case `gameVersions`:
                records = await DatabaseHelper.database.GameVersions.findAll({ where: { id: ids } });
                break;
            case `editQueue`:
                records = await DatabaseHelper.database.EditApprovalQueue.findAll({ where: { id: ids } });
                break;
            default:
                return false;
        }

        if (records.length != ids.length) {
            return false;
        }

        return true;
    }
}

type TableNames = `mods` | `modVersions` | `users` | `gameVersions` | `editQueue`;