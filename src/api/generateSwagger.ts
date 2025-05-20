// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { Categories, Platform, Status, UserRoles } from '../shared/Database.ts';
import swaggerAutogen from 'swagger-autogen';
import { OpenAPIV3_1 } from 'openapi-types';
import { ApprovalAction } from './routes/approval.ts';
type SchemaObject = OpenAPIV3_1.SchemaObject;

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
};
const ProjectDBObject: OpenAPIV3_1.SchemaObject = {
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
            example: `This is an example mod. It is used as an example for the API documentation.`
        },
        gameName: {
            type: `string`,
            description: `The name of the game this mod is for. Must be a game that is returned by the /games endpoint.`,
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
            description: `The IDs of the authors of this mod. This id can be resolved to a user object using the /users/{id} endpoint.`,
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
        statusHistory: {
            type: `array`,
            items: {
                type: `object`,
                properties: {
                    status: {
                        type: `string`,
                        enum: Object.values(Status),
                    },
                    reason: {
                        type: `string`,
                        description: `The reason for the status change. This is used to track the history of the mod's status.`,
                        example: `This mod is currently in development.`,
                    },
                    userId: {
                        type: `integer`,
                        description: `The ID of the user who changed the status.`,
                        example: 1,
                    },
                    setAt: {
                        type: `string`,
                        description: `The date the status was changed.`,
                        example: `2023-10-01T00:00:00.000Z`,
                    },
                }
            },
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
const VersionDBObject: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        projectId: {
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
            description: `The ID of the user who uploaded/authored this version.`
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
            items: {
                type: `object`,
                properties: {
                    parentId: {
                        type: `integer`,
                        description: `The ID of the mod this version depends on.`
                    },
                    sv: {
                        type: `string`,
                        description: `The comapre version string. This is used to identify the version of the mod. This must be SemVer compliant.`,
                        example: `^1.0.0`
                    }
                },
            },
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
                    ...VersionDBObject.properties!.modVersion,
                    default: undefined
                },
                platform: VersionDBObject.properties!.platform,
                dependnecies: VersionDBObject.properties!.dependencies,
                supportedGameVersionIds: VersionDBObject.properties!.supportedGameVersionIds,

                name: ProjectDBObject.properties!.name,
                summary: ProjectDBObject.properties!.summary,
                description: ProjectDBObject.properties!.description,
                gameName: ProjectDBObject.properties!.gameName,
                category: ProjectDBObject.properties!.category,
                authorIds: ProjectDBObject.properties!.authorIds,
                gitUrl: ProjectDBObject.properties!.gitUrl,
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
// #region DB API Public Schemas
const UserAPIPublicResponse: OpenAPIV3_1.SchemaObject = UserDBObject;
const GameVersionAPIPublicResponse: OpenAPIV3_1.SchemaObject = GameVersionDBObject;
const ProjectAPIPublicResponse: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        id: ProjectDBObject.properties!.id,
        name: ProjectDBObject.properties!.name,
        summary: ProjectDBObject.properties!.summary,
        description: ProjectDBObject.properties!.description,
        gameName: ProjectDBObject.properties!.gameName,
        category: ProjectDBObject.properties!.category,
        authors: {
            type: `array`,
            items: { allOf: [{ $ref: `#/components/schemas/UserAPIPublicResponse` }] },
        },
        status: ProjectDBObject.properties!.status,
        iconFileName: ProjectDBObject.properties!.iconFileName,
        gitUrl: ProjectDBObject.properties!.gitUrl,
        statusHistory: ProjectDBObject.properties!.statusHistory,
        lastApprovedById: ProjectDBObject.properties!.lastApprovedById,
        lastUpdatedById: ProjectDBObject.properties!.lastUpdatedById,
        createdAt: ProjectDBObject.properties!.createdAt,
        updatedAt: ProjectDBObject.properties!.updatedAt,
    }
};
const VersionAPIPublicResponse: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        id: VersionDBObject.properties!.id,
        projectId: VersionDBObject.properties!.projectId,
        modVersion: VersionDBObject.properties!.modVersion,
        author: {
            $ref: `#/components/schemas/UserAPIPublicResponse`
        },
        platform: VersionDBObject.properties!.platform,
        zipHash: VersionDBObject.properties!.zipHash,
        contentHashes: VersionDBObject.properties!.contentHashes,
        status: VersionDBObject.properties!.status,
        dependencies: {
            type: `array`,
            items: {
                type: `number`,
            }
        },
        supportedGameVersions: {
            type: `array`,
            items: { allOf: [{ $ref: `#/components/schemas/GameVersionAPIPublicResponse` }] },
        },
        downloadCount: VersionDBObject.properties!.downloadCount,
        createdAt: VersionDBObject.properties!.createdAt,
        updatedAt: VersionDBObject.properties!.updatedAt
    },
};
// #endregion
// #region General API Schemas
const APIStatus: OpenAPIV3_1.SchemaObject = {
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
// #region Validator Object Schemas
const zCreateProject: SchemaObject = {
    type: `object`,
    properties: {
        name: ProjectDBObject.properties!.name,
        summary: ProjectDBObject.properties!.summary,
        description: ProjectDBObject.properties!.description,
        category: ProjectDBObject.properties!.category,
        gitUrl: ProjectDBObject.properties!.gitUrl,
        gameName: ProjectDBObject.properties!.gameName,
    }
};

const zCreateVersion: SchemaObject = {
    type: `object`,
    properties: {
        supportedGameVersionIds: VersionDBObject.properties!.supportedGameVersionIds,
        modVersion: VersionDBObject.properties!.modVersion,
        dependencies: VersionDBObject.properties!.dependencies,
        platform: VersionDBObject.properties!.platform,
    }
}

const zUpdateProject: SchemaObject = {
    type: `object`,
    properties: {
        name: ProjectDBObject.properties!.name,
        summary: ProjectDBObject.properties!.summary,
        description: ProjectDBObject.properties!.description,
        category: ProjectDBObject.properties!.category,
        gitUrl: ProjectDBObject.properties!.gitUrl,
        gameName: ProjectDBObject.properties!.gameName,
        authorIds: ProjectDBObject.properties!.authorIds,
    }
};

const zUpdateVersion: SchemaObject = {
    type: `object`,
    properties: {
        supportedGameVersionIds: VersionDBObject.properties!.supportedGameVersionIds,
        modVersion: VersionDBObject.properties!.modVersion,
        dependencies: VersionDBObject.properties!.dependencies,
        platform: VersionDBObject.properties!.platform,
    }
};
const zUpdateUserRoles: SchemaObject = {
    type: `object`,
    properties: {
        userId: UserDBObject.properties!.id,
        gameName: GameVersionDBObject.properties!.gameName,
        role: {
            type: `string`,
            enum: Object.values(UserRoles),
        }
    }
};
const zOAuth2Callback: SchemaObject = {
    type: `object`,
    properties: {
        code: {
            type: `string`,
            description: `The code returned from GitHub.`,
            example: `1234567890abcdef`
        },
        state: {
            type: `string`,
            description: `The state returned from GitHub.`,
            example: `1234567890abcdef`
        }
    }
};
const zApproveObject: SchemaObject = {
    type: `object`,
    required: [`action`],
    properties: {
        action: {
            type: `string`,
            enum: Object.values(ApprovalAction),
            description: `The action to take.`
        },
        reason: {
            type: `string`,
            description: `The reason for the action.`,
        },
    }
}
const ProjectVersionPair: OpenAPIV3_1.SchemaObject = {
    type: `object`,
    properties: {
        project: {
            $ref: `#/components/schemas/ProjectAPIPublicResponse`
        },
        version: {
            $ref: `#/components/schemas/VersionAPIPublicResponse`,
        }
    }
}
// #endregion
// #region Full API Responses
const ServerMessageResponse: OpenAPIV3_1.ResponseObject = {
    description: `A simple message from the server. Indicates anything from a successful operation to an error message. Most, if not all, endpoints will return this in the event of an error.`,
    content: {
        [`application/json`]: {
            schema: {
                $ref: `#/components/schemas/ServerMessage`
            }
        }
    }
};

const ServerMessageResponseWithErrorStringArray: OpenAPIV3_1.ResponseObject = {
    description: `A simple message from the server. Indicates anything from a successful operation to an error message. Most, if not all, endpoints will return this in the event of an error.`,
    content: {
        [`application/json`]: {
            schema: {
                type: `object`,
                additionalProperties: true,
                properties: {
                    message: {
                        type: `string`,
                        description: `The message to be displayed.`,
                    },
                    errors: {
                        type: `array`,
                        items: { type: `string` },
                        description: `An array of error messages.`
                    }
                }
            }
        }
    }
};

const ApprovalQueueResponse: OpenAPIV3_1.ResponseObject = {
    description: `A list of items in the approval queue.`,
    content: {
        [`application/json`]: {
            schema: {
                type: `object`,
                minProperties: 1,
                maxProperties: 1,
                properties: {
                    projects: {
                        type: `array`,
                        items: {
                            $ref: `#/components/schemas/ProjectAPIPublicResponse`
                        }
                    },
                    versions: {
                        type: `array`,
                        items: {
                            type: `object`,
                            properties: {
                                project: {
                                    $ref: `#/components/schemas/ProjectAPIPublicResponse`
                                },
                                version: {
                                    $ref: `#/components/schemas/VersionDBObject`
                                }
                            }
                        }
                    },
                    edits: {
                        type: `array`,
                        items: {
                            type: `object`,
                            properties: {
                                project: {
                                    '$ref': `#/components/schemas/ProjectAPIPublicResponse`
                                },
                                original: {
                                    '$ref': `#/components/schemas/VersionDBObject`
                                },
                                edit: {
                                    '$ref': `#/components/schemas/EditApprovalQueueDBObject`
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

const UserResponse: OpenAPIV3_1.ResponseObject = {
    description: `Returns user information.`,
    content: {
        [`application/json`]: {
            schema: {
                $ref: `#/components/schemas/UserAPIPublicResponse`
            }
        }
    }
};

const ProjectVersionPairResponse: OpenAPIV3_1.ResponseObject = {
    description: `Returns a project and version pair (e.g. a mod).`,
    content: {
        [`application/json`]: {
            schema: {
                $ref: `#/components/schemas/ProjectVersionPair`
            }
        }
    }
};
// #endregion
// #region Full API Request Bodies
const ApproveObjectBody: OpenAPIV3_1.RequestBodyObject = {
    description: ``,
    content: {
        [`application/json`]: {
            schema: {
                $ref: `#/components/schemas/zApproveObject`
            }
        }
    }
};
// #endregion
const doc = {
    info: {
        title: `BadBeatMods API`,
        description: `This isn't really fully complete, but its better than absolutely nothing.\n\nThis API documentation is automatically generated and therefor may not be 100% accurate and may be missing a few fields. For example, request bodies are not fully fleshed out, and may not be accurate. Full documentation is still currently a work in progress.\n\nAll errors that originate from the server will have a \`message\` field. Errors that come from input validation will sometimes also have an \`errors\` field. This has been omiitted from the documentation of most endpoints for brevity. These follow the \`ServerMessage\` schema.`,
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
            ProjectVersionPair: ProjectVersionPair,
            ProjectAPIPublicResponse,
            VersionAPIPublicResponse,
            UserAPIPublicResponse,
            GameVersionAPIPublicResponse,
            APIStatus,
            zCreateProject,
            zCreateVersion,
            zUpdateProject,
            zUpdateVersion,
            zOAuth2Callback,
            zUpdateUserRoles,
            zApproveObject: zApproveObject,
            VersionDBObject,
            EditApprovalQueueDBObject,
            ServerMessage
        },
        "responses": {
            ServerMessage: ServerMessageResponse,
            ServerMessageWithErrorStringArray: ServerMessageResponseWithErrorStringArray,
            ApprovalQueueResponse: ApprovalQueueResponse,
            UserResponse: UserResponse,
            ProjectVersionPairResponse: ProjectVersionPairResponse,
        },
        "requestBodies": {
            ApproveObjectBody: ApproveObjectBody,
        }
    }
};

const outputFile = `./swagger_full.json`;
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
    `./routes/apistatus.ts`,
    `./routes/bulkActions.ts`,
];

swaggerAutogen(options)(outputFile, routes, doc);