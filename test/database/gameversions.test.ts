import { describe } from 'node:test';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../../src/shared/Database';

describe(`Database Initialization`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    test(`should connect to the database`, async () => {
        expect(await db.sequelize.authenticate()).toBe(undefined);
    });
});