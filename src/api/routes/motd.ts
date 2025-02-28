import { Router } from 'express';
import { DatabaseHelper, MOTD, SupportedGames, UserRoles } from '../../shared/Database';
import { validateSession } from '../../shared/AuthHelper';
import { Validator } from '../../shared/Validator';

export class MOTDRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/motd`, async (req, res) => {
            // #swagger.tags = ['MOTD']
            let reqQuery = Validator.zGetMOTD.safeParse(req.query.gameName);
            if (!reqQuery.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqQuery.error.issues });
            }

            let gameVersionObj = DatabaseHelper.cache.gameVersions.find(gV => gV.gameName === reqQuery.data.gameName && gV.version === reqQuery.data.gameVersion);
            if (!gameVersionObj) {
                return res.status(400).send({ message: `Invalid game version.` });
            }

            let motds = await MOTD.getActiveMOTDs(reqQuery.data.gameName, [gameVersionObj.id], reqQuery.data.platform, reqQuery.data.getExpired);
            return res.status(200).send({ messages: motds });
        });

        this.router.post(`/motd`, async (req, res) => {
            // #swagger.tags = ['MOTD']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let reqBody = Validator.zCreateMOTD.safeParse(req.body);
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }

            let session = await validateSession(req, res, UserRoles.Poster, reqBody.data.gameName);
            if (!session.user) {
                return;
            }

            let motd = DatabaseHelper.database.MOTDs.create({
                gameName: reqBody.data.gameName || SupportedGames.BeatSaber,
                gameVersionIds: reqBody.data.gameVersionIds || null,
                message: reqBody.data.message,
                platforms: reqBody.data.platforms || null,
                postType: reqBody.data.postType,
                translations: [],
                authorId: session.user.id,
                startTime: reqBody.data.startTime,
                endTime: reqBody.data.endTime,
            });

            return res.status(200).send({ message: `MOTD added.`, motd });
        });

        this.router.delete(`/motd/:id`, async (req, res) => {
            // #swagger.tags = ['MOTD']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let id = Validator.zDBID.safeParse(req.params.id);
            if (!id.success) {
                return res.status(400).send({ message: `Invalid ID.` });
            }
            let motd = await DatabaseHelper.database.MOTDs.findOne({ where: { id: id.data } });
            if (!motd) {
                return res.status(404).send({ message: `MOTD not found.` });
            }

            let session = await validateSession(req, res, UserRoles.Poster, motd.gameName);
            if (!session.user) {
                return;
            }

            motd.destroy();
            return res.status(200).send({ message: `MOTD deleted.` });
        });
    }
}