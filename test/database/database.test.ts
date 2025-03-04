import { describe } from 'node:test';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../../src/shared/Database.ts';

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

    test(`should load models`, async () => {
        expect(db.Users).toBeDefined();
        expect(db.ModVersions).toBeDefined();
        expect(db.Mods).toBeDefined();
        expect(db.GameVersions).toBeDefined();
        expect(db.EditApprovalQueue).toBeDefined();
        expect(db.MOTDs).toBeDefined();
    });

    test(`should have a server admin user`, async () => {
        expect(await db.Users.findOne({ where: { id: 1 } })).toBeDefined();

        expect(db.serverAdmin).toBeDefined();
        expect(db.serverAdmin.id).toBe(1);
    });
});