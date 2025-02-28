// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { Categories, Mod, Platform, Status, UserRoles } from '../shared/Database';
import swaggerAutogen from 'swagger-autogen';
import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

// docs: https://swagger-autogen.github.io/docs/getting-started/quick-start/
const options = {
    openapi: `3.1.0`,
    language: `en-US`,
};

// #region Raw DB Objects
const DBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        id: {
            type: `integer`,
            description: `The object's internal ID.`,
            example: 1,
            minimum: 1,

        },
        createdAt: {
            type: `string`,
            description: `The date the object was added to the database.`,
            example: `2023-10-01T00:00:00.000Z`,
        },
        updatedAt: {
            type: `string`,
            description: `The date the object was last updated.`,
            example: `2023-10-01T00:00:00.000Z`,
        },
        deletedAt: {
            type: [`string`, `null`],
            description: `The date the object was deleted from the database.`,
            example: `2023-10-01T00:00:00.000Z`,
        },
    }
}

const ModDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        name: {
            type: `string`,
            description: `The name of the mod.`,
            example: `Example Mod`
        },
        summary: {
            type: `string`,
            description: `The summary of the mod.`,
            example: `This is an example mod.`
        },
        description: {
            type: `string`,
            description: `The description of the mod. Supports markdown.`,
            example: `This is an example mod.`
        },
        gameName: {
            type: `string`,
            description: `The name of the game this mod is for. This is used to identify the game.`,
            example: `BeatSaber`,
            default: `BeatSaber`
        },
        category: {
            type: `string`,
            enum: Object.values(Categories),
        },
        authorIds: {
            type: `array`,
            items: { type: `number` },
        },
        status: {
            type: `string`,
            enum: Object.values(Status),
        },
        iconFileName: {
            type: `string`,
            default: `default.png`,
        },
        gitUrl: {
            type: `string`,
        },
        lastApprovedById: {
            type: [`integer`, `null`],
            default: null,
        },
        lastUpdatedById: {
            type: `integer`,
        },
        ...DBObject.properties
    }
};
const ModVersionDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        modId: {
            type: `integer`,
            description: `The parent mod's internal ID.`,
            example: 1
        },
        modVersion: {
            type: `string`,
            description: `The version string. This is used to identify the version of the mod. This must be SemVer compliant.`,
            example: `1.0.0`
        },
        authorId: {
            type: `integer`,
            description: `The ID of the user who authored this version.`
        },
        platform: {
            type: `string`,
            enum: Object.values(Platform),
        },
        zipHash: {
            type: `string`,
            description: `The hash of the zip file. This is used to find and download the zip file. Will be a MD5 hash.`,
            example: `34e6985de8fbf7b525fc841c2cb45786`
        },
        contentHashes: {
            type: `array`,
            items: {
                type: `object`,
                properties: {
                    path: {
                        type: `string`,
                    },
                    hash: {
                        type: `string`,
                    }
                }
            }
        },
        status: {
            type: `string`,
            enum: Object.values(Status),
        },
        dependencies: {
            type: `array`,
            items: { type: `integer`, description: `The ID of the mod version this version depends on.` },
        },
        supportedGameVersionIds: {
            type: `array`,
            items: { type: `integer`, description: `The ID of the game version this version supports.` },
        },
        downloadCount: {
            type: `integer`,
        },
        fileSize: {
            type: `integer`,
            description: `The size of the file in bytes.`,
            example: 12345678,
            default: 0,
        },
        ...DBObject.properties
    }
};
const UserDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        username: {
            type: `string`,
            description: `The user's username from GitHub.`,
            example: `saeraphinx`,
        },
        githubId: {
            type: [`integer`, `null`],
            description: `The user's GitHub ID.`,
            example: 123456789,
        },
        sponsorUrl: {
            type: [`string`, `null`],
            description: `The URL to support the user's works financially.`,
            example: `https://www.patreon.com/c/beatsabermods`,
            default: null,
        },
        displayName: {
            type: `string`,
            description: `The user's display name from GitHub. Is editable after registration, and can be different from the GitHub username/display name.`,
            example: `Saeraphinx`,
        },
        roles: {
            type: `object`,
            properties: {
                siteide: {
                    type: `array`,
                    items: { type: `string`, enum: Object.values(UserRoles) },
                    default: [],
                    example: [`admin`],
                    description: `Site-wide roles. Takes precedence over per-game roles.`
                },
                perGame: {
                    type: `object`,
                    example: {
                        "BeatSaber": [`approver`]
                    }
                }
            },
            default: {
                siteide: [],
                perGame: {}
            },
            example: {
                siteide: [`admin`],
                perGame: {
                    "BeatSaber": [`approver`]
                }
            }
        },
        bio: {
            type: `string`,
            description: `The user's bio from GitHub. Is editable after registration. Supports markdown.`,
            example: `j`
        },
        ...DBObject.properties
    }
};
const GameVersionDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        gameName: {
            type: `string`,
            description: `The name of the game this version is for. This is used to identify the game.`,
            example: `BeatSaber`
        },
        version: {
            type: `string`,
            description: `The version string. This is used to identify the version of the game.`,
            example: `1.0.0`
        },
        ...DBObject.properties
    }
};

const EditApprovalQueueDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        submitterId: {
            type: `integer`,
            description: `The ID of the user who submitted this edit.`
        },
        objectId: {
            type: `integer`,
            description: `The ID of the object being edited.`
        },
        objectTableName: {
            type: `string`,
            description: `The name of the table that objectId belongs to.`
        },
        object: {
            type: `object`,
            properties: {
                modVersion: {
                    ...ModVersionDBObject.properties!.modVersion,
                    default: undefined
                },
                platform: ModVersionDBObject.properties!.platform,
                dependnecies: ModVersionDBObject.properties!.dependencies,
                supportedGameVersionIds: ModVersionDBObject.properties!.supportedGameVersionIds,

                name: ModDBObject.properties!.name,
                summary: ModDBObject.properties!.summary,
                description: ModDBObject.properties!.description,
                gameName: ModDBObject.properties!.gameName,
                category: ModDBObject.properties!.category,
                authorIds: ModDBObject.properties!.authorIds,
                gitUrl: ModDBObject.properties!.gitUrl,
            }
        },
        approverId: {
            type: [`integer`, `null`],
            description: `The ID of the user who approved this edit.`,
            default: null,
            example: 1
        },
        approved: {
            type: [`boolean`, `null`],
            description: `Whether the edit has been approved or not.`,
            example: false,
            default: null,
        },
        ...DBObject.properties
    }
};
// #endregion
// #region API Public Responses
const UserAPIPublicResponse: OpenAPIV3_1.SchemaObject = UserDBObject;
const GameVersionAPIPublicResponse: OpenAPIV3_1.SchemaObject = GameVersionDBObject;
const ModAPIPublicResponse: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        id: ModDBObject.properties!.id,
        name: ModDBObject.properties!.name,
        summary: ModDBObject.properties!.summary,
        description: ModDBObject.properties!.description,
        gameName: ModDBObject.properties!.gameName,
        category: ModDBObject.properties!.category,
        authors: {
            type: `array`,
            items: { allOf: [{ $ref: `#/components/schemas/UserAPIPublicResponse` }] },
        },
        status: ModDBObject.properties!.status,
        iconFileName: ModDBObject.properties!.iconFileName,
        gitUrl: ModDBObject.properties!.gitUrl,
        lastApprovedById: ModDBObject.properties!.lastApprovedById,
        lastUpdatedById: ModDBObject.properties!.lastUpdatedById,
        createdAt: ModDBObject.properties!.createdAt,
        updatedAt: ModDBObject.properties!.updatedAt,
    }
};
const ModVersionAPIPublicResponse: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        id: ModVersionDBObject.properties!.id,
        modId: ModVersionDBObject.properties!.modId,
        modVersion: ModVersionDBObject.properties!.modVersion,
        author: {
            $ref: `#/components/schemas/UserAPIPublicResponse`
        },
        platform: ModVersionDBObject.properties!.platform,
        zipHash: ModVersionDBObject.properties!.zipHash,
        contentHashes: ModVersionDBObject.properties!.contentHashes,
        status: ModVersionDBObject.properties!.status,
        dependencies: ModVersionDBObject.properties!.dependencies,
        supportedGameVersions: {
            type: `array`,
            items: { allOf: [{ $ref: `#/components/schemas/GameVersionAPIPublicResponse` }] },
        },
        downloadCount: ModVersionDBObject.properties!.downloadCount,
        createdAt: ModVersionDBObject.properties!.createdAt,
        updatedAt: ModVersionDBObject.properties!.updatedAt
    },
};
// #endregion
// #region General API Responses
const APIStatus:OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        message: {
            type: `string`,
            description: `Status message.`,
            example: `API is running.`,
            default: `API is running.`
        },
        veryImportantMessage: {
            type: `string`,
            description: `Very important message.`,
            example: `pink cute, era cute, lillie cute, william gay`,
            default: `pink cute, era cute, lillie cute, william gay`
        },
        apiVersion: {
            type: `string`,
            description: `API version (as seen in documentation).`,
            example: `0.0.1`,
            default: `Version not found.`
        },
        gitVersion: {
            type: `string`,
            description: `Git commit hash.`,
            example: `3d94a00`,
            default: `Version not found.`
        },
        isDocker: {
            type: `boolean`,
            description: `Whether the API is running in Docker or not.`,
            example: true,
            default: false
        }
    }
};

