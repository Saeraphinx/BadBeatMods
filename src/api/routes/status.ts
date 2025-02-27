import { Router } from 'express';
import swaggerDocument from '../../api/swagger.json' assert { type: 'json'};
import * as fs from 'fs';
import { validateSession } from '../../shared/AuthHelper.js';
import { User } from 'src/shared/Database.js';

export class StatusRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/status`, async (req, res) => {
            // #swagger.ignore = true
            let session = await validateSession(req, res, false, null, false);
            let response = this.generateStatusResponse(session.user);
            return res.status(200).send(response);
        });

        this.router.get(`/bbmStatusForBbmAlsoPinkEraAndLillieAreCuteBtwWilliamGay`, async (req, res) => {
            //#swagger.tags = ['Status']
            //#swagger.summary = 'Get API status.'
            //#swagger.description = 'Get API status.'
            /*
            #swagger.responses[200] = {
                description: 'Returns API status.',
                schema: { $ref: '#/components/schemas/APIStatus' }
            }
            */
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            //#swagger.responses[500] = { description: 'Internal server error.', schema: { message: 'Internal server error.' } }

            let session = await validateSession(req, res, false, null, false);
            let response = this.generateStatusResponse(session.user);
            return res.status(200).send(response);
        });
    }

    private generateStatusResponse(user: User | null) {
        let gitVersion = `Version not found.`;
        let apiVersion = `Version not found.`;
        if (fs.existsSync(`.git/HEAD`) || process.env.GIT_VERSION) {
            if (process.env.GIT_VERSION) {
                gitVersion = `${process.env.GIT_VERSION.substring(0, 7)}`;
            } else {
                let gitId = fs.readFileSync(`.git/HEAD`, `utf8`);
                if (gitId.indexOf(`:`) !== -1) {
                    let refPath = `.git/` + gitId.substring(5).trim();
                    gitId = fs.readFileSync(refPath, `utf8`);
                }

                gitVersion = `${gitId.substring(0, 7)}`;
            }
        }

        if (swaggerDocument?.info?.version) {
            apiVersion = `${swaggerDocument.info.version}`;
        }

        let message = `API is running.`;
        if (user) {
            message = `hey ${user.username}`;
        }

        return {
            message: message,
            veryImportantMessage: `pink cute, era cute, lillie cute, william gay`,
            apiVersion: apiVersion,
            gitVersion: gitVersion,
            gitRepo: process.env.GIT_REPO,
            isDocker: process.env.IS_DOCKER === `true`,
        };
    }
}