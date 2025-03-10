import { Router } from 'express';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { validateSession } from '../../shared/AuthHelper.ts';
import { DatabaseHelper } from '../../shared/Database.ts';
import { Logger } from '../../shared/Logger.ts';
import { Config } from '../../shared/Config.ts';
import { Validator } from '../../shared/Validator.ts';
import { Utils } from '../../shared/Utils.ts';

export class AuthRoutes {
    private router: Router;
    private validStates: {stateId: string, ip: string, redirectUrl: URL, userId: number|null}[] = [];

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/auth`, async (req, res) => {
            // #swagger.tags = ['Auth']
            // #swagger.summary = 'Get logged in user information.'
            // #swagger.description = 'Get user information.'
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.responses[200] = { description: 'Returns user information.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            let session = await validateSession(req, res, false);
            if (!session.user) {
                return;
            }
            return res.status(200).send({ user: session.user.toAPIResponse() });
        });

        passport.serializeUser(function(user, done) {
            done(null, user);
        });
          
        passport.deserializeUser(function(obj, done) {
            // @ts-expect-error 2345 honestly i just have this so that passport works
            done(null, obj);
        });

        passport.use(new GitHubStrategy({
            clientID: Config.auth.github.clientId,
            clientSecret: Config.auth.github.clientSecret,
            callbackURL: `${Config.server.url}${Config.server.apiRoute}/auth/github/callback`,
            scope: [ ], // github docs say that no scope is all you need for public user info.
        },
        function(accessToken:any, refreshToken:any, profile:any, done:any) {
            DatabaseHelper.database.Users.findOne({ where: { githubId: profile.id.toString() } }).then((user) => {
                if (!user) {
                    DatabaseHelper.database.Users.create({
                        username: profile.username,
                        githubId: profile.id.toString(),
                        roles: {
                            sitewide: [],
                            perGame: {},
                        },
                        discordId: null,
                        displayName: profile.displayName ? profile.displayName : profile.username,
                        bio: `${profile._json.bio}`,
                    }).then((user) => {
                        Logger.log(`User ${profile.username} signed up.`, `Auth`);
                        DatabaseHelper.refreshCache(`users`);
                        return done(null, user);
                    }).catch((err) => {
                        Logger.error(`Error creating user: ${err}`, `Auth`);
                        return done(err, null);
                    });
                } else {
                    if (user.username !== profile.username) {
                        user.username = profile.username;
                        user.save();
                    }
                    return done(null, user);
                }
            }).catch((err) => {
                Logger.error(`Error finding user: ${err}`, `Auth`);
                return done(err, null);
            });
        }
        ));

        this.router.get(`/auth/github`, async (req, res, next) => {
            // #swagger.tags = ['Auth']
            let state = this.prepAuth(req, undefined, 10);
            if (!state) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            passport.authenticate(`github`, { state: state })(req, res, next);
        });
          
        this.router.get(`/auth/github/callback`, passport.authenticate(`github`, { failureRedirect: `/` }), async (req, res) => {
            // #swagger.tags = ['Auth']
            let state = req.query[`state`];
            if (!state) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            let stateObj = this.validStates.find((s) => s.stateId === state && s.ip === req.ip);
            if (!stateObj) {
                return res.status(400).send({ error: `Invalid state.` });
            }
            this.validStates = this.validStates.filter((s) => s.stateId !== state);

            // @ts-expect-error 2339 its there bro trust me i promise bro its there bro
            req.session.userId = req.user.id;
            req.session.goodMorning47YourTargetIsThisSession = false;
            req.session.save();

            Logger.log(`User ${req.session.userId} logged in.`, `Auth`);
            return res.status(200).send(`<head><meta http-equiv="refresh" content="0; url=${stateObj.redirectUrl.href}" /></head><body style="background-color: black;"><a style="color:white;" href="${stateObj.redirectUrl.href}">Click here if you are not redirected...</a></body>`);
        });


        passport.use(new DiscordStrategy({
            clientID: Config.auth.discord.clientId,
            clientSecret: Config.auth.discord.clientSecret,
            callbackURL: `${Config.server.url}${Config.server.apiRoute}/auth/discord/callback`,
            scope: [ `identify` ],
        }, function(accessToken:any, refreshToken:any, profile:any, done:any) {
            if (!profile) {
                return done(null, false);
            }
            if (!profile.id) {
                return done(null, false);
            }
            return done(null, profile);
        }));

        this.router.get(`/auth/discord`, async (req, res, next) => {
            // #swagger.tags = ['Auth']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let session = await validateSession(req, res, false);
            if (!session.user) {
                return;
            }
            let state = this.prepAuth(req, session.user.id);
            if (!state) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            passport.authenticate(`discord`, { state: state, session: false })(req, res, next);
        });

        this.router.get(`/auth/discord/callback`, passport.authenticate(`discord`, { failureRedirect: `/`, session: false }), async (req, res) => {
            // #swagger.tags = ['Auth']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let state = req.query[`state`];
            if (!state) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            let stateObj = this.validStates.find((s) => s.stateId === state && s.ip === req.ip);
            if (!stateObj) {
                return res.status(400).send({ error: `Invalid state.` });
            }
            this.validStates = this.validStates.filter((s) => s.stateId !== state);

            
            if (!stateObj.userId) {
                return res.status(400).send({ error: `Invalid user.` });
            }
            let user = await DatabaseHelper.database.Users.findOne({ where: { id: stateObj.userId } });
            if (!user) {
                return res.status(400).send({ error: `Invalid user` });
            }
            // @ts-expect-error 2339 its there bro trust me i promise bro its there bro
            user.discordId = req.user.id;
            await user.save();

            Logger.log(`User ${user.id} linked their discord to ${user.discordId}.`, `Auth`);
            return res.status(200).send(`<head><meta http-equiv="refresh" content="0; url=${stateObj.redirectUrl.href}" /></head><body style="background-color: black;"><a style="color:white;" href="${stateObj.redirectUrl.href}">Click here if you are not redirected...</a></body>`);
        });

        
        this.router.get(`/auth/logout`, async (req, res) => {
            // #swagger.tags = ['Auth']
            // #swagger.summary = 'Logout.'
            // #swagger.description = 'Logout.'
            // #swagger.responses[200] = { description: 'Logout successful.' }
            // #swagger.responses[500] = { description: 'Internal server error.' }
            let redirect = Validator.zUrl.default(Config.server.url).safeParse(req.query[`redirect`]);
            if (!redirect.success) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            req.session.destroy((err) => {
                if (err) {
                    return res.status(500).send({ error: `Internal server error.` });
                }
                return res.status(200).send(`<head><meta http-equiv="refresh" content="0; url=${redirect.data}" /></head><body style="background-color: black;"><a style="color:white;" href="${redirect.data}">Click here if you are not redirected...</a></body>`);
            });
        });
    }
    
    private prepAuth(req: any, userId?: number, minsToTimeout = 5): string|null {
        let redirect = Validator.zUrl.default(Config.server.url).safeParse(req.query[`redirect`]);
        if (!redirect.success) {
            return null;
        }
        let state = Utils.createRandomString(32);
        if (userId) {
            this.validStates.push({stateId: state, ip: req.ip, redirectUrl: new URL(redirect.data), userId});
        } else {
            this.validStates.push({stateId: state, ip: req.ip, redirectUrl: new URL(redirect.data), userId: null});
        }
        setTimeout(() => {
            this.validStates = this.validStates.filter((s) => s.stateId !== state);
        }, 1000 * 60 * minsToTimeout);
        return state;
    }
}