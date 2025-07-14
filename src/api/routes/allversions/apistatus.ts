import { Router } from 'express';
import { validateSession } from '../../../shared/AuthHelper.ts';
import { User } from '../../../shared/Database.ts';
import { Config } from '../../../shared/Config.ts';
import { Utils } from '../../../shared/Utils.ts';

export class StatusRoutes {
    constructor(routers: Router[]) {
        routers.forEach(r => this.loadRoutes(r));
    }

    private async loadRoutes(router: Router) {
        router.get(`/status`, async (req, res) => {
            // #swagger.ignore = true
            let session = await validateSession(req, res, false, null, false);
            let response = this.generateStatusResponse(session.user);
            return res.status(200).send(response);
        });

        router.get(`/bbmStatusForBbmAlsoPinkEraAndLillieAreCuteBtwWilliamGay`, async (req, res) => {
            /*
            #swagger.tags = ['Status']
            #swagger.summary = 'Get API status.'
            #swagger.description = 'Get API status.'
            #swagger.responses[200] = {
                description: 'Returns API status.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/APIStatus'
                        }
                    }
                }
            }
            #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            */

            let session = await validateSession(req, res, false, null, false);
            let response = this.generateStatusResponse(session.user);
            return res.status(200).send(response);
        });
    }

    private generateStatusResponse(user: User | null) {
        let gitVersion = Utils.getGitVersion();
        let apiVersion = Config.API_VERSION;

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