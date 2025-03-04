import { describe } from 'node:test';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager, GameVersion, SupportedGames, User } from '../../src/shared/Database.ts';
// eslint-disable-next-line quotes
import { users } from '../fakeData.json' with { type: 'json' };

describe(`Users`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();

        let promises: Promise<User>[] = [];
        for (let user of users) {
            promises.push(db.Users.create({
                ...user,
                createdAt: new Date(user.createdAt),
                updatedAt: new Date(user.updatedAt),
            }));
        }

    });

    afterAll(async () => {
        await db.sequelize.close();
    });
});