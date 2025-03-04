import { UniqueConstraintError, ValidationError } from "sequelize";
import { randomBytes } from 'crypto';

export class Utils {
    public static parseErrorMessage(err: unknown): string {
        if (err instanceof ValidationError || err instanceof UniqueConstraintError) {
            return `${err.name} ${err.message} ${err.errors.map(e => e.message).join(`, `)}`;
        } else if (err instanceof Error) {
            return `${err.name} ${err.message}`;
        } else if (typeof err === `string`) {
            return err;
        } else {
            return JSON.stringify(err);
        }
    }

    public static createRandomString(byteCount: number): string {
        let key = randomBytes(byteCount).toString(`base64url`);
        return key;
    }
}