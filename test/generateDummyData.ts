import { SemVer } from "semver";
import { ContentHash, GameVersionInfer, Platform, ProjectInfer, Status, SupportedGames, UserInfer, UserRoles, VersionInfer, GameInfer } from "../src/shared/Database";
import {de, faker} from "@faker-js/faker";
import * as fs from 'fs';

let fakeGameVersionData: GameVersionInfer[] = [];
let fakeUserData: UserInfer[] = [];
let fakeProjectData: ProjectInfer[] = [];
let fakeVersionData: VersionInfer[] = [];
let fakeGameData: GameInfer[] = [
    {
        name: `BeatSaber`,
        displayName: `Game 1`,
        categories: [`cat1`, `cat2`],
        webhookConfig: [],
        default: true,
        createdAt: faker.date.recent(),
        updatedAt: faker.date.recent(),
        deletedAt: null
    }, {
        name: `Chromapper`,
        displayName: `Game 2`,
        categories: [`cat1`, `cat3`],
        webhookConfig: [],
        default: false,
        createdAt: faker.date.recent(),
        updatedAt: faker.date.recent(),
        deletedAt: null
    }, {
        name: `gn3`,
        displayName: `Game 3`,
        categories: [`cat2`, `cat3`],
        webhookConfig: [],
        default: false,
        createdAt: faker.date.recent(),
        updatedAt: faker.date.recent(),
        deletedAt: null
    }
]
let gvid = 1;
for (let game of fakeGameData) {
    for (let i = 1; i < 10; i++) {
        fakeGameVersionData.push({
            id: gvid++,
            gameName: game.name,
            version: `${i}.0.0`,
            defaultVersion: false,
            linkedVersionIds: [],
            createdAt: faker.date.recent(),
            updatedAt: faker.date.recent(),
            deletedAt: null
        });
    }
}
for (let i = 2; i < 50; i++) {
    fakeUserData.push({
        id: i,
        username: `testuser`,
        bio: `This is a test bio`,
        sponsorUrl: `https://example.com`,
        discordId: null,
        displayName: `Test User`,
        githubId: faker.number.int().toString(),
        roles: {
            sitewide: [],
            perGame: {}
        },
        createdAt: faker.date.recent(),
        updatedAt: faker.date.recent(),
        deletedAt: null
    });
}

let i = 1;
for (let i = 1; i < 5; i++) {
    for (let status of getEnumValues(Status)) {
        for (let game of fakeGameData) {
            fakeProjectData.push({
                id: i++,
                gameName: game.name,
                name: faker.commerce.productName(),
                description: faker.commerce.productDescription(),
                category: faker.helpers.arrayElement(game.categories),
                status: status as Status,
                authorIds: [2],
                summary: faker.lorem.sentence(),
                gitUrl: ``,
                iconFileName: `default.png`,
                lastApprovedById: status == Status.Verified ? 1 : null,
                lastUpdatedById: 2,
                statusHistory: [],
                createdAt: faker.date.recent(),
                updatedAt: faker.date.recent(),
                deletedAt: null
            });
        }
    }
}
let j = 1;
for (let project of fakeProjectData) {
    for (let platform of getEnumValues(Platform)) {
        let availableGameVersions = fakeGameVersionData.filter((version) => version.gameName == project.gameName);
        let contentHashes: ContentHash[] = [];
        for (let i = 0; i < faker.number.int({min: 1, max: 5}); i++) {
            contentHashes.push({
                path: faker.system.filePath(),
                hash: faker.string.hexadecimal({length: 64, casing: `lower`, prefix: ``}),
            });
        }

        fakeVersionData.push({
            id: j++,
            projectId: project.id,
            modVersion: new SemVer(`1.0.0`),
            platform: platform as Platform,
            status: project.status,
            contentHashes: contentHashes,
            supportedGameVersionIds: availableGameVersions.map((version) => version.id),
            authorId: 1,
            dependencies: [],
            downloadCount: 0,
            fileSize: 0,
            lastApprovedById: null,
            lastUpdatedById: 1,
            statusHistory: [],
            zipHash: faker.string.alphanumeric(24),
            createdAt: faker.date.recent(),
            updatedAt: faker.date.recent(),
            deletedAt: null
        });
    }
}

function getEnumValues(enumType: any): string[] {
    return Object.values(enumType);
}

let fakeData = {
    games: fakeGameData,
    gameVersions: fakeGameVersionData,
    users: fakeUserData,
    projects: fakeProjectData,
    versions: fakeVersionData
};

fs.writeFileSync(`test/fakeData.json`, JSON.stringify(fakeData), {});
// eslint-disable-next-line no-console
console.log(`Generated fake data and saved to fakeData.json`);