const ServerMessage: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    description: `A simple message from the server. Indicates anything from a successful operation to an error message. Most, if not all, endpoints will return this in the event of an error.`,
    properties: {
        message: {
            type: `string`,
            description: `The message to be displayed.`,
        }
    },
    additionalProperties: true,
    example: {
        message: `string`
    }
};
// #endregion
// #region Edit Object Schemas
const CreateMod: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        name: ModDBObject.properties!.name,
        summary: ModDBObject.properties!.summary,
        description: ModDBObject.properties!.description,
        gameName: ModDBObject.properties!.gameName,
        category: ModDBObject.properties!.category,
        gitUrl: ModDBObject.properties!.gitUrl,
    }
};

const EditMod: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        ...CreateMod.properties!,
        authorIds: ModDBObject.properties!.authorIds,
    }
};

const CreateEditModVersion: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        modVersion: ModVersionDBObject.properties!.modVersion,
        platform: ModVersionDBObject.properties!.platform,
        dependencies: ModVersionDBObject.properties!.dependencies,
        supportedGameVersionIds: ModVersionDBObject.properties!.supportedGameVersionIds,
    }
};
// #endregion

const doc = {
    info: {
        title: `BadBeatMods API`,
        description: `This isn't really fully complete, but its better than absolutely nothing.\n\nThis API documentation is automatically generated and therefor may not be 100% accurate and may be missing a few fields. For example, request bodies are not fully fleshed out, and may not be accurate. Full documentation is still currently a work in progress.`,
        version: `0.0.1`,
    },
    servers: [
        {
            url: `https://bbm.saera.gay/api`,
        }
    ],
    //host: `bbm.saera.gay`,
    //basePath: `/`,
    //consumes: [`application/json`, `multipart/form-data`, `application/x-www-form-urlencoded`],
    //produces: [`application/json`],
    //schemes: [`https`, `http`],
    tags: [
        { name: `Status`, description: `Status related endpoints` },
        { name: `Mods`, description: `Mod related endpoints` },
        { name: `Versions`, description: `Version Management` },
        { name: `MOTD`, description: `Message of the Day related endpoints` },
        { name: `Approval`, description: `Approval related endpoints` },
        { name: `Users`, description: `User related endpoints` },
        { name: `Admin`, description: `Admin related endpoints` },
        { name: `Bulk Actions`, description: `Actions that allow you to skip calling the same endpoint over and over again` },
        { name: `Auth`, description: `Authentication related endpoints` },
        { name: `BeatMods`, description: `Legacy BeatMods API endpoints` },
    ],
    components: {
        securitySchemes: {
            cookieAuth: {
                type: `apiKey`,
                in: `cookie`,
                name: `bbm_session`,
            },
            bearerAuth: {
                type: `http`,
                scheme: `bearer`,
            }
        },
        "@schemas": {
            ModAPIPublicResponse,
            ModVersionAPIPublicResponse,
            UserAPIPublicResponse,
            GameVersionAPIPublicResponse,
            CreateEditModVersion,
            CreateMod,
            EditMod,
            APIStatus,
            ModDBObject,
            ModVersionDBObject,
            UserDBObject,
            GameVersionDBObject,
            EditApprovalQueueDBObject,
            ServerMessage
        }
    }
};

const outputFile = `./swagger.json`;
const routes = [
    `./routes/beatmods.ts`,
    `./routes/getMod.ts`,
    `./routes/createMod.ts`,
    `./routes/updateMod.ts`,
    `./routes/auth.ts`,
    `./routes/versions.ts`,
    `./routes/import.ts`,
    `./routes/admin.ts`,
    `./routes/approval.ts`,
    `./routes/motd.ts`,
    `./routes/users.ts`,
    `./routes/status.ts`,
    `./routes/bulkActions.ts`,
];

swaggerAutogen(options)(outputFile, routes, doc);