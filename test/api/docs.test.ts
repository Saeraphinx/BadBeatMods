import { test, expect, describe, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { startServer } from '../../src/index.ts';
import { DatabaseHelper, EditQueue, GameVersionInfer, GameWebhookConfig, Platform, Project, ProjectAPIPublicResponse, ProjectInfer, Status, SupportedGames, User, UserInfer, UserRoles, Version, VersionAPIPublicResponse, VersionInfer } from '../../src/shared/Database.ts';
import Ajv from "ajv";
const ajv = new Ajv({strict: false})
// #region setup
const api = supertest(`http://localhost:8488/api`);
let server: Awaited<ReturnType<typeof startServer>>;
let shouldAuthenticateWithRole: UserRoles | false | true = false;

// eslint-disable-next-line quotes
import * as fakeData from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';
import { ApprovalAction } from '../../src/api/routes/approval.ts';
import { fakerPL } from '@faker-js/faker';

let gameVersions: GameVersionInfer[] = [];
for (let gv of fakeData.gameVersions) {
    gameVersions.push({
        ...gv,
        gameName: gv.gameName as SupportedGames,
        createdAt: new Date(gv.createdAt),
        updatedAt: new Date(gv.updatedAt),
        linkedVersionIds: [],
    });
}

let users: UserInfer[] = [];
for (let user of fakeData.users) {
    users.push({
        ...user,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
    });
}

let projects: ProjectInfer[] = [];
for (let project of fakeData.projects) {
    projects.push({
        ...project,
        gameName: project.gameName as SupportedGames,
        category: project.category,
        status: project.status as Status,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
    });
}

let versions: VersionInfer[] = [];
for (let version of fakeData.versions) {
    versions.push({
        ...version,
        modVersion: new SemVer(version.modVersion.raw),
        platform: version.platform as Platform,
        status: version.status as Status,
        createdAt: new Date(version.createdAt),
        updatedAt: new Date(version.updatedAt),
    });
}

type ProjectVersionPair = {
    project: ProjectAPIPublicResponse;
    version: VersionAPIPublicResponse;
};

vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType, reason?:string) => {}),
        sendVersionLog: vi.fn(async (version: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?:string) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
    };
});
// #endregion

// #region schemas
import jsondocs from '../../src/api/swagger_full.json';
import $RefParser from "@apidevtools/json-schema-ref-parser";
const derefSchema = await $RefParser.dereference(jsondocs, { mutateInputSchema: false }) as typeof jsondocs;
//console.log(`Deref schema`, derefSchema.components.responses.UserResponse.content['application/json'].schema);
for (let pathName in derefSchema.paths) {
    for (let method in derefSchema.paths[pathName]) {
        if (derefSchema.paths[pathName][method].responses) {
            for (let responseCode in derefSchema.paths[pathName][method].responses) {
                let response = derefSchema.paths[pathName][method].responses[responseCode];
                if (response.content?.['application/json']?.schema) {
                   ajv.addSchema(response.content['application/json'].schema, `${pathName}-${method}-${responseCode}`);
                }
            }
        }
    }
}
ajv.addSchema(derefSchema.components.schemas.ServerMessage, `ServerMessage`);
// #endregion

describe.sequential(`Documentation`, async () => {
    // #region setup 2 electric boogaloo
    let { sendProjectLog, sendEditLog, sendVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);
    let defaultModData: Omit<ProjectInfer, `id` | `name` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        // Do not mock these files for a full server run.
        vi.unmock(`../../src/shared/Logger.ts`);
        vi.unmock(`../../src/shared/Config.ts`);

        vi.mock(`../../src/shared/AuthHelper.ts`, () => ({
            validateSession: async (req: any, res: any, role: UserRoles | boolean = UserRoles.Admin, gameName: SupportedGames | null | boolean = null, handleRequest: boolean = true) => {
                let admin = await server.database.Users.findByPk(1);
                if (typeof shouldAuthenticateWithRole == `string`) {
                    return {
                        user: {
                            ...admin,
                            id: 1,
                            roles: {
                                sitewide: [shouldAuthenticateWithRole],
                                perGame: {},
                            }
                        }
                    };
                } else if (shouldAuthenticateWithRole) {
                    return { user: admin };
                } else {
                    if (handleRequest) {
                        res.status(401).send({ message: `Unauthorized.` });
                    }
                    return { user: null };
                }
            }
        }));

        vi.mock(`../../src/shared/Config.ts`, async (importOriginal) => {
            const originalModule = await importOriginal() as typeof import('../../src/shared/Config.ts');
            process.env.NODE_ENV = `test`;
            return {
                Config: {
                    ...originalModule.DEFAULT_CONFIG,
                    database: {
                        ...originalModule.DEFAULT_CONFIG.database,
                        url: `:memory:`,
                    },
                    server: {
                        ...originalModule.DEFAULT_CONFIG.server,
                        port: 8488,
                        url: `http://localhost:8486`,
                        sessionSecret: `secret`
                    }
                }
            };
        });

        vi.mock(import (`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
            const actual = await importOriginal();
            return {
                ...actual,
                sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType) => {}),
                sendVersionLog: vi.fn(async (version: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project) => {}),
                sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
            };
        });

        process.env.NODE_ENV = `test`;
        server = await startServer();
        await server.database.Games.bulkCreate(fakeData.games.map(game => {
            return {
                ...game,
                webhookConfig: game.webhookConfig as GameWebhookConfig[],
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
            };
        }), { individualHooks: true });
        await DatabaseHelper.refreshCache(`games`);
        await server.database.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await server.database.Projects.bulkCreate(projects, { individualHooks: true });
        await server.database.Versions.bulkCreate(versions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
        //console.log(JSON.stringify(server.database.serverAdmin));
        defaultModData = {
            authorIds: [1],
            category: `Core`,
            description: `Test Description`,
            gameName: `BeatSaber`,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            statusHistory: [],
            lastUpdatedById: 1,
            status: Status.Private,
            summary: `Test Summary`,
        };
    });

    afterAll(async () => {
        // wait a few seconds for the server to finish processing requests that request a cache refresh
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await server.stopServer(false);
    });

    beforeEach(() => {
        shouldAuthenticateWithRole = false;
    });
    // #endregion

    describe(`GET No Params`, () => {
        test.each([
            [`/bbmStatusForBbmAlsoPinkEraAndLillieAreCuteBtwWilliamGay`, 200],
            [`/projects`, 200],
            [`/projects/1`, 200, `/projects/{projectIdParam}`],
            [`/user`, 200],
            [`/user/1`, 200, `/user/{id}`],
            [`/user/1/projects`, 200, `/user/{id}/projects`],
            [`/users`, 200],
            [`/auth`, 200],
            [`/games`, 200],
            //[`/games`, 200],
            //[`/versions`, 200],
            //[`/edits`, 200],
            //[`/edits/1`, 200, `/edits/{editIdParam}`],
        ])(`%s %s follows schema`, async (path, status, schema?) => {
            shouldAuthenticateWithRole = true;
            let response = await api.get(path);
            validateResponse(response, schema ? `${schema}-get-${status}` : `${path}-get-${status}`, status);
        });
    });
});

function validateResponse(res:supertest.Response, schema: string, code:number = 200) {
    expect(res).not.toBeNull();
    expect(res.status, res.body?.message).toBe(code);
    let validate = ajv.validate(schema, res.body);
    expect(validate, ajv.errorsText(ajv.errors, { separator: `\n` })).toBe(true);
}