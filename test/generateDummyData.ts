import { SemVer } from "semver";
import { Categories, ContentHash, GameVersionInfer, ModInfer, ModVersionInfer, Platform, Status, SupportedGames, UserInfer, UserRoles } from "../src/shared/Database";
import {faker} from "@faker-js/faker";
import * as fs from 'fs';

let fakeGameVersionData: GameVersionInfer[] = [];
let fakeUserData: UserInfer[] = [];
let fakeProjectData: ModInfer[] = [];
let fakeVersionData: ModVersionInfer[] = [];

for (let i = 0; i < 100; i++) {
    let fakeGameName = faker.helpers.arrayElement(Object.values(SupportedGames)) as SupportedGames;
    let shouldSetDefault = fakeGameVersionData.find((gameVersion) => gameVersion.gameName == fakeGameName) == null;
    fakeGameVersionData.push({
        id: i + 1,
        gameName: faker.helpers.arrayElement(Object.values(SupportedGames)) as SupportedGames,
        version: new SemVer(faker.system.semver()).raw,
        defaultVersion: shouldSetDefault,
        createdAt: faker.date.past(),
        updatedAt: faker.date.recent(),
        deletedAt: /*faker.datatype.boolean() ? faker.date.recent() :*/ null
    });

    fakeUserData.push({
        id: i + 2, // start at 2 to avoid conflicts with the server admin user
        username: faker.internet.username(),
        githubId: faker.number.int({ min: 100, max: 100000 }).toString(),
        discordId: faker.datatype.boolean() ? faker.number.bigInt({ min: 10000000000000000n, max: 999999999999999999n }).toString() : null,
        sponsorUrl: faker.datatype.boolean() ? faker.internet.url() : null,
        displayName: faker.internet.displayName(),
        bio: faker.lorem.paragraph(),
        roles: {
            sitewide: faker.helpers.arrayElements(Object.values(UserRoles), faker.number.int({ min: 0, max: Object.values(UserRoles).length - 1 })),
            perGame: Object.values(SupportedGames).reduce((acc, game) => {
                faker.datatype.boolean() ? acc[game] = faker.helpers.arrayElements(Object.values(UserRoles), faker.number.int({ min: 0, max: Object.values(UserRoles).length - 1 })) : undefined;
                return acc;
            }, {} as Record<SupportedGames, UserRoles[]>)
        },
        createdAt: faker.date.past(),
        updatedAt: faker.date.recent(),
        deletedAt: /*faker.datatype.boolean() ? faker.date.recent() :*/ null
    });
}

for (let i = 0; i < 200; i++) {
    fakeProjectData.push({
        id: i + 1,
        name: `${faker.hacker.noun()} ${faker.hacker.adjective()}`,
        description: faker.lorem.paragraph(),
        category: Categories.Core,
        authorIds: [faker.number.int({ min: 1, max: 100 })],
        gameName: faker.helpers.arrayElement(Object.values(SupportedGames)) as SupportedGames,
        status: faker.helpers.arrayElement(getEnumValues(Status)) as Status,
        gitUrl: faker.internet.url(),
        iconFileName: `${faker.git.commitSha()}.${faker.helpers.arrayElement([`png`, `jpg`, `jpeg`, `webp`])}`,
        lastApprovedById: faker.number.int({ min: 1, max: 100 }),
        lastUpdatedById: faker.number.int({ min: 1, max: 100 }),
        createdAt: faker.date.past(),
        updatedAt: faker.date.recent(),
        summary: faker.lorem.sentence(),
        deletedAt: /*faker.datatype.boolean() ? faker.date.recent() :*/ null
    });
}

for (let mod of fakeProjectData) {
    for (let i = 0; i < faker.number.int({ min: 0, max: 50 }); i++) {
        let contentHashes: ContentHash[] = [];
        for (let j = 0; j < faker.number.int({ min: 1, max: 10 }); j++) {
            contentHashes.push({
                hash: faker.git.commitSha(),
                // this intentionally only removes the first character of the path
                path: faker.system.filePath().replace(`/`, ``)
            });
        }

        let deps: number[] = [];
        for (let j = 0; j < faker.number.int({ min: 0, max: 10 }); j++) {
            let genDep = faker.helpers.arrayElements(fakeVersionData, faker.number.int({ min: 0, max: 10 }));
            genDep.filter((dep) => dep.modId != mod.id).forEach((dep) => {
                deps.push(dep.id);
            });
        }

        let validGameVersions = fakeGameVersionData.filter((gameVersion) => gameVersion.gameName == mod.gameName);


        fakeVersionData.push({
            id: i + 1,
            modId: mod.id,
            modVersion: new SemVer(faker.system.semver()),
            status: faker.helpers.arrayElement(getEnumValues(Status)) as Status,
            contentHashes: contentHashes,
            authorId: faker.helpers.arrayElement(mod.authorIds),
            downloadCount: faker.number.int({ min: 0, max: 1000 }),
            fileSize: faker.number.int({ min: 0, max: 100000000 }),
            platform: faker.helpers.arrayElement(Object.values(Platform)),
            zipHash: faker.git.commitSha(),
            lastApprovedById: faker.number.int({ min: 1, max: 100 }),
            lastUpdatedById: faker.number.int({ min: 1, max: 100 }),
            dependencies: [...new Set(deps)],
            supportedGameVersionIds: [...new Set(faker.helpers.arrayElements(validGameVersions, faker.number.int({ min: 0, max: validGameVersions.length - 1 })).map((gameVersion) => gameVersion.id))],
            createdAt: faker.date.past(),
            updatedAt: faker.date.recent(),
            deletedAt: /*faker.datatype.boolean() ? faker.date.recent() :*/ null
        });
    }
}

function getEnumValues(enumType: any): string[] {
    return Object.values(enumType);
}

let fakeData = {
    gameVersions: fakeGameVersionData,
    users: fakeUserData,
    projects: fakeProjectData,
    versions: fakeVersionData
};

fs.writeFileSync(`test/fakeData.json`, JSON.stringify(fakeData), {});
// eslint-disable-next-line no-console
console.log(`Generated fake data and saved to fakeData.json`);