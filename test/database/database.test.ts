import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import { DatabaseManager, UserRoles } from '../../src/shared/Database.ts';

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
        expect(db.Users.getTableName()).toBe(`users`);
        expect(db.Versions).toBeDefined();
        expect(db.Versions.getTableName()).toBe(`modVersions`);
        expect(db.Projects).toBeDefined();
        expect(db.Projects.getTableName()).toBe(`mods`);
        expect(db.GameVersions).toBeDefined();
        expect(db.GameVersions.getTableName()).toBe(`gameVersions`);
        expect(db.EditApprovalQueue).toBeDefined();
        expect(db.EditApprovalQueue.getTableName()).toBe(`editApprovalQueues`);
        expect(db.MOTDs).toBeDefined();
        expect(db.MOTDs.getTableName()).toBe(`motds`);
    });

    test(`should have a server admin user`, async () => {
        expect(await db.Users.findOne({ where: { id: 1 } })).not.toBeNull();

        expect(db.serverAdmin).toBeDefined();
        expect(db.serverAdmin.id).toBe(1);
    });

    test(`should have a server admin user with the correct roles`, async () => {
        expect(db.serverAdmin.roles.sitewide).toContain(UserRoles.AllPermissions);
    });


});